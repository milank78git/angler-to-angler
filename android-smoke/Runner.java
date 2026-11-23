package app.anglers.journal.smoke;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/** Exercises real UI entry points and WebView storage inside an installed APK with no network. */
public final class Runner extends Instrumentation {
  private Activity activity;
  private WebView web;
  private String scenario;

  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    scenario = args != null ? args.getString("scenario", "compact") : "compact";
    start();
  }

  /** Read the actual target APK so the UI assertions stay valid across releases. */
  String expectedVersionLabel() throws Exception {
    android.content.Context target = getTargetContext();
    android.content.pm.PackageInfo info =
        target.getPackageManager().getPackageInfo(target.getPackageName(), 0);
    String prefix = "compact".equals(scenario) ? "Pilot" : "Preview";
    return prefix + " " + info.versionName + " (" + info.getLongVersionCode() + ")";
  }

  private void launch() throws Exception {
    Intent i =
        new Intent(Intent.ACTION_MAIN)
            .setClassName(
                getTargetContext().getPackageName(), "app.anglers.journal.FishingActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    bindJournal(startActivitySync(i));
  }

  private void bindJournal(Activity journal) throws Exception {
    activity = journal;
    runOnMainSync(
        () ->
            web =
                (WebView) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0));
    waitFor("!!document.querySelector('[data-water]')");
    waitFor(
        "document.querySelector('#app-version').getBoundingClientRect().height > 0 && "
            + "document.querySelector('#app-version').textContent === "
            + org.json.JSONObject.quote(expectedVersionLabel()));
  }

  String js(String code) throws Exception {
    ArrayBlockingQueue<String> answer = new ArrayBlockingQueue<>(1);
    runOnMainSync(
        () ->
            web.evaluateJavascript(code, result -> answer.offer(result == null ? "null" : result)));
    String value = answer.poll(10, TimeUnit.SECONDS);
    if (value == null) throw new AssertionError("WebView did not respond");
    return value;
  }

  void waitFor(String expr) throws Exception {
    long stop = android.os.SystemClock.elapsedRealtime() + 20000;
    while (android.os.SystemClock.elapsedRealtime() < stop) {
      if ("true".equals(js(expr))) return;
      Thread.sleep(150);
    }
    throw new AssertionError(
        "Timed out: " + expr + "; page=" + js("document.body.innerText.slice(0,450)"));
  }

  void script(String name) throws Exception {
    try (java.io.BufferedReader source =
        new java.io.BufferedReader(
            new java.io.InputStreamReader(
                getContext().getAssets().open(name), java.nio.charset.StandardCharsets.UTF_8))) {
      js(source.lines().collect(java.util.stream.Collectors.joining("\n")));
    }
  }

  private void form(String code) throws Exception {
    js(code + "; document.querySelector('form button.primary').click()");
  }

  /**
   * Exercise rejection, retry, duplicate submission and native Back against a real WebView form.
   */
  private void saveTripWithRetry() throws Exception {
    script("trip-write.js");
    waitFor("!!window.writeProbe");
    form(
        "document.querySelector('#notes').value='Offline smoke test';"
            + "document.querySelector('#notes').dispatchEvent(new Event('input',{bubbles:true}))");
    waitFor(
        "!document.querySelector('#notice').hidden && !document.querySelector('form"
            + " button.primary').disabled && document.querySelector('#notes').value==='Offline"
            + " smoke test'");
    form("void 0");
    waitFor(
        "window.writeProbe.attempts===2 && document.querySelector('form"
            + " button.primary').disabled");
    js("document.querySelector('form').requestSubmit()");
    sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitFor("!!document.querySelector('#notes') && document.querySelector('#notes').disabled");
    js("window.writeProbe.resume()");
  }

  /**
   * Capture actual emulator pixels and check accessible labels, target sizes and viewport overflow.
   */
  void capture(String name) throws Exception {
    waitFor("document.documentElement.scrollWidth <= window.innerWidth + 1");
    waitFor(
        "Array.from(document.querySelectorAll('button')).filter(b=>b.offsetWidth).every(b=>b.offsetWidth>=48"
            + " && b.offsetHeight>=48 && (b.textContent.trim() || b.getAttribute('aria-label')))");
    waitFor(
        "Array.from(document.querySelectorAll('img[src]')).every(i=>i.complete &&"
            + " i.naturalWidth>0)");
    // DOM readiness precedes the emulator compositor. Wait for a test-only swatch to
    // appear, then disappear, before recording the unmodified screen.
    int[] origin = new int[2];
    runOnMainSync(() -> web.getLocationOnScreen(origin));
    double ratio = Double.parseDouble(js("window.devicePixelRatio"));
    int x = origin[0] + (int) Math.round(12 * ratio), y = origin[1] + (int) Math.round(12 * ratio);
    js(
        "(()=>{const el=document.createElement('div');el.id='capture-sync';const s=el.style;"
            + "s.position='fixed';s.left='4px';s.top='4px';s.width='16px';s.height='16px';s.zIndex='2147483647';s.backgroundColor='rgb(213,"
            + " 5, 235)';document.body.append(el)})()");
    frameAt(web, x, y, true).recycle();
    js("document.getElementById('capture-sync').remove()");
    saveScreenshot(name, frameAt(web, x, y, false));
  }

  /** Wait for the compositor to present this native page before saving its screenshot. */
  void captureAccount(Activity gate, String name) throws Exception {
    captureWindow(gate.findViewById(android.R.id.content), name);
  }

  /** The native overlay stays visible above a WebView modal, including its backdrop. */
  void captureWindow(android.view.View root, String name) throws Exception {
    android.graphics.drawable.ColorDrawable mark =
        new android.graphics.drawable.ColorDrawable(android.graphics.Color.rgb(213, 5, 235));
    int[] point = new int[2];
    runOnMainSync(
        () -> {
          root.getLocationOnScreen(point);
          int offsetX = root.getWidth() / 2;
          int offsetY = root.getHeight() / 4;
          mark.setBounds(offsetX, offsetY, offsetX + 16, offsetY + 16);
          point[0] += offsetX + 8;
          point[1] += offsetY + 8;
          root.getOverlay().add(mark);
        });
    try {
      frameAt(root, point[0], point[1], true).recycle();
    } finally {
      runOnMainSync(() -> root.getOverlay().remove(mark));
    }
    saveScreenshot(name, frameAt(root, point[0], point[1], false));
  }

  private android.graphics.Bitmap frameAt(
      android.view.View target, int x, int y, boolean swatchVisible) throws Exception {
    long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
    boolean checkedLauncher = false;
    do {
      runOnMainSync(target::postInvalidateOnAnimation);
      android.graphics.Bitmap frame = getUiAutomation().takeScreenshot();
      if (frame != null) {
        int pixel = frame.getPixel(x, y);
        boolean matches =
            Math.abs(android.graphics.Color.red(pixel) - 213) < 12
                && android.graphics.Color.green(pixel) < 18
                && Math.abs(android.graphics.Color.blue(pixel) - 235) < 12;
        if (matches == swatchVisible) return frame;
        frame.recycle();
      }
      if (!checkedLauncher && deadline - android.os.SystemClock.elapsedRealtime() < 12000) {
        checkedLauncher = true;
        dismissLauncherDialog();
      }
      Thread.sleep(120);
    } while (android.os.SystemClock.elapsedRealtime() < deadline);
    throw new AssertionError("Display did not reach the current UI frame");
  }

  /**
   * A stalled emulator launcher can cover the app during startup. Leave application errors visible.
   */
  private void dismissLauncherDialog() {
    android.view.accessibility.AccessibilityNodeInfo root =
        getUiAutomation().getRootInActiveWindow();
    if (root == null
        || !"android".contentEquals(String.valueOf(root.getPackageName()))
        || root.findAccessibilityNodeInfosByText("Pixel Launcher").isEmpty()) return;
    java.util.List<android.view.accessibility.AccessibilityNodeInfo> close =
        root.findAccessibilityNodeInfosByViewId("android:id/aerr_close");
    if (close.isEmpty()) close = root.findAccessibilityNodeInfosByText("Close app");
    if (close.size() == 1)
      close.get(0).performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
  }

  private void saveScreenshot(String name, android.graphics.Bitmap pixels) throws Exception {
    java.io.File dir = new java.io.File(getTargetContext().getExternalFilesDir(null), "ui");
    if (!dir.isDirectory() && !dir.mkdirs())
      throw new java.io.IOException("Screenshot directory unavailable");
    try (java.io.FileOutputStream out =
        new java.io.FileOutputStream(new java.io.File(dir, scenario + "-" + name + ".png"))) {
      if (!pixels.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out))
        throw new java.io.IOException("Screenshot compression failed");
    } finally {
      pixels.recycle();
    }
  }

  /**
   * Exercise a captured journal photo through the real WebView, native RPC bridge and withdrawal
   * UI.
   */
  private void checkEvidenceSubmission(AccountChecks accounts) throws Exception {
    js("document.querySelector('#tabtrips').click()");
    waitFor("!!document.querySelector('[data-trip]')");
    js("document.querySelector('[data-trip]').click()");
    waitFor("!!document.querySelector('[data-share-catch]')");
    script("capture-evidence.js");
    waitFor("window.evidenceSeeded===true || !!window.evidenceSeedError");
    if (!"true".equals(js("window.evidenceSeeded===true")))
      throw new AssertionError("Capture fixture failed: " + js("window.evidenceSeedError"));
    js("document.querySelector('#tabtrips').click()");
    waitFor("!!document.querySelector('[data-trip]')");
    js("document.querySelector('[data-trip]').click()");
    waitFor("!!document.querySelector('[data-verify-catch]')");
    if ("compact".equals(scenario)) js("document.querySelector('#theme').click()");
    js("document.querySelector('#delete').click()");
    waitFor("document.querySelector('#confirmation-accept').classList.contains('danger')");
    js("document.querySelector('#confirmation-cancel').click()");
    js("document.querySelector('#add').click()");
    waitFor("!!document.querySelector('#fish-name')");
    js(
        "const"
            + " field=document.querySelector('#fish-name');field.value='Draft';field.dispatchEvent(new"
            + " Event('input',{bubbles:true}))");
    sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitFor("document.querySelector('#confirmation').open");
    js("document.querySelector('#confirmation-cancel').click()");
    waitFor(
        "!document.querySelector('#confirmation').open &&"
            + " document.querySelector('#fish-name').value==='Draft'");
    sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitFor("document.querySelector('#confirmation').open");
    js("document.querySelector('#confirmation-accept').click()");
    waitFor("!!document.querySelector('[data-verify-catch]')");
    js("document.querySelector('[data-verify-catch]').click()");
    waitFor(
        "document.querySelector('#confirmation').open &&"
            + " !document.querySelector('#confirmation-catch').hidden");
    waitFor("document.querySelector('#confirmation-photo').naturalWidth > 0");
    captureAccount(activity, "review-consent");
    sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitFor(
        "!document.querySelector('#confirmation').open &&"
            + " !document.querySelector('[data-verify-catch]').disabled");
    js("document.querySelector('[data-verify-catch]').click()");
    waitFor("document.querySelector('#confirmation').open");
    js("document.querySelector('#confirmation-cancel').click()");
    waitFor("!document.querySelector('[data-verify-catch]').disabled");
    js("document.querySelector('[data-verify-catch]').click()");
    waitFor("document.querySelector('#confirmation').open");
    js("document.querySelector('#confirmation-accept').click()");
    waitFor("!!document.querySelector('[data-remove]') && !document.querySelector('#review')");
    boolean cs = !"wide".equals(scenario);
    String card = "document.querySelector('.profile-directory article')";
    waitFor(
        card
            + "?.querySelector('strong')?.textContent === "
            + org.json.JSONObject.quote(cs ? "Čeká na kontrolu" : "Awaiting review"));
    accounts.setPhotoReview("measured", 635);
    js("document.querySelector('#refresh-evidence').click()");
    waitFor(
        card
            + "?.textContent.includes("
            + org.json.JSONObject.quote(
                cs ? "Délka odečtená z míry · 63,5 cm" : "Length read from ruler · 63.5 cm")
            + ")");
    accounts.setPhotoReview("estimated", 650);
    js("document.querySelector('#refresh-evidence').click()");
    waitFor(
        card
            + "?.textContent.includes("
            + org.json.JSONObject.quote(
                cs
                    ? "Délka odhadnutá podle měřítka · 65 cm"
                    : "Length estimated from a reference · 65 cm")
            + ")");
    accounts.setPhotoReview("unverified", null);
    js("document.querySelector('#refresh-evidence').click()");
    waitFor(
        card
            + "?.querySelector('strong')?.textContent === "
            + org.json.JSONObject.quote(cs ? "Nedostatečný podklad" : "Insufficient evidence")
            + " && !"
            + card
            + ".textContent.includes(' cm')");
    js("document.querySelector('[data-remove]').click()");
    waitFor(
        "document.querySelector('#confirmation').open &&"
            + " document.querySelector('#confirmation-catch').hidden");
    js("document.querySelector('#confirmation-accept').click()");
    waitFor(
        "!!document.querySelector('#refresh-evidence') &&"
            + " !document.querySelector('[data-remove]')");
  }

  /**
   * Exercise the actual Android PIN UI, Keystore decryption and offline journal after process
   * death.
   */
  private void coldUnlock() throws Exception {
    android.content.Context ctx = getTargetContext();
    String envelope = ctx.getSharedPreferences("angler-account", 0).getString("deviceSession", "");
    if (envelope.isEmpty() || envelope.contains("fixture-"))
      throw new AssertionError("Missing sealed credential");
    ActivityMonitor journal = addMonitor("app.anglers.journal.FishingActivity", null, false);
    try {
      startActivitySync(
          new Intent(Intent.ACTION_MAIN)
              .setClassName(ctx.getPackageName(), "app.anglers.journal.AccountActivity")
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
      boolean shown = false;
      while (android.os.SystemClock.elapsedRealtime() < deadline) {
        android.view.accessibility.AccessibilityNodeInfo root =
            getUiAutomation().getRootInActiveWindow();
        if (root != null
            && ("com.android.systemui".contentEquals(String.valueOf(root.getPackageName()))
                || "com.android.settings".contentEquals(String.valueOf(root.getPackageName())))) {
          shown = true;
          break;
        }
        Thread.sleep(120);
      }
      if (!shown || journal.getHits() != 0)
        throw new AssertionError("OS credential screen required");
      Thread.sleep(500);
      try (android.os.ParcelFileDescriptor command =
              getUiAutomation().executeShellCommand("input text 482619");
          java.io.InputStream result =
              new android.os.ParcelFileDescriptor.AutoCloseInputStream(command)) {
        while (result.read() != -1) {}
      }
      try (android.os.ParcelFileDescriptor command =
              getUiAutomation().executeShellCommand("input keyevent KEYCODE_ENTER");
          java.io.InputStream result =
              new android.os.ParcelFileDescriptor.AutoCloseInputStream(command)) {
        while (result.read() != -1) {}
      }
      Activity restored = waitForMonitorWithTimeout(journal, 15000);
      if (restored == null) throw new AssertionError("PIN did not unlock the offline journal");
      bindJournal(restored);
      js("document.querySelector('#tabtrips').click()");
      waitFor("document.querySelectorAll('[data-trip]').length===1");
    } finally {
      removeMonitor(journal);
    }
  }

  @Override
  public void onStart() {
    Bundle outcome = new Bundle();
    try {
      if ("unlock".equals(scenario)) {
        coldUnlock();
        outcome.putString("stream", "ANGLER_UNLOCK_PASS\n");
        finish(Activity.RESULT_OK, outcome);
        return;
      }
      AccountChecks accounts = new AccountChecks(this, !"wide".equals(scenario));
      bindJournal(accounts.register());
      bindJournal(accounts.groups());
      if ("compact".equals(scenario)) {
        waitFor("document.documentElement.dataset.theme === 'dark'");
        js("document.querySelector('#theme').click()");
      }
      waitFor("document.documentElement.lang==='" + ("wide".equals(scenario) ? "en" : "cs") + "'");
      waitFor(
          "getComputedStyle(document.querySelector('#tabs')).flexDirection==='"
              + ("wide".equals(scenario) ? "column" : "row")
              + "'");
      capture("atlas");
      runOnMainSync(() -> web.getSettings().setTextZoom(200));
      waitFor("document.documentElement.scrollWidth<=window.innerWidth+1");
      runOnMainSync(() -> web.getSettings().setTextZoom(100));
      js(
          "document.querySelector('[data-favorite]').click();document.getElementById('saved').click()");
      waitFor("document.querySelectorAll('[data-water]').length===1");
      js("document.querySelector('#tabrules').click()");
      waitFor(
          "!!document.querySelector('#rule-water') &&"
              + " !document.querySelector('#rule-water').disabled");
      js("document.querySelector('#theme').click()");
      waitFor("document.documentElement.dataset.theme==='dark'");
      capture("seasons");
      js("document.querySelector('#theme').click();document.querySelector('#tabwaters').click()");
      waitFor("document.querySelector('#saved').getAttribute('aria-pressed')==='true'");
      js("document.querySelector('#all').click()");
      js(
          "document.getElementById('search').value='401 009';"
              + " document.getElementById('search').dispatchEvent(new Event('input'))");
      waitFor("document.querySelectorAll('[data-water]').length===1");
      js("document.querySelector('[data-water]').click()");
      waitFor("!!document.querySelector('#navigate')");
      capture("water");
      js("document.querySelector('#open-rules').click()");
      waitFor("document.querySelector('#rule-water').disabled");
      js(
          "document.querySelector('#rule-date').value='2026-06-15';document.querySelector('#rule-date').dispatchEvent(new"
              + " Event('change'))");
      waitFor("!!document.querySelector('.result.closed')");
      sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
      waitFor("!!document.querySelector('#new-trip')");
      js("document.querySelector('#new-trip').click()");
      waitFor("!!document.querySelector('#notes')");
      saveTripWithRetry();
      waitFor(
          "!!document.querySelector('#add') && document.querySelectorAll('#catch-list"
              + " article').length===0");
      ShareChecks.tripTip(this);
      for (int n = 1; n <= 2; n++) {
        js("document.querySelector('#add').click()");
        waitFor("!!document.querySelector('#fish-name')");
        waitFor(
            "document.querySelector('#position-fields').open===false &&"
                + " document.querySelector('#tabs').hidden");
        if (n == 1) {
          capture("catch");
          form(
              "document.querySelector('#fish-name').value='Perch';document.querySelector('#length').value='0x20'");
          waitFor(
              "document.activeElement.id==='length' &&"
                  + " !document.querySelector('#form-error').hidden");
          form(
              "document.querySelector('#length').value='32.5';document.querySelector('#lat').value='2';document.querySelector('#lon').value='181'");
          waitFor(
              "document.activeElement.id==='lon' &&"
                  + " document.querySelector('#position-fields').open");
          js("window.positionResult(123456,{lat:10,lon:20,time:1,accuracy:5})");
          waitFor(
              "document.querySelector('#lat').value==='2' &&"
                  + " document.querySelector('#lon').value==='181'");
          js(
              "const"
                  + " canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;canvas.toBlob(blob=>{const"
                  + " files=new DataTransfer();files.items.add(new"
                  + " File([blob],'catch.png',{type:'image/png'}));document.querySelector('#photo').files=files.files;});");
          waitFor("document.querySelector('#photo').files.length===1");
        }
        form(
            "document.querySelector('#bait').value='spinner';document.querySelector('#technique').value='jigging';document.querySelector('#position-fields').open=true;document.querySelector('#fish-name').value='Perch';document.querySelector('#length').value='32.5';document.querySelector('#lat').value='-40';document.querySelector('#lon').value='0'");
        waitFor("document.querySelectorAll('#catch-list article').length===" + n);
      }
      runOnMainSync(() -> activity.finish());
      waitForIdleSync();
      launch();
      js("document.querySelector('#tabtrips').click()");
      waitFor("document.querySelectorAll('[data-trip]').length===1");
      capture("journal");
      js("document.querySelector('[data-trip]').click()");
      waitFor("document.querySelectorAll('#catch-list article').length===2");
      waitFor(
          "!!document.querySelector('#catch-list img') && document.querySelector('#catch-list"
              + " img').naturalWidth===32");
      ShareChecks.run(this);
      checkEvidenceSubmission(accounts);
      outcome.putString("stream", "ANGLER_SMOKE_PASS\n");
      finish(Activity.RESULT_OK, outcome);
    } catch (Throwable error) {
      try {
        saveScreenshot("failure", getUiAutomation().takeScreenshot());
      } catch (Exception captureError) {
        error.addSuppressed(captureError);
      }
      outcome.putString(
          "stream", "ANGLER_SMOKE_FAIL " + android.util.Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, outcome);
    }
  }
}
