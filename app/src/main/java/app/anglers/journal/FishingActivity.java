package app.anglers.journal;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Locale;

/** Loads a fixed app-private HTTPS origin and brokers explicit Android user actions. */
public final class FishingActivity extends Activity {
    private static final String HOST = "journal.invalid";
    private static final int PHOTO = 51, LOCATION = 52, NOTIFY = 53;
    private WebView web;
    private ValueCallback<Uri[]> picker;
    private LocationManager positions;
    private LocationListener listener;
    private final Handler handler = new Handler();
    private final Runnable timeout = () -> finishPosition(null);
    private String pendingReminder;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) pendingReminder = state.getString("reminder");
        web = new WebView(this);
        setContentView(web);
        if (Build.VERSION.SDK_INT >= 35) {
            web.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        getWindow().setStatusBarColor(0xff163d35);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Device(), "Device");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String path = uri.getPath();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && path != null
                        && path.matches("/[a-z][a-z0-9.-]*")) {
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript"
                        : path.endsWith(".css") ? "text/css" : "application/json";
                    try {
                        InputStream data = getAssets().open(path.substring(1));
                        return new WebResourceResponse(mime, "utf-8", data);
                    } catch (java.io.IOException ignored) { }
                }
                return new WebResourceResponse("text/plain","utf-8",404,"Missing",null,new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (req.isForMainFrame() && req.hasGesture() && "https".equals(req.getUrl().getScheme())
                        && !HOST.equals(req.getUrl().getHost())) openExternal(req.getUrl());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                try { startActivityForResult(intent, PHOTO); }
                catch (ActivityNotFoundException e) { picker.onReceiveValue(null); picker=null; show(R.string.open_error); }
                return true;
            }
        });
        web.loadUrl("https://" + HOST + "/index.html");
    }

    /** Methods are accessible only to packaged scripts. Android UI calls run on the main thread. */
    public final class Device {
        @JavascriptInterface public String locale() { return Locale.getDefault().getLanguage(); }
        @JavascriptInterface public void location() { runOnUiThread(() -> requestPosition()); }
        @JavascriptInterface public void cancelLocation() { runOnUiThread(() -> cancelPosition()); }
        @JavascriptInterface public void navigate(double lat, double lon) {
            if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return;
            String xy = Double.toString(lat) + "," + Double.toString(lon);
            runOnUiThread(() -> openExternal(Uri.parse("geo:0,0?q=" + xy)));
        }
        @JavascriptInterface public boolean watching(String key) { return SeasonReminder.watching(FishingActivity.this,key); }
        @JavascriptInterface public void reminder(String key, boolean enabled) {
            runOnUiThread(() -> {
                if (!enabled) { SeasonReminder.toggle(FishingActivity.this,key,false); signal("reminderChanged()"); return; }
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    pendingReminder=key; requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFY);
                } else enableReminder(key);
            });
        }
    }

    private void enableReminder(String key) {
        if (!getSystemService(android.app.NotificationManager.class).areNotificationsEnabled()) show(R.string.notify_error);
        else SeasonReminder.toggle(this,key,true);
        signal("reminderChanged()");
    }

    private void openExternal(Uri target) {
        try { startActivity(new Intent(Intent.ACTION_VIEW,target)); }
        catch (ActivityNotFoundException e) { show(R.string.open_error); }
    }
    private void show(int resource) { Toast.makeText(this,resource,Toast.LENGTH_LONG).show(); }
    private void signal(String js) { if (web!=null) web.evaluateJavascript(js,null); }

    private void requestPosition() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION);
        } else startPosition();
    }

    /** Only an active request may deliver a current fix. Timeout, navigation and shutdown release listeners. */
    private void startPosition() {
        cancelPosition();
        positions=getSystemService(LocationManager.class);
        listener=new LocationListener() {
            @Override public void onLocationChanged(Location fix) { finishPosition(fix); }
            @Override public void onProviderDisabled(String p) {}
            @Override public void onProviderEnabled(String p) {}
            @Override public void onStatusChanged(String p,int s,Bundle b) {}
        };
        boolean requested=false;
        for (String provider : new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}) {
            try {
                if (positions.isProviderEnabled(provider)) {
                    positions.requestLocationUpdates(provider,0,0,listener);
                    requested=true;
                }
            } catch (SecurityException | IllegalArgumentException ignored) { }
        }
        if (requested) handler.postDelayed(timeout,25000); else finishPosition(null);
    }
    private void cancelPosition() {
        handler.removeCallbacks(timeout);
        if (positions!=null && listener!=null) positions.removeUpdates(listener);
        listener=null;
    }
    private void finishPosition(Location fix) {
        cancelPosition();
        if (fix==null) { show(R.string.location_error); signal("positionResult(null)"); return; }
        signal("positionResult({lat:" + fix.getLatitude() + ",lon:" + fix.getLongitude() + ",accuracy:"
                + (fix.hasAccuracy()? Float.toString(fix.getAccuracy()) : "null") + ",time:" + fix.getTime() + "})");
    }
    @Override public void onRequestPermissionsResult(int code,String[] names,int[] grants) {
        super.onRequestPermissionsResult(code,names,grants);
        boolean allowed=false;
        for (int grant:grants) if (grant==PackageManager.PERMISSION_GRANTED) allowed=true;
        if (code==LOCATION) { if (allowed) startPosition(); else finishPosition(null); }
        if (code==NOTIFY) {
            if (allowed && pendingReminder!=null) enableReminder(pendingReminder);
            else { show(R.string.notify_error); signal("reminderChanged()"); }
            pendingReminder=null;
        }
    }
    @Override protected void onActivityResult(int code,int result,Intent data) {
        super.onActivityResult(code,result,data);
        if (code==PHOTO && picker!=null) {
            Uri photo = result==RESULT_OK && data!=null ? data.getData() : null;
            picker.onReceiveValue(photo!=null && "content".equals(photo.getScheme()) ? new Uri[]{photo} : null);
            picker=null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle out) {super.onSaveInstanceState(out);out.putString("reminder",pendingReminder);}
    @Override public void onBackPressed() {
        web.evaluateJavascript("typeof handleBack==='function' && handleBack()", result -> {
            if (!"true".equals(result)) super.onBackPressed();
        });
    }
    @Override protected void onDestroy() {
        cancelPosition();
        if(picker!=null) picker.onReceiveValue(null);
        web.removeJavascriptInterface("Device");web.destroy();web=null;
        super.onDestroy();
    }
}
