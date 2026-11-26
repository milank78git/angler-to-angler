package app.anglers.journal.smoke;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
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

  private org.json.JSONObject targetAsset(String name) {
    try (java.io.InputStream in = getTargetContext().getAssets().open(name);
        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(
            in, java.nio.charset.StandardCharsets.UTF_8))) {
      return new org.json.JSONObject(reader.lines().collect(java.util.stream.Collectors.joining("\n")));
    } catch (Exception error) {
      throw new AssertionError("Could not read target asset " + name, error);
    }
  }

  private org.json.JSONObject labels;

  String label(String key) {
    if (labels == null) {
      labels = targetAsset("strings-" + ("wide".equals(scenario) ? "en" : "cs") + ".json");
    }
    try {
      return labels.getString(key);
    } catch (org.json.JSONException missing) {
      throw new AssertionError("Missing expected label " + key, missing);
    }
  }

  String waterName(String id) {
    try {
      org.json.JSONArray waters = targetAsset("catalog.json").getJSONArray("waters");
      for (int i = 0; i < waters.length(); i++) {
        org.json.JSONObject water = waters.getJSONObject(i);
        if (water.getString("id").equals(id)) return water.getString("name");
      }
    } catch (org.json.JSONException invalid) {
      throw new AssertionError(invalid);
    }
    throw new AssertionError("Missing official water " + id);
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

  int textZoom() {
    int[] scale = new int[1];
    runOnMainSync(() -> scale[0] = web.getSettings().getTextZoom());
    return scale[0];
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

  /** Wait for the destination's async render before sending an event to one of its controls. */
  private String readyControl(String selector) throws Exception {
    String el = "document.querySelector(" + org.json.JSONObject.quote(selector) + ")";
    waitFor(
        "!!"
            + el
            + " && !"
            + el
            + ".disabled && "
            + el
            + ".getClientRects().length>0 &&"
            + " document.querySelector('#screen').getAttribute('aria-busy')!=='true'");
    return el;
  }

  void clickReady(String selector) throws Exception {
    js(readyControl(selector) + ".click()");
  }

  /** Check the actual one-shot OS request on the phone, and the skip path on the wide layout. */
  private void checkAtlasLocationOffer() throws Exception {
    waitFor("!!document.querySelector('#atlas-location-use') && !document.querySelector('#atlas-location-offer').hidden");
    String initialCountry = js("document.querySelector('#water-country').value");
    if ("compact".equals(scenario)) {
      android.accessibilityservice.AccessibilityServiceInfo info = getUiAutomation().getServiceInfo();
      info.flags |= android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
      getUiAutomation().setServiceInfo(info);
      clickReady("#atlas-location-use");
      boolean denied = false;
      long end = android.os.SystemClock.elapsedRealtime() + 10000;
      while (!denied && android.os.SystemClock.elapsedRealtime() < end) {
        android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
        if (root != null && root.getPackageName() != null && root.getPackageName().toString().endsWith("permissioncontroller")) {
          for (String pkg : new String[] {root.getPackageName().toString(), "com.android.permissioncontroller"}) {
            for (android.view.accessibility.AccessibilityNodeInfo node :
                root.findAccessibilityNodeInfosByViewId(pkg + ":id/permission_deny_button")) {
              denied = node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
              if (denied) break;
            }
            if (denied) break;
          }
        }
        if (!denied) Thread.sleep(100);
      }
      if (!denied) throw new AssertionError("Missing location permission dialog");
      waitFor("!document.querySelector('#atlas-locate-country').disabled && document.querySelector('#nearby-status').textContent.length>0");
    } else {
      clickReady("#atlas-location-skip");
    }
    waitFor("document.querySelector('#water-country').value===" + initialCountry);
    clickReady("#tabwaters");
    waitFor("!document.querySelector('#atlas-location-offer') && !!document.querySelector('[data-water]')");
  }

  /** Type into the lookup without opening its select or dismissing the Android keyboard. */
  private void checkLiveRuleSearch() throws Exception {
    js("document.querySelector('#rule-water-search').focus()");
    setControl("#rule-water-search", "Lipno", "input");
    String lipnoKey = "CZ:CRS:4615686";
    String lipnoRow = "#rule-water-suggestions [data-key='" + lipnoKey + "']";
    waitFor("document.querySelector('#rule-water-search').getAttribute('aria-expanded')==='true'"
        + " && document.querySelector(\"" + lipnoRow + "\")?.textContent.includes('421 200')"
        + " && !document.querySelector('#section') && !document.querySelector('#watch-toggle')");
    clickReady(lipnoRow);
    waitFor("document.querySelector('#rule-water').value==='" + lipnoKey + "'"
        + " && document.querySelector('#rule-water-suggestions').hidden"
        + " && document.querySelector('#status a[href*=\"karta-reviru\"]')?.textContent.includes('LIPNO')");
    js("document.querySelector('#rule-water-search').focus()");
    setControl("#rule-water-search", "461 024", "input");
    waitFor("document.querySelector('#rule-water').value==='CZ:MRS:1'"
        + " && !!document.querySelector('#status a[href=\"https://mrsbrno.cz/reviry/1\"]')"
        + " && document.activeElement.id==='rule-water-search'");
    setControl("#rule-water-search", "401", "input");
    waitFor("document.querySelector('#rule-water').options.length>2 && document.querySelector('#rule-water').value===''"
        + " && document.querySelector('#status').textContent==='' && !document.querySelector('#watch-toggle')");
    clickReady("#rule-water-suggestions [data-key='CZ:401009']");
    waitFor("document.querySelector('#rule-water').value==='CZ:401009' && !!document.querySelector('#section')");
    setControl("#rule-water-search", "000 000 000", "input");
    waitFor("!document.querySelector('#rule-water-empty').hidden && document.querySelector('#rule-fields').textContent===''");
    setControl("#rule-water-search", "401009", "input");
    waitFor("document.querySelector('#rule-water').value==='CZ:401009' && !!document.querySelector('#section')");
    setControl("#rule-water-search", "", "input");
  }

  /** Exercise combined parking filters and route to the second car park on a catalog water. */
  private void checkParkingFilter() throws Exception {
    setControl("#search", "", "input");
    clickReady("#water-parking");
    waitFor("!!document.querySelector('[data-water=\"CZ:CRS:4615396\"]')"
        + " && !!document.querySelector('[data-water=\"401009\"]')");
    setControl("#water-country", "US", "change");
    waitFor("document.querySelectorAll('[data-water]').length===0");
    clickReady("#map-toggle");
    waitFor("document.querySelector('#map-count')?.textContent.includes('0 / 0')");
    setControl("#water-country", "CZ", "change");
    setControl("#search", "421 200", "input");
    waitFor("document.querySelectorAll('#world-map [data-group]').length===1"
        + " && document.querySelector('#map-count').textContent.includes('1 / 1')"
        + " && !document.querySelector('#waters img')");
    waitFor("!!document.querySelector('#map-tiles image[href*=\"tile.openmaps.fr/opentopomap/\"]')");
    clickReady("#map-online");
    waitFor("!document.querySelector('#map-tiles image') && !!document.querySelector('#map-markers [data-group]')");
    clickReady("#zoom-in");
    waitFor("!!document.querySelector('#map-shapes path') || !!document.querySelector('#map-markers [data-group]')");
    clickReady("#map-fit");
    clickReady("#map-online");
    js("document.querySelector('#world-map [data-group]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    waitFor("!!document.querySelector('#drive-1')");
    waitFor("document.querySelector('#water-photo img[src=\"water-lipno.webp\"]')?.naturalWidth > 0"
        + " && !!document.querySelector('#water-photo figcaption a[href*=\"commons.wikimedia.org\"]')"
        + " && document.querySelector('#water-photo-file')?.disabled === false");
    ShareChecks.parking(this, "#drive-1", "48.6594239,14.1710583");
    clickReady("#parking-add");
    waitFor("!!document.querySelector('#world-map') && document.querySelector('#parking-confirm').disabled");
    js("document.querySelector('#world-map').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    clickReady("#parking-confirm");
    waitFor("document.querySelector('#confirmation').open && document.querySelector('#parking-name').value===''"
        + " && document.querySelector('#confirmation-message').textContent.includes(" + org.json.JSONObject.quote(label("parking.point")) + ")"
        + " && document.querySelector('#parking-coordinates').textContent.includes(',')");
    clickReady("#confirmation-cancel");
    clickReady("#back");
    clickReady("#confirmation-accept");
    waitFor("!!document.querySelector('#parking-add') && !!document.querySelector('#drive-1')");
    clickReady("#back");
    waitFor("document.querySelector('#water-parking')?.checked && document.querySelector('#search').value==='421 200'"
        + " && document.querySelector('#map-toggle').getAttribute('aria-pressed')==='true'");
    clickReady("#map-toggle");
    clickReady("#water-parking");
    setControl("#search", "461 024", "input");
    waitFor("!!document.querySelector('[data-water=\"CZ:MRS:1\"]')");
  }

  void setControl(String selector, String value, String event) throws Exception {
    String el = readyControl(selector);
    js("(() => { const field=" + el + "; field.value=" + org.json.JSONObject.quote(value)
        + "; field.dispatchEvent(new Event(" + org.json.JSONObject.quote(event) + ",{bubbles:true})); })()");
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

  /** Keep the accepted write visible when the first count refresh fails on an imported water. */
  private void checkWaterReport() throws Exception {
    setControl("#search", "401 024", "input");
    clickReady("[data-water='CZ:CRS:4615417']");
    String action = "button[aria-describedby='report-low_water']";
    String status = "document.querySelector('#water-reports [role=status]').textContent";
    clickReady(action);
    clickReady("#confirmation-cancel");
    clickReady(action);
    clickReady("#confirmation-accept");
    String receipt = org.json.JSONObject.quote(label("water_reports.recorded"));
    waitFor(status + ".includes(" + receipt + ") && " + status + ".includes("
        + org.json.JSONObject.quote(label("water_reports.reports_could_not_be_loaded")) + ")");
    clickReady("#water-reports [role=status] + button");
    waitFor(status + "===" + receipt + " && document.querySelector('#report-low_water').textContent.endsWith('(1)')");
    clickReady(action);
    clickReady("#confirmation-accept");
    waitFor(status + "===" + org.json.JSONObject.quote(label("water_reports.withdrawn"))
        + " && document.querySelector('#report-low_water').textContent.endsWith('(0)')");
    clickReady("#back");
  }

  private void form(String code) throws Exception {
    js(code + "; document.querySelector('form button.primary').click()");
  }

  /**
   * Exercise rejection, retry, duplicate submission and native Back against a real WebView form.
   */
  private void checkCatchSpecies() throws Exception {
    waitFor("document.querySelector('#catch-country-scope').value==='CZ'");
    String marineFish = "Alepocephalus agassizii";
    setControl("#catch-search", marineFish, "input");
    waitFor("document.querySelector('#fish').options.length===2");
    setControl("#catch-country-scope", "", "change");
    setControl("#fish", marineFish, "change");
    waitFor("document.querySelector('#fish').value==='Alepocephalus agassizii'");
    setControl("#catch-country-scope", "CZ", "change");
    waitFor("document.querySelector('#fish').value==='' && document.querySelector('#catch-rules').hidden");
    setControl("#catch-search", "Esox", "input");
    setControl("#fish", "Esox lucius", "change");
    setControl("#catch-length", "50", "input");
    clickReady("#catch-rules summary");
    waitFor("!!document.querySelector('#catch-rule-body .result') && !!document.querySelector('#catch-rule-body a[href]')");
    clickReady("#catch-rules summary");
    waitFor("document.querySelector('#catch-length').value==='50' && document.querySelector('#fish').value==='Esox lucius'");
    setControl("#catch-search", "", "input");
  }

  /** An unresolved search cannot save the old water. A private name can be saved and found offline. */
  private void checkPrivateWaterName() throws Exception {
    setControl("#water-search", "Lipno", "input");
    waitFor("!document.querySelector('#form').checkValidity() && document.querySelector('#water').value===''");
    setControl("#water-search", "", "input");
    waitFor("document.querySelector('#water').value==='IE:IFI:1'");
    setControl("#water-search", "Private fixture pond", "input");
    clickReady("#use-water-name");
    waitFor("document.querySelector('#water-name').value==='Private fixture pond' && document.querySelector('#form').checkValidity()");
    clickReady("#form .savebar button");
    waitFor("document.querySelector('h1').textContent==='Private fixture pond' && !document.querySelector('#trip-rules')");
    clickReady("#back");
    setControl("#trip-search", "fixture pond", "input");
    clickReady("[data-trip]");
    waitFor("document.querySelector('h1').textContent==='Private fixture pond'");
    clickReady("#back");
    waitFor("document.querySelector('#trip-search')?.value==='fixture pond'");
    clickReady("[data-trip]");
    clickReady("#delete");
    clickReady("#confirmation-accept");
    waitFor("!!document.querySelector('#add-trip') && !document.querySelector('[data-trip]')");
  }

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
    // Returning from the home market restores the journal's public-card screen. Reselect its tab for the trip list.
    clickReady("#tabtrips");
    waitFor("document.querySelector('#screen').dataset.page==='myPublicCards'");
    clickReady("#tabtrips");
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
    setControl("#fish", "manual", "change");
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
            + org.json.JSONObject.quote(label("verification.awaiting_review")));
    accounts.setPhotoReview("measured", 635);
    js("document.querySelector('#refresh-evidence').click()");
    waitFor(
        card
            + "?.textContent.includes("
            + org.json.JSONObject.quote(
                label("verification.length_read_from_ruler") + (cs ? " · 63,5 cm" : " · 63.5 cm"))
            + ")");
    accounts.setPhotoReview("estimated", 650);
    js("document.querySelector('#refresh-evidence').click()");
    waitFor(
        card
            + "?.textContent.includes("
            + org.json.JSONObject.quote(
                label("verification.length_estimated_from_a_reference") + " · 65 cm")
            + ")");
    accounts.setPhotoReview("unverified", null);
    js("document.querySelector('#refresh-evidence').click()");
    waitFor(
        card
            + "?.querySelector('strong')?.textContent === "
            + org.json.JSONObject.quote(label("verification.insufficient_evidence"))
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

  private void reportStep(String name) {
    Bundle update = new Bundle();
    update.putString("stream", scenario + " · " + name + "\n");
    sendStatus(0, update);
  }

  private void verifyLanguagePicker(AccountChecks accounts) throws Exception {
    clickReady("#tabwaters");
    if (!"true".equals(js("!!document.querySelector('#atlas-settings')"))) clickReady("#tabwaters");
    clickReady("#atlas-settings");
    android.app.LocaleManager manager = getTargetContext().getSystemService(android.app.LocaleManager.class);
    java.util.Locale original = manager.getApplicationLocales().get(0);
    java.util.Locale german = java.util.Locale.GERMAN;
    String germanName = german.getDisplayName(german);
    org.json.JSONObject de = targetAsset("strings-de.json");
    reportStep("Choose German");
    accounts.pickLanguage(label("settings.language")+" · "+original.getDisplayName(original), germanName);
    accounts.click(de.getString("common.back"));
    bindVisibleWeb();
    waitFor("document.documentElement.lang==='de' && document.querySelector('#profile')?.textContent === "
        + org.json.JSONObject.quote(de.getString("profile.title")));
    clickReady("#atlas-settings");
    reportStep("Restore the phone language");
    accounts.pickLanguage(de.getString("settings.language")+" · "+germanName, de.getString("settings.language_system"));
    long limit = android.os.SystemClock.elapsedRealtime()+8000;
    while (!manager.getApplicationLocales().isEmpty() && android.os.SystemClock.elapsedRealtime()<limit) Thread.sleep(100);
    if (!manager.getApplicationLocales().isEmpty()) throw new AssertionError("System language was not restored");
    accounts.click(label("common.back"));
    bindVisibleWeb();
    waitFor("document.documentElement.lang==='en' && !!document.querySelector('[data-water]')"
        + " && document.querySelector('#profile')?.textContent === " + org.json.JSONObject.quote(label("profile.title")));
  }

  /** A framework locale change can recreate both the settings and the background fishing activity. */
  private void bindVisibleWeb() throws Exception {
    long limit = android.os.SystemClock.elapsedRealtime()+10000;
    do {
      WebView[] visible = {null};
      runOnMainSync(() -> {
        for (View root : android.view.inspector.WindowInspector.getGlobalWindowViews()) {
          ViewGroup content = root.findViewById(android.R.id.content);
          if (root.hasWindowFocus() && content != null && content.getChildAt(0) instanceof WebView)
            visible[0]=(WebView)content.getChildAt(0);
        }
      });
      if (visible[0]!=null) { web=visible[0]; return; }
      Thread.sleep(100);
    } while (android.os.SystemClock.elapsedRealtime()<limit);
    throw new AssertionError("Translated journal not visible");
  }

  /** The alarm must advance an expired lease's watch even when the next date is months away. */
  private void expiredSeasonWatch() throws Exception {
    android.content.Context target = getTargetContext();
    android.content.Context isolated = new android.content.ContextWrapper(target) {
      @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
        return super.getSharedPreferences("test-season-" + name, mode);
      }
    };
    android.content.SharedPreferences account = isolated.getSharedPreferences("angler-account", 0);
    android.content.SharedPreferences watches = isolated.getSharedPreferences("season-watches", 0);
    org.json.JSONObject pack = targetAsset("catalog.json");
    String key = pack.getString("id") + "/" + pack.getJSONArray("waters").getJSONObject(0).getString("id") + "/pike";
    account.edit().putString("subject","fixture").putLong("verified", 1L).apply();
    watches.edit().putLong(key, 1L).apply();
    android.content.BroadcastReceiver receiver = (android.content.BroadcastReceiver)
        target.getClassLoader().loadClass("app.anglers.journal.SeasonReminder").getDeclaredConstructor().newInstance();
    try {
      receiver.onReceive(isolated, new Intent("app.anglers.journal.SEASON").putExtra("key",key).putExtra("due",1L));
      long next = watches.getLong(key, 0L);
      if (next != 0 && next <= System.currentTimeMillis()) throw new AssertionError("Expired lease stopped season watch");
      // A finite pack has no subsequent alarm after its last review date.
      if (next > 0) {
        Intent alarm = new Intent(isolated, receiver.getClass()).setAction("app.anglers.journal.SEASON")
            .setData(android.net.Uri.parse("angler:season/" + android.net.Uri.encode(key)));
        android.app.PendingIntent pending = android.app.PendingIntent.getBroadcast(isolated, 0, alarm,
            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_NO_CREATE);
        if (pending == null) throw new AssertionError("Season watch did not schedule the next alarm");
        isolated.getSystemService(android.app.AlarmManager.class).cancel(pending);
      }
    } finally {
      watches.edit().clear().apply();
      account.edit().clear().apply();
    }
  }

  /** Observe real Android notifications, including dismissal and the next day's delivery. */
  private void genericSeasonPrompt() throws Exception {
    android.content.Context target = getTargetContext();
    android.app.NotificationManager manager = target.getSystemService(android.app.NotificationManager.class);
    android.content.SharedPreferences state = target.getSharedPreferences("season-alerts", 0);
    java.lang.reflect.Method post = target.getClassLoader().loadClass("app.anglers.journal.SeasonReminder")
        .getDeclaredMethod("postGeneric", android.content.Context.class, java.time.LocalDate.class);
    post.setAccessible(true);
    java.time.LocalDate today = java.time.LocalDate.now();
    state.edit().clear().commit();
    try {
      post.invoke(null, target, today);
      waitForGenericSeason(manager, true);
      manager.cancel("season-generic", 1);
      waitForGenericSeason(manager, false);
      post.invoke(null, target, today);
      // Give the notification service time to process a mistakenly repeated post.
      android.os.SystemClock.sleep(350);
      waitForGenericSeason(manager, false);
      post.invoke(null, target, today.plusDays(1));
      waitForGenericSeason(manager, true);
    } finally {
      manager.cancel("season-generic", 1);
      state.edit().clear().commit();
    }
  }

  private static void waitForGenericSeason(android.app.NotificationManager manager, boolean expected) {
    long deadline = android.os.SystemClock.elapsedRealtime() + 3000;
    do {
      boolean present = false;
      for (android.service.notification.StatusBarNotification entry : manager.getActiveNotifications())
        if ("season-generic".equals(entry.getTag())) present = true;
      if (present == expected) return;
      android.os.SystemClock.sleep(50);
    } while (android.os.SystemClock.elapsedRealtime() < deadline);
    throw new AssertionError("Unexpected generic season notification state: " + expected);
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
      if ("season".equals(scenario)) {
        genericSeasonPrompt();
        outcome.putString("stream", "ANGLER_SEASON_PASS\n");
        finish(Activity.RESULT_OK, outcome);
        return;
      }
      expiredSeasonWatch();
      AccountChecks accounts = new AccountChecks(this, !"wide".equals(scenario));
      bindJournal(accounts.register());
      checkAtlasLocationOffer();
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
      waitFor("!document.querySelector('#waters img') && !document.querySelector('.atlas-hero')"
          + " && !['401001','401009'].includes(document.querySelector('[data-water]').dataset.water)");
      capture("atlas");
      // Exercise the packaged guide and country rules through the same entry points as an angler.
      clickReady("#home-fish");
      setControl("#fish-country", "CZ", "change");
      setControl("#fish-query", "Alburnus alburnus", "input");
      waitFor("(() => {const label=document.querySelector('#fish-results button')?.textContent;"
          + "return !!label && label[0]===label[0].toLocaleUpperCase() && label.includes('Alburnus alburnus')})()");
      setControl("#fish-query", "Alepocephalus agassizii", "input");
      waitFor("document.querySelector('#fish-results').childElementCount===0");
      clickReady("label[for=fish-query] + .field-hint");
      waitFor("document.querySelector('#guide-title').textContent===document.querySelector('label[for=fish-query]').textContent"
          + " && !!document.querySelector('#guide-body > p') && !document.querySelector('#guide-body ol')");
      clickReady("#guide-body button");
      waitFor("!!document.querySelector('#guide-body ol')");
      clickReady("#guide-close");
      waitFor("document.querySelector('#fish-query').value==='Alepocephalus agassizii'");
      setControl("#fish-query", "Oncorhynchus mykiss", "input");
      clickReady("#fish-results button");
      waitFor("!!document.querySelector('#fish-size article a') && !document.querySelector('#water-wide-rules')");
      setControl("#fish-water-class","cztrout","change");
      waitFor("!!document.querySelector('#water-wide-rules') && !document.querySelector('#species-restrictions article')"
          + " && document.querySelector('#fish-size').textContent.includes('25 cm') && !!document.querySelector('#report-fish')");
      android.content.Intent report = ShareChecks.outgoing(this,"#report-fish");
      String draft = android.net.Uri.decode(report.getDataString());
      if (!android.content.Intent.ACTION_SENDTO.equals(report.getAction()) || !draft.startsWith("mailto:info@horistum.com?")
          || !draft.contains("Oncorhynchus mykiss") || !draft.contains("25 cm")) throw new AssertionError("Incomplete fish report");
      capture("trout-rules");
      clickReady("#back");
      setControl("#fish-query", "Esox lucius", "input");
      clickReady("#fish-results button");
      waitFor("!!document.querySelector('#rule-country')");
      setControl("#rule-country", "IE", "change");
      waitFor("!!document.querySelector('#fish-rules article a')");
      clickReady("#guide-open");
      waitFor("document.querySelector('#guide-dialog').open");
      clickReady("#guide-close");
      clickReady("#tabwaters");
      // Follow an imported fishery through country filtering, official details and restored atlas state.
      accounts.atlasSettings();
      reportStep("Save and clear a fishing licence");
      accounts.fishingLicence();
      reportStep("Fishing licence verified");
      js("if(document.querySelector('#atlas-filters').hidden)document.querySelector('#atlas-filter-toggle').click()");
      setControl("#water-country", "IE", "change");
      setControl("#search", "Atlas fixture water", "input");
      clickReady("[data-water='IE:IFI:1']");
      waitFor("document.querySelector('h1').textContent==='Atlas fixture water'");
      waitFor("!!document.querySelector('#atlas-map-open svg')");
      android.content.Intent map = ShareChecks.outgoing(this,"#atlas-map-open");
      if (!android.content.Intent.ACTION_VIEW.equals(map.getAction()) || !"geo".equals(map.getData().getScheme()))
        throw new AssertionError("Water map did not open an Android map target");
      clickReady("#new-trip");
      waitFor("document.querySelector('#water').value==='IE:IFI:1' && document.querySelector('#custom').hidden");
      clickReady("#back");
      clickReady("#open-rules");
      waitFor("document.querySelector('#rule-water').value==='IE:IFI:1' && !!document.querySelector('.result.unknown a')"
          + " && !document.querySelector('#watch-toggle')");
      clickReady("#water-fish-rules");
      waitFor("document.querySelector('#fish-country').value==='IE'");
      clickReady("#back");
      clickReady("#back");
      clickReady("#back");
      clickReady("#tabtrips");
      clickReady("#add-trip");
      setControl("#water-search", "Atlas fixture water", "input");
      clickReady("#water-suggestions [data-key='IE:IFI:1']");
      waitFor("document.querySelector('#water').selectedOptions[0].textContent.includes('Atlas fixture water')"
          + " && document.querySelector('#custom').hidden");
      checkPrivateWaterName();
      clickReady("#tabwaters");
      setControl("#search", "", "input");
      setControl("#water-country", "PL", "change");
      waitFor("document.querySelectorAll('[data-water]').length===0 && !!document.querySelector('#water-coverage a')");
      setControl("#water-country", "CZ", "change");
      setControl("#search", "461 024", "input");
      clickReady("[data-water='CZ:MRS:1']");
      waitFor("!!document.querySelector(\"a[href='https://mrsbrno.cz/reviry/1']\")"
          + " && !!document.querySelector('#water-reports')");
      clickReady("#open-rules");
      setControl("#lookup-species", "Esox lucius", "change");
      setControl("#rule-date", "2027-01-01", "change");
      waitFor("!!document.querySelector('#lookup-closure [data-rule-status=closed]')"
          + " && document.querySelector('#lookup-size').textContent.includes('50 cm') && !document.querySelector('#lookup-water')");
      setControl("#rule-date", "2027-12-01", "change");
      waitFor("!!document.querySelector('#lookup-size [data-rule-status=unverified]')"
          + " && !document.querySelector('#lookup-size').textContent.includes('50 cm')");
      clickReady("#back");
      clickReady("#back");
      waitFor("document.querySelector('#search').value==='461 024'");
      checkWaterReport();
      checkParkingFilter();
      setControl("#water-country", "US", "change");
      waitFor("document.querySelectorAll('[data-water]').length===0");
      setControl("#search", "", "input");
      waitFor("document.querySelectorAll('[data-water]').length===3");
      setControl("#water-country", "", "change");
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
      checkLiveRuleSearch();
      js("(() => { const water=document.querySelector('#rule-water'); water.selectedIndex=water.selectedIndex===0?1:0; water.dispatchEvent(new Event('change')); })()");
      waitFor("!!document.querySelector('label[for=rule-water] + .field-hint') && document.activeElement.id==='rule-water'");
      capture("seasons");
      js("document.querySelector('#theme').click();document.querySelector('#tabwaters').click()");
      waitFor("document.querySelector('#saved').getAttribute('aria-pressed')==='true'");
      js("document.querySelector('#all-waters').click()");
      js(
          "document.getElementById('search').value='401 009';"
              + " document.getElementById('search').dispatchEvent(new Event('input'))");
      waitFor("document.querySelectorAll('[data-water]').length===1");
      clickReady("#map-toggle");
      waitFor("document.querySelectorAll('#world-map [data-group]').length===1");
      js("document.querySelector('#world-map [data-group]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
      waitFor("!!document.querySelector('#navigate')");
      ShareChecks.parking(this, "#drive-0", "49.8770658,14.4263203");
      clickReady("#back");
      waitFor("document.querySelector('#map-toggle')?.getAttribute('aria-pressed')==='true'");
      clickReady("#map-toggle");
      waitFor("document.querySelectorAll('[data-water]').length===1");
      clickReady("[data-water]");
      waitFor("!!document.querySelector('#drive-0') && !!document.querySelector('#water-rating')");
      capture("water");
      DiscussionChecks.run(this);
      ActivityChecks.report(this);
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
      clickReady("#trip-rules");
      waitFor("document.querySelector('#rule-water').value==='CZ:401009' && !!document.querySelector('#rule-date')");
      clickReady("#back");
      ActivityChecks.contribute(this);
      String postedTip = ShareChecks.tripTip(this);
      for (int n = 1; n <= 2; n++) {
        js("document.querySelector('#add').click()");
        waitFor("!!document.querySelector('#fish-name')");
        waitFor(
            "document.querySelector('#position-fields').open===false &&"
                + " document.querySelector('#tabs').hidden");
        if (n == 1) {
          capture("catch");
          checkCatchSpecies();
        }
        setControl("#fish", "manual", "change");
        if (n == 1) {
          form(
              "document.querySelector('#fish-name').value='Perch';document.querySelector('#catch-length').value='0x20'");
          waitFor(
              "document.activeElement.id==='catch-length' &&"
                  + " !document.querySelector('#form-error').hidden");
          form(
              "document.querySelector('#catch-length').value='32.5';document.querySelector('#lat').value='2';document.querySelector('#lon').value='181'");
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
            "document.querySelector('#bait').value='spinner';document.querySelector('#technique').value='jigging';document.querySelector('#position-fields').open=true;document.querySelector('#fish-name').value='Perch';document.querySelector('#catch-length').value='32.5';document.querySelector('#lat').value='-40';document.querySelector('#lon').value='0'");
        waitFor("document.querySelectorAll('#catch-list article').length===" + n);
      }
      runOnMainSync(() -> activity.finish());
      waitForIdleSync();
      launch();
      js("document.querySelector('#tabtrips').click()");
      waitFor("document.querySelectorAll('[data-trip]').length===1");
      setControl("#trip-search", "Lipno", "input");
      waitFor("!document.querySelector('[data-trip]') && !!document.querySelector('#trip-results').textContent");
      setControl("#trip-search", "401009", "input");
      waitFor("document.querySelector('[data-trip]')?.textContent.includes('401 009')");
      clickReady("#trip-stats");
      waitFor("document.querySelector('#screen').dataset.page==='journalStatistics' && document.querySelector('#screen').textContent.includes('Perch')");
      clickReady("#back");
      capture("journal");
      js("document.querySelector('[data-trip]').click()");
      waitFor("document.querySelectorAll('#catch-list article').length===2");
      waitFor(
          "!!document.querySelector('#catch-list img') && document.querySelector('#catch-list"
              + " img').naturalWidth===32");
      ShareChecks.run(this);
      WeeklyChecks.run(this);
      PublicCardChecks.run(this);
      accounts.market.run(this);
      checkEvidenceSubmission(accounts);
      if ("wide".equals(scenario)) verifyLanguagePicker(accounts);
      accounts.readGroupTip(postedTip);
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
