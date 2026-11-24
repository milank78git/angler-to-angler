package app.anglers.journal;

import android.app.Activity;
import android.app.Application;
import android.content.*;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/** Drop the unlocked credential after the screen turns off or the app spends a minute away. */
public final class JournalApplication extends Application
    implements Application.ActivityLifecycleCallbacks {
  private int visible;
  private long stoppedAt;
  private final Handler timer = new Handler(Looper.getMainLooper());
  private final Runnable lock = AccountStore::lock;

  @Override
  public void onCreate() {
    super.onCreate();
    AccountStore.initializeJournalOwnership(this);
    WaterCatalogue.schedule(this);
    registerActivityLifecycleCallbacks(this);
    registerReceiver(
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context c, Intent i) {
            AccountStore.lock();
          }
        },
        new IntentFilter(Intent.ACTION_SCREEN_OFF));
  }

  @Override
  public void onActivityStarted(Activity a) {
    if (visible++ == 0) {
      WaterCatalogue.check(this, false, null);
      timer.removeCallbacks(lock);
      if (stoppedAt != 0 && SystemClock.elapsedRealtime() - stoppedAt >= 60000) AccountStore.lock();
      stoppedAt = 0;
    }
  }

  @Override
  public void onActivityStopped(Activity a) {
    if (--visible == 0) {
      stoppedAt = SystemClock.elapsedRealtime();
      timer.postDelayed(lock, 60000);
    }
  }

  @Override
  public void onActivityCreated(Activity a, Bundle state) {}

  @Override
  public void onActivityResumed(Activity a) {}

  @Override
  public void onActivityPaused(Activity a) {}

  @Override
  public void onActivitySaveInstanceState(Activity a, Bundle state) {}

  @Override
  public void onActivityDestroyed(Activity a) {}
}
