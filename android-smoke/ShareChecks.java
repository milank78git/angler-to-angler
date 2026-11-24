package app.anglers.journal.smoke;

import android.app.Activity;
import android.app.Instrumentation.ActivityMonitor;
import android.app.Instrumentation.ActivityResult;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.json.JSONTokener;

/**
 * Checks what actually leaves the app, intercepting the chooser before it can send to a recipient.
 */
final class ShareChecks {
  private static void check(boolean ok, String message) {
    if (!ok) throw new AssertionError(message);
  }

  private static Intent outgoing(Runner app) throws Exception {
    return outgoing(app, "#card-send");
  }

  static Intent outgoing(Runner app, String selector) throws Exception {
    ArrayBlockingQueue<Intent> captured = new ArrayBlockingQueue<>(1);
    ActivityMonitor monitor =
        new ActivityMonitor() {
          @Override
          public ActivityResult onStartActivity(Intent intent) {
            if (!Intent.ACTION_CHOOSER.equals(intent.getAction())) return null;
            captured.offer(intent);
            return new ActivityResult(Activity.RESULT_CANCELED, null);
          }
        };
    app.addMonitor(monitor);
    try {
      app.clickReady(selector);
      Intent chooser = captured.poll(10, TimeUnit.SECONDS);
      check(chooser != null, "System chooser was not requested");
      Intent send = chooser.getParcelableExtra(Intent.EXTRA_INTENT);
      check(send != null, "Chooser has no target intent");
      if ("#card-send".equals(selector)) check(Intent.ACTION_SEND.equals(send.getAction()), "Expected a send intent");
      app.waitForIdleSync();
      return send;
    } finally {
      app.removeMonitor(monitor);
    }
  }

  /** Select the installed test map from the native dialog and inspect its parking destination. */
  static void parking(Runner app) throws Exception {
    String testPackage = app.getContext().getPackageName();
    android.content.pm.PackageManager pm = app.getTargetContext().getPackageManager();
    android.content.pm.ResolveInfo handler = pm.resolveActivity(
        new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0")).setPackage(testPackage),
        android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
    check(handler != null, "Test map must resolve on the installed device");
    String label = handler.loadLabel(pm).toString();
    ArrayBlockingQueue<Intent> outgoing = new ArrayBlockingQueue<>(1);
    ActivityMonitor monitor = new ActivityMonitor() {
      @Override public ActivityResult onStartActivity(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || !testPackage.equals(intent.getPackage())) return null;
        outgoing.offer(intent);
        return new ActivityResult(Activity.RESULT_CANCELED, null);
      }
    };
    app.addMonitor(monitor);
    try {
      app.clickReady("#drive-0");
      long deadline = android.os.SystemClock.elapsedRealtime() + 10000;
      boolean tapped = false;
      while (!tapped && android.os.SystemClock.elapsedRealtime() < deadline) {
        android.view.accessibility.AccessibilityNodeInfo root = app.getUiAutomation().getRootInActiveWindow();
        if (root != null && !root.findAccessibilityNodeInfosByText(app.label("parking.copy")).isEmpty()) {
          for (android.view.accessibility.AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(label)) {
            if (!label.equals(String.valueOf(node.getText()))) continue;
            android.graphics.Rect bounds = new android.graphics.Rect();
            node.getBoundsInScreen(bounds);
            long now = android.os.SystemClock.uptimeMillis();
            app.sendPointerSync(android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,
                bounds.centerX(),bounds.centerY(),0));
            app.sendPointerSync(android.view.MotionEvent.obtain(now,android.os.SystemClock.uptimeMillis(),android.view.MotionEvent.ACTION_UP,
                bounds.centerX(),bounds.centerY(),0));
            tapped = true;
            break;
          }
        }
        if (!tapped) Thread.sleep(100);
      }
      check(tapped,"Installed map was absent from the parking dialog");
      Intent route = outgoing.poll(10, TimeUnit.SECONDS);
      check(route != null && "geo:49.8770658,14.4263203?q=49.8770658,14.4263203".equals(route.getDataString()),
          "Selected map did not receive the car park coordinates");
    } finally {
      app.removeMonitor(monitor);
    }
  }

  private static void typeTip(Runner app, String text) throws Exception {
    app.js("(() => {const field=document.querySelector('#share-tip-text');field.value="
        + org.json.JSONObject.quote(text) + ";field.dispatchEvent(new Event('input'));})()");
  }

  /** Verify a catch-free trip can send newly authored text through the actual Android chooser. */
  static String tripTip(Runner app) throws Exception {
    app.js("document.querySelector('#share-tip').click()");
    app.waitFor("document.querySelector('#share-tip-text')?.value==='' && document.querySelector('#card-send').disabled");
    app.js("document.querySelector('#share-water').click()");
    app.waitFor("document.querySelector('#card-send').disabled");
    app.js("document.querySelector('#share-water').click()");
    String tip = "Fish the shade <slowly> & pause.";
    typeTip(app, tip);
    app.waitFor("document.querySelector('#card-text').textContent==='" + tip + "' && !document.querySelector('#card-text slowly')");
    Intent message = outgoing(app);
    check("text/plain".equals(message.getType()) && tip.equals(message.getStringExtra(Intent.EXTRA_TEXT))
        && !message.hasExtra(Intent.EXTRA_STREAM), "Trip notes or location leaked into the tip");
    app.js("document.querySelector('#share-water').click();document.querySelector('#share-day').click()");
    String preview = (String) new JSONTokener(app.js("document.querySelector('#card-text').textContent")).nextValue();
    check(preview.startsWith(tip + "\n") && preview.contains(app.waterName("401009")) && !preview.contains("Offline smoke test"),
        "Incorrect optional trip fields");
    check(preview.equals(outgoing(app).getStringExtra(Intent.EXTRA_TEXT)), "Tip did not match its preview");
    app.js("document.querySelector('#tip-groups').click()");
    app.waitFor("document.querySelector('#tip-group').options.length===2 && document.querySelector('#tip-post').disabled");
    app.js("const select=document.querySelector('#tip-group'); select.selectedIndex=1; select.dispatchEvent(new Event('change')); document.querySelector('#tip-post').click()");
    app.waitFor("!document.querySelector('#tip-post').disabled && document.querySelector('#tip-feedback').textContent.includes("
        + org.json.JSONObject.quote(app.label("group_tip.could_not_confirm_the_request_check_your")) + ")");
    app.waitFor("document.querySelector('#card-text').textContent===" + org.json.JSONObject.quote(preview));
    app.js("document.querySelector('#tip-post').click()");
    app.waitFor("!!document.querySelector('#share-tip')");
    app.js("document.querySelector('#share-tip').click()");
    app.waitFor("document.querySelector('#share-tip-text')?.value==='' && document.querySelector('#card-send').disabled && document.querySelector('#tip-groups').disabled");
    app.js("document.querySelector('#back').click()");
    app.waitFor("!!document.querySelector('#add')");
    return preview;
  }

  static void run(Runner app) throws Exception {
    app.script("share-photo-fixture.js");
    app.waitFor("window.photoSeeded===true");
    app.js("document.querySelector('[data-share-catch]').click()");
    app.waitFor("document.querySelector('#card-text')?.textContent==='Perch'");
    app.waitFor("!document.querySelector('#card-options input:checked')");
    Intent minimal = outgoing(app);
    check(
        "text/plain".equals(minimal.getType())
            && "Perch".equals(minimal.getStringExtra(Intent.EXTRA_TEXT))
            && !minimal.hasExtra(Intent.EXTRA_STREAM)
            && (minimal.getClipData() == null
                || (minimal.getClipData().getItemCount() == 1
                    && minimal.getClipData().getItemAt(0).getUri() == null
                    && "Perch".contentEquals(minimal.getClipData().getItemAt(0).getText()))),
        "Unselected private information left the app");
    app.js(
        "for(const k of"
            + " ['water','day','bait','technique'])document.querySelector('#share-'+k).click()");
    app.waitFor(
        "document.querySelector('#card-text').textContent.includes(" + org.json.JSONObject.quote(app.waterName("401009")) + ") &&"
            + " document.querySelector('#card-text').textContent.includes('spinner') &&"
            + " document.querySelector('#card-text').textContent.includes('jigging')");
    app.js(
        "for(const k of"
            + " ['water','day','bait','technique'])document.querySelector('#share-'+k).click()");
    app.js(
        "document.querySelector('#share-length').click();document.querySelector('#share-photo').click();document.querySelector('#share-photo').click()");
    app.waitFor(
        "document.querySelector('#card-image').hidden &&"
            + " !document.querySelector('#card-send').disabled");
    app.js("document.querySelector('#share-photo').click()");
    app.waitFor(
        "document.querySelector('#card-image').naturalWidth===32 &&"
            + " !document.querySelector('#card-send').disabled");
    typeTip(app, "Slow retrieve.");
    app.waitFor("document.querySelector('#card-text').textContent.includes('Slow retrieve.') && !document.querySelector('#card-send').disabled");
    app.capture("share");
    String preview =
        (String)
            new JSONTokener(app.js("document.querySelector('#card-text').textContent")).nextValue();
    String src =
        (String) new JSONTokener(app.js("document.querySelector('#card-image').src")).nextValue();
    Intent send = outgoing(app);
    check(
        preview.equals(send.getStringExtra(Intent.EXTRA_TEXT))
            && preview.matches("Perch\\nSlow retrieve\\.\\n" + java.util.regex.Pattern.quote(app.label("share_card.length")) + " · 32[.,]5 cm"),
        "Caption did not match the preview");
    check("image/jpeg".equals(send.getType()), "Wrong attachment type");
    Uri uri = send.getParcelableExtra(Intent.EXTRA_STREAM);
    check(
        uri != null && uri.equals(send.getClipData().getItemAt(0).getUri()),
        "Inconsistent URI grant");
    int flags = send.getFlags();
    check(
        (flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0
            && (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0,
        "Invalid URI permissions");
    ProviderInfo info =
        app.getTargetContext().getPackageManager().resolveContentProvider(uri.getAuthority(), 0);
    check(
        info != null && !info.exported && info.grantUriPermissions,
        "Unexpected provider visibility");
    ContentResolver resolver = app.getTargetContext().getContentResolver();
    try (InputStream in = resolver.openInputStream(uri);
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[4096];
      int size;
      while ((size = in.read(buffer)) != -1) out.write(buffer, 0, size);
      byte[] image = out.toByteArray();
      byte[] expected =
          android.util.Base64.decode(
              src.substring(src.indexOf(',') + 1), android.util.Base64.DEFAULT);
      check(
          Arrays.equals(image, expected)
              && BitmapFactory.decodeByteArray(image, 0, image.length).getWidth() == 32,
          "Preview bytes differ from the attachment");
      check(
          !new String(image, StandardCharsets.ISO_8859_1).contains("private-gps-marker"),
          "JPEG comment escaped");
    }
    try (Cursor row =
        resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      check(
          row != null && row.moveToFirst() && "catch-photo.jpg".equals(row.getString(0)),
          "Private filename exposed");
    }
    app.js("document.querySelector('#back').click()");
    app.waitFor("document.querySelectorAll('[data-share-catch]').length===2");
    app.js("document.querySelectorAll('[data-share-catch]')[1].click()");
    app.waitFor(
        "document.querySelector('#card-text')?.textContent==='Perch' &&"
            + " !document.querySelector('#share-photo') && !document.querySelector('#card-options"
            + " input:checked')");
  }
}
