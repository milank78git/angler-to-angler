package app.anglers.journal;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;
import org.json.*;

/** Public-client Auth and profile RPCs. Tokens travel only to the packaged HTTPS origin. */
final class IdentityService {
  final String origin, key, redirect, notice, language;

  IdentityService(Context c) throws Exception {
    language = AppLanguage.current(c).toLanguageTag().toLowerCase(Locale.ROOT);
    JSONObject config = new JSONObject(asset(c, "account-config.json"));
    origin = config.optString("url");
    key = config.optString("publishableKey");
    redirect = AccountCallbackActivity.redirect(c);
    JSONObject notices = config.optJSONObject("deploymentNotices");
    String selected = "";
    if (notices != null) {
      for (String code : AppLanguage.codes(c)) selected = notices.optString(code, selected);
    }
    notice = selected;
  }

  boolean configured() {
    Uri uri = Uri.parse(origin);
    return "https".equals(uri.getScheme())
        && uri.getHost() != null
        && uri.getUserInfo() == null
        && origin.equals("https://" + uri.getEncodedAuthority())
        && key.startsWith("sb_publishable_")
        && !notice.trim().isEmpty();
  }

  static String asset(Context c, String name) throws IOException {
    try (InputStream in = c.getAssets().open(name)) {
      return read(in);
    }
  }

  private static String read(InputStream in) throws IOException {
    try (InputStream input = in; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      int count;
      while ((count = input.read(buffer)) != -1) {
        if (output.size() + count > 262144) throw new IOException("Oversized response");
        output.write(buffer, 0, count);
      }
      return output.toString("UTF-8").trim();
    }
  }

  static String verifier() {
    byte[] bytes = new byte[48];
    new SecureRandom().nextBytes(bytes);
    return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
  }

  private static String challenge(String verifier) throws Exception {
    return Base64.encodeToString(
        MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)),
        Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
  }

  JSONObject postSignal(JSONObject args) throws Exception {
    return request("/rest/v1/rpc/angler_post_signal", null, args);
  }

  JSONObject communitySignal(JSONObject args) throws Exception {
    return request("/rest/v1/rpc/angler_community_signal", null, args);
  }

  void endPostWatch(JSONObject args) throws Exception {
    request("/rest/v1/rpc/angler_end_post_watch", null, args);
  }

  JSONObject waterManifest() throws Exception {
    return request("/rest/v1/rpc/angler_water_manifest", null, new JSONObject());
  }

  JSONObject providers() throws Exception {
    return request("/auth/v1/settings", null, null).getJSONObject("external");
  }

  Uri authorize(String provider, String verifier) throws Exception {
    if (!configured() || !("google".equals(provider) || "facebook".equals(provider)))
      throw new IllegalStateException();
    Uri.Builder url =
        Uri.parse(origin + "/auth/v1/authorize")
            .buildUpon()
            .appendQueryParameter("provider", provider)
            .appendQueryParameter("redirect_to", redirect)
            .appendQueryParameter("code_challenge", challenge(verifier))
            .appendQueryParameter("code_challenge_method", "s256");
    if ("google".equals(provider)) url.appendQueryParameter("prompt", "select_account");
    return url.build();
  }

  static final class EmailRateLimit extends IOException {}

  static final class HttpFailure extends IOException {
    final int status;
    final String code;

    HttpFailure(int status) {
      this(status, "");
    }

    HttpFailure(int status, String code) {
      super("Account service HTTP " + status);
      this.code = code;
      this.status = status;
    }
  }

  JSONObject rpc(String operation, String token, JSONObject args) throws Exception {
    if (token == null) throw new HttpFailure(401);
    return request("/rest/v1/rpc/angler_" + operation, token, args);
  }

  void verifyPlay(String bearer, String purchaseToken) throws Exception {
    JSONObject receipt = request("/functions/v1/play-purchase", bearer, new JSONObject().put("token", purchaseToken));
    if (!Boolean.TRUE.equals(receipt.opt("verified"))) throw new IOException("Purchase verification incomplete");
  }

  private JSONObject request(String path, String token, JSONObject data) throws Exception {
    return request(path, token, data, data == null ? "GET" : "POST");
  }

  private JSONObject request(String path, String token, JSONObject data, String method)
      throws Exception {
    if (!configured()) throw new IOException("Account service unavailable");
    HttpURLConnection conn = (HttpURLConnection) new URL(origin + path).openConnection();
    try {
      conn.setInstanceFollowRedirects(false);
      conn.setConnectTimeout(12000);
      conn.setReadTimeout(12000);
      conn.setRequestProperty("apikey", key);
      conn.setRequestProperty("Accept-Language", language);
      if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
      if (data != null) {
        conn.setRequestMethod(method);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        try (OutputStream out = conn.getOutputStream()) {
          out.write(data.toString().getBytes(StandardCharsets.UTF_8));
        }
      }
      int status = conn.getResponseCode();
      if (status < 200 || status >= 300) {
        if (status == 429 && path.startsWith("/auth/v1/")) throw new EmailRateLimit();
        String code = "";
        // Profile registration returns a PostgREST error code when the nickname is taken.
        boolean accountError = path.startsWith("/auth/v1/") || path.equals("/rest/v1/rpc/angler_register");
        boolean reviewLimit = status == 429 && path.equals("/rest/v1/rpc/angler_evidence_submit");
        InputStream errorBody = conn.getErrorStream();
        if ((accountError || reviewLimit) && errorBody != null) {
          try {
            JSONObject failure = new JSONObject(read(errorBody));
            code = failure.optString("error_code", failure.optString("code", ""));
            if (reviewLimit && "PT429".equals(code) && "Pending review limit".equals(failure.optString("message")))
              code = "pending_review_limit";
          } catch (JSONException | IOException ignored) {
            /* Preserve the HTTP status even if an intermediary sent an unreadable error body. */
          }
        }
        throw new HttpFailure(status, code);
      }
      String result = read(conn.getInputStream());
      return result.isEmpty() || result.equals("null") ? new JSONObject() : new JSONObject(result);
    } finally {
      conn.disconnect();
    }
  }

  /** The caller keeps access tokens in memory and seals only the rotating refresh credential. */
  static final class Session {
    final String id, email, access, refresh;
    final long expires;

    Session(String id, String email, String access, String refresh, long expires) {
      this.id = java.util.UUID.fromString(id).toString();
      this.email = email;
      this.access = access;
      this.refresh = refresh;
      this.expires = expires;
    }

    static Session from(JSONObject json, String expectedEmail) throws Exception {
      JSONObject user = json.getJSONObject("user");
      String email = user.getString("email"),
          access = json.getString("access_token"),
          refresh = json.getString("refresh_token");
      if ((!expectedEmail.isEmpty() && !expectedEmail.equalsIgnoreCase(email))
          || access.isEmpty()
          || refresh.isEmpty()) throw new IOException("Invalid account session");
      return new Session(
          user.getString("id"),
          email,
          access,
          refresh,
          System.currentTimeMillis() + json.getLong("expires_in") * 1000L);
    }
  }

  private JSONObject challengeBody(String email, String verifier) throws Exception {
    return new JSONObject()
        .put("email", email)
        .put("code_challenge", challenge(verifier))
        .put("code_challenge_method", "s256");
  }

  Session signUp(String email, String password, String verifier) throws Exception {
    JSONObject response =
        request(
            "/auth/v1/signup?redirect_to=" + Uri.encode(redirect),
            null,
            challengeBody(email, verifier)
                .put("password", password)
                .put("data", new JSONObject().put("locale", language)));
    return response.has("access_token") ? Session.from(response, email) : null;
  }

  void resendSignup(String email, String verifier) throws Exception {
    request(
        "/auth/v1/resend?redirect_to=" + Uri.encode(redirect),
        null,
        challengeBody(email, verifier).put("type", "signup"));
  }

  Session signIn(String email, String password) throws Exception {
    return Session.from(
        request(
            "/auth/v1/token?grant_type=password",
            null,
            new JSONObject().put("email", email).put("password", password)),
        email);
  }

  void recover(String email, String verifier) throws Exception {
    request(
        "/auth/v1/recover?redirect_to=" + Uri.encode(redirect),
        null,
        challengeBody(email, verifier));
  }

  void setPassword(Session session, String password) throws Exception {
    JSONObject user =
        request("/auth/v1/user", session.access, new JSONObject().put("password", password), "PUT");
    if (!session.id.equals(user.getString("id"))) throw new IOException("Account changed");
  }

  /** Revokes only the session being removed on this device, including after a vault unlock. */
  void signOut(Session current) throws Exception {
    if (current == null || current.refresh.isEmpty()) return;
    if (current.access.isEmpty() || current.expires <= System.currentTimeMillis()) current = refresh(current);
    request("/auth/v1/logout?scope=local", current.access, new JSONObject());
  }

  Session refresh(Session current) throws Exception {
    Session next =
        Session.from(
            request(
                "/auth/v1/token?grant_type=refresh_token",
                null,
                new JSONObject().put("refresh_token", current.refresh)),
            current.email);
    if (!next.id.equals(current.id)) throw new IOException("Account changed");
    return next;
  }

  Session exchange(String code, String verifier, String expectedEmail) throws Exception {
    return Session.from(
        request(
            "/auth/v1/token?grant_type=pkce",
            null,
            new JSONObject().put("auth_code", code).put("code_verifier", verifier)),
        expectedEmail);
  }

  JSONObject profile(String token) throws Exception {
    return request("/rest/v1/rpc/angler_registration_profile", token, new JSONObject());
  }

  JSONObject accept(String token, String name, String birthDate) throws Exception {
    return request(
        "/rest/v1/rpc/angler_register",
        token,
        new JSONObject()
            .put("nickname", name)
            .put("birth_date", birthDate == null ? JSONObject.NULL : birthDate)
            .put("terms", AccountStore.REVISION)
            .put("privacy", AccountStore.REVISION));
  }
}
