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

  /** Register process-level activity tracking and device lifecycle observers. */
  @Override
  public void onCreate() {
    super.onCreate();
    AppLanguage.migrate(this);
    AccountStore.initializeJournalOwnership(this);
    WaterCatalogue.schedule(this);
    registerActivityLifecycleCallbacks(this);
    registerReceiver(
        new BroadcastReceiver() {
          /** Lock the in-memory account session when Android turns the screen off. */
          @Override
          public void onReceive(Context c, Intent i) {
            AccountStore.lock();
          }
        },
        new IntentFilter(Intent.ACTION_SCREEN_OFF));
  }

  /** Track the transition into foreground activity ownership. */
  @Override
  public void onActivityStarted(Activity a) {
    if (visible++ == 0) {
      // Android can clear pending work while the application is stopped. Reconcile on foreground entry.
      WaterCatalogue.schedule(this);
      WaterCatalogue.check(this, false, null);
      timer.removeCallbacks(lock);
      if (stoppedAt != 0 && SystemClock.elapsedRealtime() - stoppedAt >= 60000) AccountStore.lock();
      stoppedAt = 0;
    }
  }

  /** Record the loss of foreground activities for the account-lock policy. */
  @Override
  public void onActivityStopped(Activity a) {
    if (--visible == 0) {
      stoppedAt = SystemClock.elapsedRealtime();
      timer.postDelayed(lock, 60000);
    }
  }

  /** Foreground lock timing is tracked by start and stop events. */
  @Override
  public void onActivityCreated(Activity a, Bundle state) {}

  /** Keep the existing foreground count across an activity resume. */
  @Override
  public void onActivityResumed(Activity a) {}

  /** Allow transient pauses while start and stop events own the lock timing. */
  @Override
  public void onActivityPaused(Activity a) {}

  /** Keep session credentials out of the activity state bundle. */
  @Override
  public void onActivitySaveInstanceState(Activity a, Bundle state) {}

  /** The preceding stop event already reconciled the foreground count. */
  @Override
  public void onActivityDestroyed(Activity a) {}
}
