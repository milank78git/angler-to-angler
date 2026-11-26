package app.anglers.journal;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import org.json.JSONObject;

/** Verifies publication by the atlas signer using the public key pinned in this APK. */
final class AtlasSignature {
  private AtlasSignature() {}

  static void verify(String pin, JSONObject manifest) throws Exception {
    if (pin.isEmpty()) throw new GeneralSecurityException("Atlas signer is not configured");
    StringBuilder message = new StringBuilder("angler-atlas-v1\n");
    for (String field : new String[] {"commit", "sha256", "registrySha256", "bytes", "unpacked", "asOf"}) {
      message.append(manifest.get(field).toString()).append('\n');
    }
    if (!manifest.getString("registrySha256").matches("[a-f0-9]{64}"))
      throw new GeneralSecurityException("Invalid registry digest");
    Signature verifier = Signature.getInstance("SHA256withECDSA");
    verifier.initVerify(KeyFactory.getInstance("EC").generatePublic(
        new X509EncodedKeySpec(Base64.getDecoder().decode(pin))));
    verifier.update(message.toString().getBytes(StandardCharsets.US_ASCII));
    if (!verifier.verify(Base64.getDecoder().decode(manifest.getString("signature"))))
      throw new GeneralSecurityException("Atlas signature mismatch");
  }
}
