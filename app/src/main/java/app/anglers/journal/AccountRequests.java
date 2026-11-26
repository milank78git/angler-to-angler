package app.anglers.journal;

import android.app.Activity;
import org.json.JSONObject;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Runs account operations off the UI thread and discards callbacks after activity destruction. */
final class AccountRequests implements AutoCloseable {
  private final Activity activity;
  private final ExecutorService io = Executors.newFixedThreadPool(2);
  private boolean busy;

  AccountRequests(Activity activity) { this.activity = activity; }
  boolean busy() { return busy; }

  void discoverProviders(IdentityService service, Consumer<JSONObject> present) {
    io.execute(() -> {
      try {
        JSONObject providers = service.providers();
        activity.runOnUiThread(() -> {
          if (!activity.isFinishing() && !activity.isDestroyed()) present.accept(providers);
        });
      } catch (Exception unavailable) {
        // The email option remains available when discovery is offline.
      }
    });
  }

  @Override public void close() { io.shutdownNow(); }

  <T> void run(Callable<T> work, Consumer<T> done, Consumer<Exception> failed, Runnable started, Runnable finished) {
    if (busy) return;
    busy = true;
    started.run();
    io.execute(
        () -> {
          try {
            T value = work.call();
            activity.runOnUiThread(
                () -> {
                  if (activity.isFinishing() || activity.isDestroyed()) return;
                  busy = false;
                  done.accept(value);
                  if (!activity.isFinishing() && !activity.isDestroyed()) finished.run();
                });
          } catch (Exception error) {
            activity.runOnUiThread(
                () -> {
                  if (activity.isFinishing() || activity.isDestroyed()) return;
                  busy = false;
                  failed.accept(error);
                  // A link can arrive while a mail request is still waiting for its response.
                  finished.run();
                });
          }
        });
  }
}
