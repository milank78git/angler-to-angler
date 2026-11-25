package app.anglers.journal;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/** Exercise the receipt transitions without a Play account or a real payment. */
public final class PlayReceiptsTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  public static void main(String[] args) {
    List<String> attempts = new ArrayList<>();
    PlayReceipts receipts = new PlayReceipts(attempts::add);

    receipts.observe("first", false);
    check(receipts.pending() && attempts.isEmpty(), "Pending payments must not reach verification");
    receipts.observe("second", true);
    receipts.observe("second", true);
    check(receipts.pending() && receipts.verifying(), "Incremental updates must retain other purchases");
    check(attempts.equals(List.of("second")), "Repeated callback must not schedule a second verification");
    receipts.complete("second", false);
    check(receipts.needsRetry() && !receipts.verifying(), "Owned receipt must be retryable after failure");
    receipts.observe("second", true);
    receipts.complete("second", true);
    receipts.observe("second", true);
    check(attempts.equals(List.of("second", "second")), "Confirmed receipt must not be delivered again");
    receipts.reconcile(Set.of("first"));
    receipts.observe("first", true);
    check(!receipts.pending() && receipts.verifying(), "Pending payment can transition to purchased");
    receipts.reconcile(Set.of());
    receipts.complete("first", false);
    check(!receipts.needsRetry() && !receipts.verifying(), "Late failure must not resurrect a consumed receipt");

    receipts.observe("cancelled", false);
    receipts.reconcile(Set.of());
    check(!receipts.pending(), "Successful empty inventory must clear a cancelled pending purchase");
    receipts.observe("third", true);
    receipts.reconcile(Set.of());
    receipts.observe("third", true);
    receipts.complete("third", false);
    check(receipts.needsRetry(), "A receipt reported again before completion is still owned");
    check(attempts.equals(List.of("second", "second", "first", "third")), "Unexpected verification attempts");
  }
}
