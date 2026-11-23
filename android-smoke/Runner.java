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

  private void launch() throws Exception {
    Intent i =
        new Intent(Intent.ACTION_MAIN)
            .setClassName(
                getTargetContext().getPackageName(), "app.anglers.journal.FishingActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    activity = startActivitySync(i);
    runOnMainSync(
        () ->
            web =
                (WebView) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0));
    waitFor("!!document.querySelector('[data-water]')");
  }

  private String js(String code) throws Exception {
    ArrayBlockingQueue<String> answer = new ArrayBlockingQueue<>(1);
    runOnMainSync(
        () ->
            web.evaluateJavascript(code, result -> answer.offer(result == null ? "null" : result)));
    String value = answer.poll(10, TimeUnit.SECONDS);
    if (value == null) throw new AssertionError("WebView did not respond");
    return value;
  }

  private void waitFor(String expr) throws Exception {
    long stop = android.os.SystemClock.elapsedRealtime() + 20000;
    while (android.os.SystemClock.elapsedRealtime() < stop) {
      if ("true".equals(js(expr))) return;
      Thread.sleep(150);
    }
    throw new AssertionError(
        "Timed out: " + expr + "; page=" + js("document.body.innerText.slice(0,450)"));
  }

  private void form(String code) throws Exception {
    js(code + "; document.querySelector('form button.primary').click()");
  }

  /**
   * Capture actual emulator pixels and check accessible labels, target sizes and viewport overflow.
   */
  private void capture(String name) throws Exception {
    waitFor("document.documentElement.scrollWidth <= window.innerWidth + 1");
    waitFor(
        "Array.from(document.querySelectorAll('button')).filter(b=>b.offsetWidth).every(b=>b.offsetWidth>=48"
            + " && b.offsetHeight>=48 && (b.textContent.trim() || b.getAttribute('aria-label')))");
    waitFor(
        "Array.from(document.querySelectorAll('img[src]')).every(i=>i.complete &&"
            + " i.naturalWidth>0)");
    waitForIdleSync();
    Thread.sleep(250);
    saveScreenshot(name);
  }

  private void saveScreenshot(String name) throws Exception {
    android.graphics.Bitmap pixels = getUiAutomation().takeScreenshot();
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

  @Override
  public void onStart() {
    Bundle outcome = new Bundle();
    try {
      launch();
      waitFor("document.documentElement.lang==='" + ("wide".equals(scenario) ? "en" : "cs") + "'");
      waitFor(
          "getComputedStyle(document.querySelector('#tabs')).flexDirection==='"
              + ("wide".equals(scenario) ? "column" : "row")
              + "'");
      capture("atlas");
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
      js("handleBack()");
      waitFor("!!document.querySelector('#new-trip')");
      js("document.querySelector('#new-trip').click()");
      waitFor("!!document.querySelector('#notes')");
      form("document.querySelector('#notes').value='Offline smoke test'");
      waitFor(
          "!!document.querySelector('#add') && document.querySelectorAll('#catch-list"
              + " article').length===0");
      for (int n = 1; n <= 2; n++) {
        js("document.querySelector('#add').click()");
        waitFor("!!document.querySelector('#fish-name')");
        waitFor(
            "document.querySelector('#position-fields').open===false &&"
                + " document.querySelector('#tabs').hidden");
        if (n == 1) {
          capture("catch");
          js(
              "const"
                  + " canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;canvas.toBlob(blob=>{const"
                  + " files=new DataTransfer();files.items.add(new"
                  + " File([blob],'catch.png',{type:'image/png'}));document.querySelector('#photo').files=files.files;});");
          waitFor("document.querySelector('#photo').files.length===1");
        }
        form(
            "document.querySelector('#position-fields').open=true;document.querySelector('#fish-name').value='Perch';document.querySelector('#length').value='32.5';document.querySelector('#lat').value='-40';document.querySelector('#lon').value='0'");
        waitFor("document.querySelectorAll('#catch-list article').length===" + n);
      }
      runOnMainSync(() -> activity.finish());
      waitForIdleSync();
      launch();
      js("document.querySelector('#tabtrips').click()");
      waitFor("!!document.querySelector('[data-trip]')");
      capture("journal");
      js("document.querySelector('[data-trip]').click()");
      waitFor("document.querySelectorAll('#catch-list article').length===2");
      waitFor(
          "!!document.querySelector('#catch-list img') && document.querySelector('#catch-list"
              + " img').naturalWidth===32");
      outcome.putString("stream", "ANGLER_SMOKE_PASS\n");
      finish(Activity.RESULT_OK, outcome);
    } catch (Throwable error) {
      try {
        saveScreenshot("failure");
      } catch (Exception captureError) {
        error.addSuppressed(captureError);
      }
      outcome.putString(
          "stream", "ANGLER_SMOKE_FAIL " + android.util.Log.getStackTraceString(error));
      finish(Activity.RESULT_CANCELED, outcome);
    }
  }
}
