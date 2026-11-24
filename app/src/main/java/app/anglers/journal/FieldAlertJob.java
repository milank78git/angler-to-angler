package app.anglers.journal;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;

/** Android batches post checks when the device has connectivity. */
public final class FieldAlertJob extends JobService {
  private JobParameters active;
  @Override public boolean onStartJob(JobParameters params) {
    active=params;
    FieldAlerts.checkPosts(this, () -> new Handler(Looper.getMainLooper()).post(() -> {
      if (active==params) { active=null; jobFinished(params,false); }
    }));
    return true;
  }
  @Override public boolean onStopJob(JobParameters params) { active=null; return false; }
}
