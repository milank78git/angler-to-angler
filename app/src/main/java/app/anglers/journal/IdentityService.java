package app.anglers.journal;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import org.json.*;

/** Public-client Auth and profile RPCs. Tokens travel only to the packaged HTTPS origin. */
final class IdentityService {
  final String origin, key, redirect, notice;

  IdentityService(Context c, boolean cs) throws Exception {
    JSONObject config = new JSONObject(asset(c, "account-config.json"));
    origin = config.optString("url");
    key = config.optString("publishableKey");
    redirect = c.getPackageName() + "://account/callback";
    notice = config.optString(cs ? "deploymentCs" : "deploymentEn");
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
    try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
      StringBuilder s = new StringBuilder();
      String line;
      while ((line = r.readLine()) != null) {
        if (s.length() > 262144) throw new IOException("Oversized response");
        s.append(line).append('\n');
      }
      return s.toString().trim();
    }
  }

  static String verifier() {
    byte[] bytes = new byte[48];
    new SecureRandom().nextBytes(bytes);
    return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
  }

  Uri authorize(String provider, String verifier) throws Exception {
    if (!configured() || !("google".equals(provider) || "facebook".equals(provider)))
      throw new IllegalStateException();
    String challenge =
        Base64.encodeToString(
            MessageDigest.getInstance("SHA-256")
                .digest(verifier.getBytes(StandardCharsets.US_ASCII)),
            Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    return Uri.parse(origin + "/auth/v1/authorize")
        .buildUpon()
        .appendQueryParameter("provider", provider)
        .appendQueryParameter("redirect_to", redirect)
        .appendQueryParameter("code_challenge", challenge)
        .appendQueryParameter("code_challenge_method", "s256")
        .build();
  }

  private JSONObject post(String path, String token, JSONObject data) throws Exception {
    if (!configured()) throw new IOException("Account service unavailable");
    HttpURLConnection conn = (HttpURLConnection) new URL(origin + path).openConnection();
    try {
      conn.setInstanceFollowRedirects(false);
      conn.setConnectTimeout(12000);
      conn.setReadTimeout(12000);
      conn.setRequestMethod("POST");
      conn.setRequestProperty("apikey", key);
      if (token != null) conn.setRequestProperty("Authorization", "Bearer " + token);
      conn.setRequestProperty("Content-Type", "application/json");
      conn.setDoOutput(true);
      try (OutputStream out = conn.getOutputStream()) {
        out.write(data.toString().getBytes(StandardCharsets.UTF_8));
      }
      int status = conn.getResponseCode();
      if (status < 200 || status >= 300) throw new IOException("Account service HTTP " + status);
      String result = read(conn.getInputStream());
      return result.isEmpty() || result.equals("null") ? new JSONObject() : new JSONObject(result);
    } finally {
      conn.disconnect();
    }
  }

  void sendSignInEmail(String email) throws Exception {
    post("/auth/v1/otp", null, new JSONObject().put("email", email).put("create_user", true));
  }

  /** Redeem only email authentication proofs for this issuer and the address the angler entered. */
  String verifyEmail(String email, String proof) throws Exception {
    JSONObject request = new JSONObject().put("type", "email");
    if (proof.matches("[0-9]{6,10}")) {
      request.put("email", email).put("token", proof);
    } else {
      Uri link = Uri.parse(proof);
      if (!proof.startsWith(origin + "/auth/v1/verify?")
          || link.getFragment() != null
          || link.getQueryParameters("token").size() != 1
          || link.getQueryParameters("type").size() != 1)
        throw new IllegalArgumentException("Invalid verification link");
      String type = link.getQueryParameter("type");
      if (!"signup".equals(type) && !"magiclink".equals(type) && !"email".equals(type))
        throw new IllegalArgumentException("Unexpected verification type");
      String hash = link.getQueryParameter("token");
      if (hash == null || hash.isEmpty() || hash.length() > 256)
        throw new IllegalArgumentException("Invalid verification token");
      request.put("token_hash", hash);
    }
    JSONObject session = post("/auth/v1/verify", null, request);
    if (!email.equalsIgnoreCase(session.getJSONObject("user").getString("email")))
      throw new IOException("Unexpected email identity");
    return session.getString("access_token");
  }

  String exchange(String code, String verifier) throws Exception {
    return post(
            "/auth/v1/token?grant_type=pkce",
            null,
            new JSONObject().put("auth_code", code).put("code_verifier", verifier))
        .getString("access_token");
  }

  JSONObject profile(String token) throws Exception {
    return post("/rest/v1/rpc/angler_profile", token, new JSONObject());
  }

  JSONObject accept(String token, String name) throws Exception {
    return post(
        "/rest/v1/rpc/angler_accept",
        token,
        new JSONObject()
            .put("nickname", name)
            .put("terms", AccountStore.REVISION)
            .put("privacy", AccountStore.REVISION));
  }
}
