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
  private boolean permissionPending;
  private LocationListener listener;
  private final Runnable timeout = () -> finish(active, null);

  PositionRequest(Activity activity, Result result) {
    this.activity = activity;
    this.result = result;
    manager = activity.getSystemService(LocationManager.class);
  }

  /** Superseding a request also retires its listener and all of its queued callbacks. */
  void request(int id) {
    if (id <= 0) return;
    stop();
    active = id;
    if (hasPermission()) start(id);
    else if (!permissionPending) {
      permissionPending = true;
      activity.requestPermissions(
          new String[] {
            Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
          },
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
        || activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
  }

  private void start(int id) {
    if (manager == null) {
      finish(id, null);
      return;
    }
    final long started = SystemClock.elapsedRealtimeNanos();
    listener =
        new LocationListener() {
          @Override
          public void onLocationChanged(Location fix) {
            if (fix.getElapsedRealtimeNanos() >= started) finish(id, fix);
          }

          @Override
          public void onStatusChanged(String p, int s, Bundle b) {}

          @Override
          public void onProviderDisabled(String p) {}

          @Override
          public void onProviderEnabled(String p) {}
        };
    boolean registered = false;
    for (String provider :
        new String[] {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
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
