package app.anglers.journal;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/** Owns one user-initiated position request, including the time spent awaiting permission. */
final class PositionRequest {
  interface Result {
    void deliver(int id, Location fix);
  }

  static final int PERMISSION = 52;
  private final Activity activity;
  private final Result result;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final LocationManager manager;
  private int active;
  enum Mode { STANDARD, ATLAS, PRECISE }
  private boolean permissionPending;
  private Mode mode = Mode.STANDARD;
  private LocationListener listener;
  private final Runnable timeout = () -> finish(active, null);

  PositionRequest(Activity activity, Result result) {
    this.activity = activity;
    this.result = result;
    manager = activity.getSystemService(LocationManager.class);
  }

  /** Superseding a request also retires its listener and all of its queued callbacks. */
  void request(int id) {
    request(id, Mode.STANDARD);
  }

  /** Atlas lookups request coarse access only and can reuse a recent local fix. */
  void request(int id, Mode mode) {
    if (id <= 0) return;
    stop();
    active = id;
    this.mode = mode;
    if (hasPermission()) start(id);
    else if (!permissionPending) {
      permissionPending = true;
      activity.requestPermissions(
          mode == Mode.ATLAS ? new String[] {Manifest.permission.ACCESS_COARSE_LOCATION}
              : new String[] {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
          PERMISSION);
    }
  }

  void permissionResult() {
    permissionPending = false;
    if (active == 0) return;
    if (hasPermission()) start(active);
    else finish(active, null);
  }

  private boolean hasPermission() {
    return activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED
        || (mode != Mode.PRECISE && activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED);
  }

  private void start(int id) {
    if (manager == null) {
      finish(id, null);
      return;
    }
    final long started = SystemClock.elapsedRealtimeNanos();
    String[] providers = mode == Mode.ATLAS && android.os.Build.VERSION.SDK_INT >= 31
        ? new String[] {LocationManager.FUSED_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER}
        : new String[] {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER};
    if (mode == Mode.ATLAS) {
      Location recent = recentFix(providers, started);
      if (recent != null) {
        finish(id, recent);
        return;
      }
    }
    listener =
        new LocationListener() {
          @Override
          public void onLocationChanged(Location fix) {
            if (fix.getElapsedRealtimeNanos() < started) return;
            if (mode == Mode.PRECISE && !acceptableEvidenceFix(fix)) return;
            finish(id, fix);
          }

          @Override
          public void onStatusChanged(String p, int s, Bundle b) {}

          @Override
          public void onProviderDisabled(String p) {}

          @Override
          public void onProviderEnabled(String p) {}
        };
    boolean registered = false;
    for (String provider : providers) {
      try {
        if (manager.isProviderEnabled(provider)) {
          manager.requestLocationUpdates(provider, 0, 0, listener);
          registered = true;
        }
      } catch (SecurityException | IllegalArgumentException ignored) {
        // Approximate-only permission or a missing provider can leave the other provider available.
      }
    }
    if (registered) handler.postDelayed(timeout, 25000);
    else finish(id, null);
  }

  static boolean acceptableEvidenceFix(Location fix) {
    return fix != null && !fix.isFromMockProvider() && fix.hasAccuracy()
        && fix.getAccuracy() >= 0 && fix.getAccuracy() <= 100;
  }

  private Location recentFix(String[] providers, long now) {
    Location newest = null;
    for (String provider : providers) {
      try {
        if (!manager.isProviderEnabled(provider)) continue;
        Location fix = manager.getLastKnownLocation(provider);
        if (fix == null) continue;
        long age = now - fix.getElapsedRealtimeNanos();
        if (age >= 0 && age <= java.util.concurrent.TimeUnit.MINUTES.toNanos(5)
            && (newest == null || fix.getElapsedRealtimeNanos() > newest.getElapsedRealtimeNanos())) newest = fix;
      } catch (SecurityException | IllegalArgumentException ignored) {
        // The device may only expose a coarse network or fused provider.
      }
    }
    return newest;
  }

  void cancel(int id) {
    if (id == active) stop();
  }

  void stop() {
    active = 0;
    handler.removeCallbacks(timeout);
    if (listener != null) {
      try {
        manager.removeUpdates(listener);
      } catch (SecurityException ignored) {
        // Permission can be revoked while the request is in flight.
      }
      listener = null;
    }
  }

  private void finish(int id, Location fix) {
    if (id == 0 || id != active) return;
    stop();
    result.deliver(id, fix);
  }
}
