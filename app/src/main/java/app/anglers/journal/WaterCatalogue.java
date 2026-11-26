package app.anglers.journal;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.JsonReader;
import android.util.JsonToken;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.zip.GZIPInputStream;
import org.json.JSONObject;

/** Install immutable data files from the release already registered by the account service. */
final class WaterCatalogue {
  static final String REVISION = "revision", CHECKED = "checked", DATE = "edition";
  static final String ROOT = "https://raw.githubusercontent.com/milank78git/angler-to-angler/";
  private static final int JOB = 473001;
  private static final ExecutorService IO = Executors.newSingleThreadExecutor();
  enum Result { CURRENT, UPDATED, FAILED, SKIPPED }

  static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences("water-atlas", Context.MODE_PRIVATE);
  }

  static boolean automatic(Context c) { return prefs(c).getBoolean("automatic", true); }

  static void schedule(Context c) {
    JobScheduler scheduler = c.getSystemService(JobScheduler.class);
    if (!automatic(c)) { scheduler.cancel(JOB); return; }
    if (scheduler.getPendingJob(JOB) == null) {
      scheduler.schedule(new JobInfo.Builder(JOB, new ComponentName(c, WaterCatalogueJob.class))
          .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
          .setPeriodic(TimeUnit.DAYS.toMillis(1)).build());
    }
  }

  static void setAutomatic(Context c, boolean value) {
    prefs(c).edit().putBoolean("automatic", value).apply();
    schedule(c);
    if (value) check(c, false, null);
  }

  static String revision(Context c) {
    String pin = c.getString(R.string.atlas_public_key);
    if (pin.isEmpty() || !pin.equals(prefs(c).getString("verifiedSigner", ""))) return "";
    String key = prefs(c).getString(REVISION, "");
    return key.matches("[a-f0-9]{64}") && file(c, key).isFile() ? key : "";
  }

  private static File file(Context c, String key) {
    return new File(c.getDir("atlas", Context.MODE_PRIVATE), key + ".json");
  }

  static InputStream open(Context c, String key) throws IOException {
    String current = revision(c);
    if (current.isEmpty() || key == null || !key.matches("[a-f0-9]{64}")
        || !(current.equals(key) || key.equals(prefs(c).getString("previousVerified", ""))))
      throw new FileNotFoundException();
    return new BufferedInputStream(new FileInputStream(file(c, key)));
  }

  /** Background and foreground share a queue; manual checks always contact the service. */
  static void check(Context context, boolean manual, Consumer<Result> done) {
    Context c = context.getApplicationContext();
    IO.execute(() -> {
      Result result = Result.FAILED;
      SharedPreferences prefs = prefs(c);
      long now = System.currentTimeMillis(), last = prefs.getLong(CHECKED, 0);
      long elapsed = now - prefs.getLong("attempt", 0);
      boolean today = Instant.ofEpochMilli(last).atZone(ZoneId.systemDefault()).toLocalDate().equals(LocalDate.now());
      if (!manual && (!automatic(c) || today || (elapsed >= 0 && elapsed < TimeUnit.MINUTES.toMillis(15)))) {
        result = Result.SKIPPED;
      } else {
        prefs.edit().putLong("attempt", now).apply();
        try {
          JSONObject manifest = new IdentityService(c).waterManifest();
          String commit = manifest.getString("commit"), hash = manifest.getString("sha256");
          int packed = manifest.getInt("bytes"), unpacked = manifest.getInt("unpacked");
          String edition = LocalDate.parse(manifest.getString("asOf")).toString();
          if (manifest.getInt("format") != 1 || !commit.matches("[a-f0-9]{40}") || !hash.matches("[a-f0-9]{64}")
              || packed < 1 || packed > 16 * 1024 * 1024 || unpacked < 1 || unpacked > 48 * 1024 * 1024)
            throw new IOException("Invalid atlas release");
          String pin = c.getString(R.string.atlas_public_key);
          AtlasSignature.verify(pin, manifest);
          String previous = revision(c);
          if (!previous.isEmpty() && edition.compareTo(prefs.getString(DATE, "")) < 0)
            throw new IOException("Atlas edition predates the installed release");
          if (!previous.equals(hash)) {
            HttpURLConnection conn = (HttpURLConnection) new URL(ROOT + commit + "/atlas.json.gz").openConnection();
            try {
              conn.setInstanceFollowRedirects(false);
              conn.setConnectTimeout(12000);
              conn.setReadTimeout(30000);
              conn.setRequestProperty("Accept-Encoding", "identity");
              if (conn.getResponseCode() != 200) throw new IOException("Atlas download unavailable");
              try (InputStream stream = conn.getInputStream()) { install(c, stream, hash, packed, unpacked); }
            } finally { conn.disconnect(); }
          }
          String retained = previous.equals(hash) ? prefs.getString("previousVerified", "") : previous;
          if (!prefs.edit().putString(REVISION, hash).putString(DATE, edition)
              .putString("previousVerified", retained)
              .putString("verifiedSigner", pin).putLong(CHECKED, System.currentTimeMillis()).commit()) throw new IOException("Atlas preferences unavailable");
          if (!previous.equals(hash)) {
            AtlasAdditions.notify(c, previous, hash);
            c.sendBroadcast(new android.content.Intent(c, SeasonReminder.class));
          }
          File[] files = file(c, hash).getParentFile().listFiles();
          if (files != null) for (File old : files)
            if (!old.equals(file(c, hash)) && !old.equals(file(c, retained))) old.delete();
          result = previous.equals(hash) ? Result.CURRENT : Result.UPDATED;
        } catch (Exception error) {
          android.util.Log.w("WaterCatalogue", "Atlas check failed", error);
        }
      }
      if (done != null) done.accept(result);
    });
  }

  /** Bound both streams and validate the archive before making its revision available. */
  static void install(Context c, InputStream source, String hash, int packed, int unpacked) throws Exception {
    File target = file(c, hash), dir = target.getParentFile();
    File archive = File.createTempFile("download", ".tmp", dir), data = null;
    try {
      data = File.createTempFile("unpacked", ".tmp", dir);
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      try (DigestInputStream in = new DigestInputStream(source, digest);
           FileOutputStream out = new FileOutputStream(archive)) { copy(in, out, packed); }
      StringBuilder hex = new StringBuilder(64);
      for (byte b : digest.digest()) hex.append(Character.forDigit((b & 255) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
      if (!hash.contentEquals(hex)) throw new IOException("Atlas checksum mismatch");
      try (InputStream in = new GZIPInputStream(new FileInputStream(archive));
           FileOutputStream out = new FileOutputStream(data)) { copy(in, out, unpacked); out.getFD().sync(); }
      try (JsonReader reader = new JsonReader(new BufferedReader(new InputStreamReader(new FileInputStream(data), StandardCharsets.UTF_8)))) {
        Set<String> keys = new HashSet<>();
        reader.beginObject();
        while (reader.hasNext()) {
          String name = reader.nextName();
          if (!keys.add(name)) throw new IOException("Duplicate atlas field");
          if (name.equals("format")) {
            if (reader.nextInt() != 1) throw new IOException("Unsupported atlas");
          } else {
            if (reader.peek() != JsonToken.BEGIN_OBJECT) throw new IOException("Invalid atlas section");
            reader.skipValue();
          }
        }
        reader.endObject();
        if (!keys.containsAll(java.util.Arrays.asList("format","cz","shapes","europe","sources"))
            || reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("Incomplete atlas");
      }
      Files.move(data.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } finally { archive.delete(); if (data != null) data.delete(); }
  }

  private static void copy(InputStream in, OutputStream out, int expected) throws IOException {
    byte[] buffer = new byte[32768];
    int total = 0, n;
    while ((n = in.read(buffer)) != -1) {
      total += n;
      if (total > expected) throw new IOException("Atlas exceeds manifest size");
      out.write(buffer, 0, n);
    }
    if (total != expected) throw new IOException("Incomplete atlas download");
  }
}
