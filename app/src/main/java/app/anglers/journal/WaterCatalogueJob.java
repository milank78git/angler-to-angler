package app.anglers.journal;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;

/** Android may defer the daily check until connectivity and power policy allow it. */
public final class WaterCatalogueJob extends JobService {
  private JobParameters active;

  @Override public boolean onStartJob(JobParameters params) {
    active = params;
    WaterCatalogue.check(this, false, result -> new Handler(Looper.getMainLooper()).post(() -> {
      if (active == params) {
        active = null;
        jobFinished(params, result == WaterCatalogue.Result.FAILED);
      }
    }));
    return true;
  }

  @Override public boolean onStopJob(JobParameters params) {
    active = null;
    return WaterCatalogue.automatic(this);
  }
}
