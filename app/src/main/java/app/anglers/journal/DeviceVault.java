package app.anglers.journal;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.JSONObject;

/**
 * Public-key wrapping allows refresh rotation in the background. Opening the envelope requires
 * Android authentication.
 */
final class DeviceVault {
  private static final String ALIAS = "angler-device-session-v1";
  private static final String RECORD = "deviceSession";
  private static final OAEPParameterSpec OAEP =
      new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);

  /** Check whether the device provides the required protected storage capability. */
  static boolean supported(Context c) {
    return c.getSystemService(KeyguardManager.class).isDeviceSecure();
  }

  /** Check whether credentials are already enrolled in this device vault. */
  static boolean enrolled(Context c) {
    return supported(c) && AccountStore.prefs(c).contains(RECORD);
  }

  /** Open the Android keystore that owns the device encryption keys. */
  private static KeyStore store() throws Exception {
    KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
    keys.load(null);
    return keys;
  }

  /** Retrieve the public key used to encrypt local session material. */
  private static PublicKey publicKey() throws Exception {
    KeyStore keys = store();
    if (!keys.containsAlias(ALIAS)) {
      KeyPairGenerator generator =
          KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
      KeyGenParameterSpec.Builder spec =
          new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_DECRYPT)
              .setKeySize(2048)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
              .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
              .setUserAuthenticationRequired(true);
      if (Build.VERSION.SDK_INT >= 30)
        spec.setUserAuthenticationParameters(
            60, KeyProperties.AUTH_DEVICE_CREDENTIAL | KeyProperties.AUTH_BIOMETRIC_STRONG);
      else spec.setUserAuthenticationValidityDurationSeconds(60);
      generator.initialize(spec.build());
      generator.generateKeyPair();
    }
    return KeyFactory.getInstance("RSA")
        .generatePublic(
            new X509EncodedKeySpec(keys.getCertificate(ALIAS).getPublicKey().getEncoded()));
  }

  /** Encode vault bytes into the persistent text representation. */
  private static String encode(byte[] bytes) {
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  }

  /** Recover the binary vault payload from its stored text representation. */
  private static byte[] decode(JSONObject record, String key) throws Exception {
    return Base64.decode(record.getString(key), Base64.NO_WRAP);
  }

  /** Encrypt the verified session before persisting it on the device. */
  static void save(Context c, IdentityService.Session session) throws Exception {
    if (!supported(c)) {
      clear(c);
      return;
    }
    KeyGenerator generator = KeyGenerator.getInstance("AES");
    generator.init(256);
    SecretKey dataKey = generator.generateKey();
    Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
    aes.init(Cipher.ENCRYPT_MODE, dataKey);
    JSONObject plain =
        new JSONObject()
            .put("id", session.id)
            .put("email", session.email)
            .put("refresh", session.refresh);
    byte[] ciphertext = aes.doFinal(plain.toString().getBytes(StandardCharsets.UTF_8));
    Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
    rsa.init(Cipher.ENCRYPT_MODE, publicKey(), OAEP);
    JSONObject record =
        new JSONObject()
            .put("key", encode(rsa.doFinal(dataKey.getEncoded())))
            .put("iv", encode(aes.getIV()))
            .put("data", encode(ciphertext));
    if (!AccountStore.prefs(c).edit().putString(RECORD, record.toString()).commit())
      throw new java.io.IOException("Device session unavailable");
  }

  /** Decrypt the stored session and reconstruct its verified identity. */
  static IdentityService.Session open(Context c) throws Exception {
    SharedPreferences prefs = AccountStore.prefs(c);
    JSONObject record = new JSONObject(prefs.getString(RECORD, ""));
    Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
    Key privateKey = store().getKey(ALIAS, null);
    if (privateKey == null) {
      clear(c);
      throw new GeneralSecurityException("Device credential no longer available");
    }
    try {
      rsa.init(Cipher.DECRYPT_MODE, privateKey, OAEP);
    } catch (android.security.keystore.KeyPermanentlyInvalidatedException invalidated) {
      clear(c);
      throw invalidated;
    }
    byte[] key = rsa.doFinal(decode(record, "key"));
    try {
      Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
      aes.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(128, decode(record, "iv")));
      JSONObject plain =
          new JSONObject(new String(aes.doFinal(decode(record, "data")), StandardCharsets.UTF_8));
      if (!plain.getString("id").equals(prefs.getString("subject", "")))
        throw new GeneralSecurityException("Account changed");
      return new IdentityService.Session(
          plain.getString("id"), plain.getString("email"), "", plain.getString("refresh"), 0);
    } finally {
      java.util.Arrays.fill(key, (byte) 0);
    }
  }

  /** Discard the local data that would otherwise restore the previous account. */
  static void clear(Context c) {
    AccountStore.prefs(c).edit().remove(RECORD).commit();
    try {
      store().deleteEntry(ALIAS);
    } catch (Exception ignored) {
      /* The encrypted record was removed. */
    }
  }
}
