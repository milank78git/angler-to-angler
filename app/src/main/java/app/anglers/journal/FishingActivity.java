package app.anglers.journal;

import android.Manifest;
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
public final class FishingActivity extends LocalizedActivity {
  private static final int PHOTO = 51, NOTIFY = 53, LICENSE_NOTIFY = 56, CAMERA = 54, CAMERA_FIX = Integer.MAX_VALUE;
  private WebView web;
  private final android.content.SharedPreferences.OnSharedPreferenceChangeListener atlasListener = (prefs, key) -> {
    if (WaterCatalogue.REVISION.equals(key) && web != null)
      web.evaluateJavascript("window.waterCatalogueChanged && window.waterCatalogueChanged()", null);
  };
  private final android.content.SharedPreferences.OnSharedPreferenceChangeListener appearanceListener =
      (preferences, key) -> applyReadingPreferences();

  /** Apply the user's text scale to the running journal WebView. */
  private void applyReadingPreferences() {
    if (web == null) return;
    float systemScale = getResources().getConfiguration().fontScale;
    web.getSettings().setTextZoom(Math.round(100 * systemScale * WaterSettingsActivity.textScale(this)));
    if (getSharedPreferences("appearance", MODE_PRIVATE).getBoolean("screenOn", false))
      getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  private ValueCallback<Uri[]> picker;
  private PositionRequest position, nearbyPosition;
  private long nearbyStarted;
  private boolean foreground;
  private CatchShare shares;
  private final Handler sessionTimer = new Handler(Looper.getMainLooper());
  private final Runnable sessionCheck = this::checkSession;
  private JournalProfileRequests profileRequests;
  private Uri cameraUri, deliveredCameraUri;
  private long cameraStarted, cameraReturned;
  private volatile String captureInfo = "";
  private String subject, openingAgeBand;
  private boolean renewing, awaitingUnlock;
  private android.widget.Button unlockButton;
  private android.widget.FrameLayout journalFrame;
  private long nextLeaseCheck;
  private static final int UNLOCK = 81;
  private PlayStore playStore;
  private String pendingReminder;

  /** Build the journal WebView, native bridges and device resource owners for this activity. */
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    subject = AccountStore.active(this);
    if (subject.isEmpty()) {
      lockAccount();
      return;
    }
    openingAgeBand = AccountStore.prefs(this).getString("ageBand", "");
    if (state != null) pendingReminder = state.getString("reminder");
    profileRequests = new JournalProfileRequests(this, subject, this::signal);
    web = new WebView(this);
    setContentView(web);
    journalFrame = findViewById(android.R.id.content);
    getSharedPreferences("appearance", MODE_PRIVATE).registerOnSharedPreferenceChangeListener(appearanceListener);
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
    settings.setUserAgentString(settings.getUserAgentString()
        + " AnglerToAngler (+https://github.com/milank78git/angler-to-angler)");
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.addJavascriptInterface(new Device(), "Device");
    if (AccountStore.canShareOutsideGroups(this)) playStore = new PlayStore(this, web, subject);
    shares = new CatchShare(this);
    position = new PositionRequest(this, this::positionResult);
    nearbyPosition = new PositionRequest(this, (id,fix) -> {
      if (foreground && fix != null && FieldAlerts.enabled(this,FieldAlerts.NEARBY))
        signal("window.fieldNearby?.("+fix.getLatitude()+","+fix.getLongitude()+")");
    });
    web.setWebViewClient(new LocalAssetClient(this, getAssets(), this::openExternal));
    web.setWebChromeClient(
        new WebChromeClient() {
          /** Route the WebView file request through the device picker or camera activity. */
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (picker != null) picker.onReceiveValue(null);
            picker = callback;
            captureInfo = "";
            if (params.isCaptureEnabled()) {
              try {
                cameraUri = CameraPhotoProvider.create(FishingActivity.this);
                Intent capture =
                    new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
                        .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraUri)
                        .addFlags(
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                capture.setClipData(android.content.ClipData.newRawUri("catch", cameraUri));
                cameraStarted = System.currentTimeMillis();
                startActivityForResult(capture, CAMERA);
              } catch (java.io.IOException | ActivityNotFoundException | SecurityException error) {
                finishCamera(null);
                show(R.string.open_error);
              }
              return true;
            }
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
    WaterCatalogue.prefs(this).registerOnSharedPreferenceChangeListener(atlasListener);
    web.loadUrl(LocalAssetClient.ENTRY);
  }

  /** Methods are accessible only to packaged scripts. Android UI calls run on the main thread. */
  public final class Device {
    /** Pass the active owner's selected waters to background post notifications. */
    @JavascriptInterface
    public void postFavourites(String owner, String keys) { FieldAlerts.favourites(FishingActivity.this, owner, keys); }

    /** Expose the locally installed atlas revision to the WebView. */
    @JavascriptInterface
    public String waterCatalogueVersion() { return WaterCatalogue.revision(FishingActivity.this); }

    /** Open the native private-groups activity for this session. */
    @JavascriptInterface
    public void openGroups() {
      runOnUiThread(() -> {
        if (subject.equals(AccountStore.active(FishingActivity.this)))
          startActivity(new Intent(FishingActivity.this, GroupsActivity.class));
      });
    }

    /** Open atlas update and device notification preferences. */
    @JavascriptInterface
    public void openWaterSettings() {
      runOnUiThread(() -> startActivity(new Intent(FishingActivity.this, WaterSettingsActivity.class)));
    }

    /** Expose the installed Android version label in the journal header. */
    @JavascriptInterface
    public String versionLabel() {
      return AppVersion.label(FishingActivity.this);
    }

    /** Select the IndexedDB namespace belonging to the active account. */
    @JavascriptInterface
    public String journalName() {
      return AccountStore.journal(FishingActivity.this);
    }

    /** Tell the journal whether the active account is restricted to group sharing. */
    @JavascriptInterface
    public boolean groupSharingOnly() {
      return !AccountStore.canShareOutsideGroups(FishingActivity.this);
    }

    /** Expose the current device account's cloud-copy default to the journal. */
    @JavascriptInterface
    public boolean journalCloudDefault() {
      return !groupSharingOnly() && AccountStore.prefs(FishingActivity.this).getBoolean("cloudJournal." + subject, false)
          && !subject.equals(AccountStore.prefs(FishingActivity.this).getString("legacyOwner", ""));
    }

    /** Return the active device subject for owner-scoped journal operations. */
    @JavascriptInterface
    public String subjectId() {
      return subject;
    }

    /** Open the native account management screen from the WebView. */
    @JavascriptInterface
    public void profile() {
      runOnUiThread(
          () -> {
            startActivity(
                new Intent(FishingActivity.this, AccountActivity.class).putExtra("manage", true));
            finish();
          });
    }

    /** Release the temporary file associated with a delivered camera capture. */
    @JavascriptInterface
    public void releaseCameraPhoto() {
      runOnUiThread(FishingActivity.this::discardDeliveredPhoto);
    }

    /** Return the position metadata associated with the recent camera capture. */
    @JavascriptInterface
    public String cameraFix() {
      return captureInfo;
    }

    /** Read the group board destination supplied by the launching intent. */
    @JavascriptInterface
    public String weeklyDestination() {
      return getIntent().getStringExtra("weeklyDestination");
    }

    /** Return to the native groups screen after leaving its journal board. */
    @JavascriptInterface
    public void closeGroupBoard() {
      if (getIntent().hasExtra("weeklyDestination")) runOnUiThread(FishingActivity.this::finish);
    }

    /** Check whether the launching intent requests the profile on startup. */
    @JavascriptInterface
    public boolean openProfile() {
      return getIntent().getBooleanExtra("openProfile", false);
    }

    /** Start the native sign-in flow requested by the journal. */
    @JavascriptInterface
    public void profileSignIn() {
      runOnUiThread(
          () -> {
            startActivity(
                new Intent(FishingActivity.this, AccountActivity.class)
                    .putExtra("profileSignIn", true)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
            finish();
          });
    }

    /** Dispatch an authenticated journal operation and correlate the response with its WebView request ID. */
    @JavascriptInterface
    public void profileRequest(int id, String operation, String body) {
      profileRequests.request(id, operation, body);
    }

    /** Expose the current native appearance mode to the journal theme selector. */
    @JavascriptInterface
    public boolean nightMode() {
      int mask = android.content.res.Configuration.UI_MODE_NIGHT_MASK;
      return (getResources().getConfiguration().uiMode & mask)
          == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /** Keep native navigation glyphs legible beside the selected WebView palette. */
    @JavascriptInterface
    public void systemBars(boolean dark, boolean userSelected) {
      android.content.SharedPreferences.Editor appearance =
          getSharedPreferences("appearance", MODE_PRIVATE).edit();
      if (userSelected) appearance.putBoolean("dark", dark);
      else appearance.remove("dark");
      appearance.apply();
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

    /** Preserve the region and script used by localized dictionaries and number formatting. */
    @JavascriptInterface
    public String localeTag() {
      return AppLanguage.current(FishingActivity.this).toLanguageTag();
    }

    /** Provide the system locale separately from the app's chosen language. */
    @JavascriptInterface
    public String systemLocaleTag() {
      return android.content.res.Resources.getSystem().getConfiguration().getLocales().get(0).toLanguageTag();
    }

    /** Expose the base language used by older journal assets. */
    @JavascriptInterface
    public String locale() {
      return AppLanguage.current(FishingActivity.this).getLanguage();
    }

    /** Open the native sharing flow for the prepared catch content. */
    @JavascriptInterface
    public boolean shareCatch(String caption, String jpeg) {
      return !groupSharingOnly() && subject.equals(AccountStore.active(FishingActivity.this)) && shares.open(caption, jpeg);
    }

    /** A registered network can indicate the current country without requesting coordinates. */
    @JavascriptInterface
    public String networkCountry() {
      android.telephony.TelephonyManager phone = getSystemService(android.telephony.TelephonyManager.class);
      try {
        return phone == null ? "" : phone.getNetworkCountryIso();
      } catch (UnsupportedOperationException | SecurityException ignored) {
        return "";
      }
    }

    /** Start the native position request used by the atlas. */
    @JavascriptInterface
    public void atlasLocation(int id) {
      runOnUiThread(() -> position.request(id, PositionRequest.Mode.ATLAS));
    }

    /** Acquire a device fix for the journal's request identifier. */
    @JavascriptInterface
    public void location(int id) {
      runOnUiThread(() -> position.request(id));
    }

    /** Cancel the native lookup associated with the WebView request ID. */
    @JavascriptInterface
    public void cancelLocation(int id) {
      runOnUiThread(() -> position.cancel(id));
    }

    /** Open directions to the selected published parking position. */
    @JavascriptInterface
    public void driveToParking(double lat, double lon) {
      runOnUiThread(() -> ParkingNavigation.open(FishingActivity.this,lat,lon));
    }

    /** Open the supported external map destination. */
    @JavascriptInterface
    public void navigate(double lat, double lon) {
      if (!Double.isFinite(lat)
          || !Double.isFinite(lon)
          || Math.abs(lat) > 90
          || Math.abs(lon) > 180) return;
      String xy = Double.toString(lat) + "," + Double.toString(lon);
      chooseExternal(Intent.ACTION_VIEW, Uri.parse("geo:"+xy+"?q="+xy),"atlas_map.open");
    }

    /** Open the external search action for the selected water. */
    @JavascriptInterface
    public void findWater(String name) {
      if (name!=null && !name.trim().isEmpty() && name.length()<1000)
        chooseExternal(Intent.ACTION_VIEW,Uri.parse("geo:0,0?q="+Uri.encode(name)),"atlas_map.search");
    }

    /** Start the supported reporting action for a catalogue record. */
    @JavascriptInterface
    public void reportFish(String title,String body) {
      if (title==null || body==null || title.length()>300 || body.length()>2000) return;
      chooseExternal(Intent.ACTION_SENDTO, Uri.parse("mailto:info@horistum.com?subject="+Uri.encode(title)
          +"&body="+Uri.encode(body)), "fish_rules.report");
    }

    /** Expose the notification kind that launched this activity. */
    @JavascriptInterface
    public String fieldKind() { return getIntent().getStringExtra("fieldAlert"); }

    /** Expose the water identity carried by the launching notification. */
    @JavascriptInterface
    public String fieldWater() { return getIntent().getStringExtra("fieldWater"); }

    /** Return the water identities associated with the atlas edition alert. */
    @JavascriptInterface
    public String addedWaters() {
      return new org.json.JSONArray(FieldAlerts.prefs(FishingActivity.this)
          .getStringSet("additions", java.util.Collections.emptySet())).toString();
    }

    /** Start a nearby-water check when the device subscription permits it. */
    @JavascriptInterface
    public void checkNearby() {
      runOnUiThread(() -> {
        if (!foreground || !FieldAlerts.enabled(FishingActivity.this,FieldAlerts.NEARBY)
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED) return;
        long now=android.os.SystemClock.elapsedRealtime();
        if (nearbyStarted!=0 && now-nearbyStarted<600000) return;
        nearbyStarted=now;
        nearbyPosition.request(1);
      });
    }

    /** Pass the selected nearby result back to Android's field alerts. */
    @JavascriptInterface
    public void nearbyWater(String id,String description) {
      if (id==null || id.length()>200 || description==null || description.length()>500) return;
      runOnUiThread(() -> {
        if (foreground && subject.equals(AccountStore.active(FishingActivity.this)))
          FieldAlerts.nearby(FishingActivity.this,id,description);
      });
    }

    /** Reconcile native reminders with the active account's cloud photo expiries. */
    @JavascriptInterface
    public void photoReminderDates(String dates) {
      if (subject.equals(AccountStore.active(FishingActivity.this)))
        PhotoExpiryReminder.remember(FishingActivity.this, subject, dates);
    }

    /** Read the ticket-expiry warning for the active account. */
    @JavascriptInterface
    public String licenseMessage() {
      return subject.equals(AccountStore.active(FishingActivity.this)) ? LicenseReminder.message(FishingActivity.this) : "";
    }

    /** Expose the OS notification capability to the reminder form. */
    @JavascriptInterface
    public boolean licenseNotificationsEnabled() {
      return LicenseReminder.notificationsEnabled(FishingActivity.this);
    }

    /** Request the device permission needed for ticket notifications. */
    @JavascriptInterface
    public void enableLicenseNotifications() {
      runOnUiThread(() -> {
        if (!subject.equals(AccountStore.active(FishingActivity.this))) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && (!getSharedPreferences("appearance",MODE_PRIVATE).getBoolean("askedLicensePermission",false)
                || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))) {
          getSharedPreferences("appearance",MODE_PRIVATE).edit().putBoolean("askedLicensePermission",true).apply();
          requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},LICENSE_NOTIFY);
        } else if (!LicenseReminder.notificationsEnabled(FishingActivity.this)) {
          startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
              .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()));
        } else LicenseReminder.reconcile(FishingActivity.this);
      });
    }

    /** Check whether a reminder exists for this water and species. */
    @JavascriptInterface
    public boolean watching(String key) {
      return SeasonReminder.watching(FishingActivity.this, key);
    }

    /** Apply the angler's season-watch toggle on the device. */
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

  /** Dispose of the temporary camera file after its WebView consumer releases it. */
  private void discardDeliveredPhoto() {
    CameraPhotoProvider.discard(this, deliveredCameraUri);
    deliveredCameraUri = null;
  }

  /** Complete the pending file callback with the camera outcome. */
  private void finishCamera(Uri result) {
    if (result == null) CameraPhotoProvider.discard(this, cameraUri);
    else {
      discardDeliveredPhoto();
      deliveredCameraUri = result;
    }
    if (picker != null) picker.onReceiveValue(result == null ? null : new Uri[] {result});
    picker = null;
    cameraUri = null;
  }

  /** Enable the requested season watch through the native alarm owner. */
  private void enableReminder(String key) {
    if (!SeasonReminder.notificationsEnabled(this)) show(R.string.notify_error);
    else SeasonReminder.toggle(this, key, true);
    signal("window.reminderChanged?.()");
  }

  /** Present the Android chooser for the prepared external intent. */
  private void chooseExternal(String action,Uri uri,String label) {
    runOnUiThread(() -> {
      Intent target=new Intent(action,uri);
      if (target.resolveActivity(getPackageManager())==null) { show(R.string.open_error); return; }
      try { startActivity(Intent.createChooser(target,AppLanguage.text(this,label))); }
      catch (ActivityNotFoundException unavailable) { show(R.string.open_error); }
    });
  }

  /** Route the permitted URI to a suitable external application. */
  private void openExternal(Uri target) {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, target));
    } catch (ActivityNotFoundException e) {
      show(R.string.open_error);
    }
  }

  /** Present a localized native status message from its resource ID. */
  private void show(int resource) {
    Toast.makeText(this, resource, Toast.LENGTH_LONG).show();
  }

  /** Send a device event to the current journal WebView. */
  private void signal(String js) {
    if (web != null) web.evaluateJavascript(js, null);
  }

  /** Serialize the native fix or cancellation and preserve the journal's request ID. */
  private void positionResult(int id, Location fix) {
    if (id == CAMERA_FIX) {
      if (PositionRequest.acceptableEvidenceFix(fix)
          && Math.abs(fix.getTime() - cameraReturned) <= 120000L
          && cameraReturned - cameraStarted <= 120000L
          && cameraReturned >= cameraStarted) {
        try {
          captureInfo =
              new org.json.JSONObject()
                  .put("captured", cameraReturned)
                  .put("fixed", fix.getTime())
                  .put("lat", Math.round(fix.getLatitude() * 100))
                  .put("lon", Math.round(fix.getLongitude() * 100))
                  .put("accuracy", Math.ceil(fix.getAccuracy()))
                  .toString();
        } catch (org.json.JSONException ignored) {
          captureInfo = "";
        }
      }
      finishCamera(cameraUri);
      return;
    }
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

  /** Resume only the feature that initiated the Android permission request. */
  @Override
  public void onRequestPermissionsResult(int code, String[] names, int[] grants) {
    super.onRequestPermissionsResult(code, names, grants);
    boolean allowed = false;
    for (int grant : grants) if (grant == PackageManager.PERMISSION_GRANTED) allowed = true;
    if (code == PositionRequest.PERMISSION) position.permissionResult();
    if (code == LICENSE_NOTIFY) {
      LicenseReminder.reconcile(this);
      PhotoExpiryReminder.reconcile(this);
      signal("window.refreshLicense?.()");
    }
    if (code == NOTIFY) {
      if (allowed && pendingReminder != null) enableReminder(pendingReminder);
      else {
        show(R.string.notify_error);
        signal("window.reminderChanged?.()");
      }
      pendingReminder = null;
    }
  }

  /** Route the returning picker, camera or unlock result to its pending operation. */
  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == UNLOCK) {
      awaitingUnlock = false;
      if (result == RESULT_OK && subject.equals(AccountStore.active(this)) && unlockButton != null) {
        journalFrame.removeView(unlockButton);
        unlockButton = null;
      }
      return;
    }
    if (code == CAMERA) {
      if (cameraUri != null)
        revokeUriPermission(
            cameraUri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
      if (result == RESULT_OK && cameraUri != null && picker != null) {
        cameraReturned = System.currentTimeMillis();
        position.request(CAMERA_FIX, PositionRequest.Mode.PRECISE);
      } else finishCamera(null);
    }
    if (code == CatchShare.REQUEST) shares.finished();
    if (code == PHOTO && picker != null) {
      Uri photo = result == RESULT_OK && data != null ? data.getData() : null;
      picker.onReceiveValue(
          photo != null && "content".equals(photo.getScheme()) ? new Uri[] {photo} : null);
      picker = null;
    }
  }

  /** Preserve activity state needed after Android recreates the journal. */
  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    out.putString("reminder", pendingReminder);
  }

  /** Let the WebView consume Back before the activity exits. */
  @Override
  public void onBackPressed() {
    if (unlockButton != null || web == null) { moveTaskToBack(true); return; }
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

  /** Protect the open journal when its device session requires reauthentication. */
  private void lockAccount() {
    startActivity(new Intent(this, AccountActivity.class));
    finish();
  }

  /** Resume the journal's foreground checks and device integrations. */
  @Override
  protected void onResume() {
    super.onResume();
    foreground=true;
    if (playStore!=null) playStore.resume();
    if (web!=null) {
      applyReadingPreferences();
      LicenseReminder.reconcile(this);
      PhotoExpiryReminder.reconcile(this);
      signal("window.refreshFieldSettings?.();window.refreshLicense?.()");
      if (FieldAlerts.enabled(this,FieldAlerts.POSTS) || FieldAlerts.enabled(this,FieldAlerts.COMMUNITY)) FieldAlerts.checkPosts(this,null);
    }
    checkSession();
  }

  /** Check the active owner and lease before allowing continued journal access. */
  private void checkSession() {
    sessionTimer.removeCallbacks(sessionCheck);
    if (isFinishing() || !foreground || awaitingUnlock) return;
    if (web != null && subject.equals(AccountStore.prefs(this).getString("subject", ""))
        && AccountStore.active(this).isEmpty()) {
      web.setVisibility(android.view.View.INVISIBLE);
      if (unlockButton == null) {
        unlockButton = new android.widget.Button(this);
        unlockButton.setText(AppLanguage.text(this, "account.unlock_journal"));
        journalFrame.addView(unlockButton, new android.widget.FrameLayout.LayoutParams(-1, -2, android.view.Gravity.CENTER));
        unlockButton.setOnClickListener(v -> {
          if (awaitingUnlock) return;
          awaitingUnlock = true;
          startActivityForResult(new Intent(this, AccountActivity.class).putExtra("resumeJournal", subject), UNLOCK);
        });
        unlockButton.performClick();
      }
      return;
    }
    if (!subject.equals(AccountStore.active(this))
        || !openingAgeBand.equals(AccountStore.prefs(this).getString("ageBand", ""))) {
      lockAccount();
      return;
    }
    if (unlockButton != null) {
      journalFrame.removeView(unlockButton);
      unlockButton = null;
    }
    web.setVisibility(android.view.View.VISIBLE);
    long now = android.os.SystemClock.elapsedRealtime();
    long remaining = AccountStore.remainingMillis(this);
    if (!renewing && now >= nextLeaseCheck && remaining <= java.util.concurrent.TimeUnit.DAYS.toMillis(6)) {
      renewing = true;
      nextLeaseCheck = now + java.util.concurrent.TimeUnit.MINUTES.toMillis(15);
      new Thread(() -> {
        try { AccountStore.renewLease(this, subject); }
        catch (Exception unavailable) { /* Keep the last confirmed offline deadline. */ }
        runOnUiThread(() -> {
          renewing = false;
          if (!isDestroyed()) checkSession();
        });
      }, "journal-lease").start();
    }
    sessionTimer.postDelayed(sessionCheck, Math.min(remaining, java.util.concurrent.TimeUnit.MINUTES.toMillis(15)));
  }

  /** Suspend foreground location and session work while the activity is hidden. */
  @Override
  protected void onPause() {
    foreground=false;
    if (nearbyPosition!=null) nearbyPosition.cancel(1);
    sessionTimer.removeCallbacks(sessionCheck);
    super.onPause();
  }

  /** Release camera, request and WebView resources when the journal activity ends. */
  @Override
  protected void onDestroy() {
    WaterCatalogue.prefs(this).unregisterOnSharedPreferenceChangeListener(atlasListener);
    getSharedPreferences("appearance", MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(appearanceListener);
    if (playStore!=null) playStore.close();
    if (profileRequests != null) profileRequests.close();
    discardDeliveredPhoto();
    CameraPhotoProvider.discard(this, cameraUri);
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
