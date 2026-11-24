package app.anglers.journal.smoke;

import android.content.Context;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.zip.GZIPOutputStream;
import org.json.JSONObject;

/** Serve one immutable edition and then a damaged replacement through the actual download path. */
final class AtlasFixture {
  private static final String COMMIT = "0123456789abcdef0123456789abcdef01234567";
  volatile String manifest = "null";
  private byte[] archive = {};
  private int rawSize;

  void enable(Context context) throws Exception {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    try (GZIPOutputStream zip = new GZIPOutputStream(bytes)) {
      write(zip, "{\"format\":1");
      String[][] sections = {{"cz","czech-waters"}, {"shapes","czech-water-shapes"},
          {"sources","water-sources"}, {"europe","europe-waters"}};
      for (String[] section : sections) {
        write(zip, ",\"" + section[0] + "\":");
        try (InputStream input = context.getAssets().open(section[1] + ".json");
             BufferedReader in = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
          String line;
          while ((line = in.readLine()) != null)
            write(zip, line.replace("River Suir – Cahir, Co. Tipperary", "Atlas fixture water") + "\n");
        }
      }
      write(zip, "}");
    }
    archive = bytes.toByteArray();
    StringBuilder hash = new StringBuilder();
    for (byte b : MessageDigest.getInstance("SHA-256").digest(archive)) hash.append(String.format("%02x", b & 255));
    manifest = new JSONObject().put("format",1).put("commit",COMMIT).put("asOf","2026-11-24")
        .put("bytes",archive.length).put("unpacked",rawSize).put("sha256",hash.toString()).toString();
  }

  private void write(OutputStream out, String value) throws IOException {
    byte[] part = value.getBytes(StandardCharsets.UTF_8);
    rawSize += part.length;
    out.write(part);
  }

  void damage() throws Exception {
    manifest = new JSONObject(manifest).put("sha256", new String(new char[64]).replace('\0','0')).toString();
  }

  HttpURLConnection download(URL url) throws IOException {
    if (!url.getPath().equals("/milank78git/angler-to-angler/" + COMMIT + "/atlas.json.gz"))
      throw new IOException("Unexpected release URL");
    return new HttpURLConnection(url) {
      public int getResponseCode() { return 200; }
      public InputStream getInputStream() { return new ByteArrayInputStream(archive); }
      public void connect() {}
      public void disconnect() {}
      public boolean usingProxy() { return false; }
    };
  }
}
