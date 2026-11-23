package app.anglers.journal;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

/** Loads a fixed app-private HTTPS origin and brokers explicit Android user actions. */
public final class FishingActivity extends Activity {
  private static final int PHOTO = 51, NOTIFY = 53;
  private WebView web;
  private ValueCallback<Uri[]> picker;
  private PositionRequest position;
  private CatchShare shares;
  private final Handler sessionTimer = new Handler(Looper.getMainLooper());
  private final Runnable sessionCheck = this::checkSession;
  private String subject;
  private String pendingReminder;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    subject = AccountStore.active(this);
    if (subject.isEmpty()) {
      lockAccount();
      return;
    }
    if (state != null) pendingReminder = state.getString("reminder");
    web = new WebView(this);
    setContentView(web);
    if (Build.VERSION.SDK_INT >= 35) {
      findViewById(android.R.id.content)
          .setOnApplyWindowInsetsListener(
              (v, insets) -> {
                android.graphics.Insets bars =
                    insets.getInsets(
                        android.view.WindowInsets.Type.systemBars()
                            | android.view.WindowInsets.Type.displayCutout()
                            | android.view.WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return android.view.WindowInsets.CONSUMED;
              });
    }
    getWindow().setStatusBarColor(0xff0d3432);
    getWindow().setNavigationBarColor(0xff0d3432);
    web.setBackgroundColor(0xff0d3432);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setGeolocationEnabled(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.addJavascriptInterface(new Device(), "Device");
    shares = new CatchShare(this);
    position = new PositionRequest(this, this::positionResult);
    web.setWebViewClient(new LocalAssetClient(getAssets(), this::openExternal));
    web.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (picker != null) picker.onReceiveValue(null);
            picker = callback;
            Intent intent =
                new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("image/*");
            try {
              startActivityForResult(intent, PHOTO);
            } catch (ActivityNotFoundException e) {
              picker.onReceiveValue(null);
              picker = null;
              show(R.string.open_error);
            }
            return true;
          }
        });
    if (Build.VERSION.SDK_INT >= 33) {
      getOnBackInvokedDispatcher()
          .registerOnBackInvokedCallback(
              android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::onBackPressed);
    }
    web.loadUrl(LocalAssetClient.ENTRY);
  }

  /** Methods are accessible only to packaged scripts. Android UI calls run on the main thread. */
  public final class Device {
    @JavascriptInterface
    public String versionLabel() {
      return AppVersion.label(FishingActivity.this);
    }

    @JavascriptInterface
    public String journalName() {
      return AccountStore.journal(FishingActivity.this);
    }

    @JavascriptInterface
    public String subjectId() {
      return subject;
    }

    @JavascriptInterface
    public void profile() {
      runOnUiThread(
          () -> {
            startActivity(
                new Intent(FishingActivity.this, AccountActivity.class).putExtra("manage", true));
            finish();
          });
    }

    @JavascriptInterface
    public boolean nightMode() {
      int mask = android.content.res.Configuration.UI_MODE_NIGHT_MASK;
      return (getResources().getConfiguration().uiMode & mask)
          == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /** Keep native navigation glyphs legible beside the selected WebView palette. */
    @JavascriptInterface
    public void systemBars(boolean dark) {
      runOnUiThread(
          () -> {
            int navigationColor = dark ? 0xff1b2e2a : 0xfffffef8;
            getWindow().setNavigationBarColor(navigationColor);
            if (Build.VERSION.SDK_INT >= 35)
              findViewById(android.R.id.content)
                  .setBackground(
                      new android.graphics.drawable.GradientDrawable(
                          android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                          new int[] {0xff0d3432, navigationColor}));
            android.view.View decor = getWindow().getDecorView();
            int light = android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int flags = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(dark ? flags & ~light : flags | light);
          });
    }

    @JavascriptInterface
    public String locale() {
      if (Build.VERSION.SDK_INT >= 33) {
        android.os.LocaleList selected =
            getSystemService(android.app.LocaleManager.class).getApplicationLocales();
        if (!selected.isEmpty()) return selected.get(0).getLanguage();
      }
      return getResources().getConfiguration().getLocales().get(0).getLanguage();
    }

    @JavascriptInterface
    public boolean shareCatch(String caption, String jpeg) {
      return shares.open(caption, jpeg);
    }

    @JavascriptInterface
    public void location(int id) {
      runOnUiThread(() -> position.request(id));
    }

    @JavascriptInterface
    public void cancelLocation(int id) {
      runOnUiThread(() -> position.cancel(id));
    }

    @JavascriptInterface
    public void navigate(double lat, double lon) {
      if (!Double.isFinite(lat)
          || !Double.isFinite(lon)
          || Math.abs(lat) > 90
          || Math.abs(lon) > 180) return;
      String xy = Double.toString(lat) + "," + Double.toString(lon);
      runOnUiThread(() -> openExternal(Uri.parse("geo:0,0?q=" + xy)));
    }

    @JavascriptInterface
    public boolean watching(String key) {
      return SeasonReminder.watching(FishingActivity.this, key);
    }

    @JavascriptInterface
    public void reminder(String key, boolean enabled) {
      runOnUiThread(
          () -> {
            if (!enabled) {
              SeasonReminder.toggle(FishingActivity.this, key, false);
              signal("window.reminderChanged?.()");
              return;
            }
            if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
              pendingReminder = key;
              requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTIFY);
            } else enableReminder(key);
          });
    }
  }

  private void enableReminder(String key) {
    if (!SeasonReminder.notificationsEnabled(this)) show(R.string.notify_error);
    else SeasonReminder.toggle(this, key, true);
    signal("window.reminderChanged?.()");
  }

  private void openExternal(Uri target) {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, target));
    } catch (ActivityNotFoundException e) {
      show(R.string.open_error);
    }
  }

  private void show(int resource) {
    Toast.makeText(this, resource, Toast.LENGTH_LONG).show();
  }

  private void signal(String js) {
    if (web != null) web.evaluateJavascript(js, null);
  }

  private void positionResult(int id, Location fix) {
    if (fix == null) {
      show(R.string.location_error);
      signal("window.positionResult?.(" + id + ",null)");
      return;
    }
    signal(
        "window.positionResult?.("
            + id
            + ",{lat:"
            + fix.getLatitude()
            + ",lon:"
            + fix.getLongitude()
            + ",accuracy:"
            + (fix.hasAccuracy() ? Float.toString(fix.getAccuracy()) : "null")
            + ",time:"
            + fix.getTime()
            + "})");
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] names, int[] grants) {
    super.onRequestPermissionsResult(code, names, grants);
    boolean allowed = false;
    for (int grant : grants) if (grant == PackageManager.PERMISSION_GRANTED) allowed = true;
    if (code == PositionRequest.PERMISSION) position.permissionResult();
    if (code == NOTIFY) {
      if (allowed && pendingReminder != null) enableReminder(pendingReminder);
      else {
        show(R.string.notify_error);
        signal("window.reminderChanged?.()");
      }
      pendingReminder = null;
    }
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == CatchShare.REQUEST) shares.finished();
    if (code == PHOTO && picker != null) {
      Uri photo = result == RESULT_OK && data != null ? data.getData() : null;
      picker.onReceiveValue(
          photo != null && "content".equals(photo.getScheme()) ? new Uri[] {photo} : null);
      picker = null;
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    out.putString("reminder", pendingReminder);
  }

  @Override
  public void onBackPressed() {
    web.evaluateJavascript(
        "typeof handleBack==='function' && handleBack()",
        result -> {
          if (!"true".equals(result)) {
            if (Build.VERSION.SDK_INT >= 33 && isTaskRoot()) moveTaskToBack(true);
            else if (Build.VERSION.SDK_INT >= 33) finish();
            else super.onBackPressed();
          }
        });
  }

  private void lockAccount() {
    startActivity(new Intent(this, AccountActivity.class));
    finish();
  }

  @Override
  protected void onResume() {
    super.onResume();
    checkSession();
  }

  private void checkSession() {
    if (isFinishing()) return;
    if (!subject.equals(AccountStore.active(this))) {
      lockAccount();
      return;
    }
    sessionTimer.postDelayed(sessionCheck, AccountStore.remainingMillis(this));
  }

  @Override
  protected void onPause() {
    sessionTimer.removeCallbacks(sessionCheck);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    if (position != null) position.stop();
    if (picker != null) picker.onReceiveValue(null);
    if (web != null) {
      web.removeJavascriptInterface("Device");
      web.destroy();
    }
    web = null;
    super.onDestroy();
  }
}
