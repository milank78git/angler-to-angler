package app.anglers.journal;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Main-thread receipt state for one signed-in account. Only the server grants credits. */
final class PlayReceipts {
  private enum State { PENDING, VERIFYING, RETRY, CONFIRMED }

  private static final class Receipt {
    State state;
    boolean owned = true;
  }

  private final Map<String, Receipt> receipts = new HashMap<>();
  private final Consumer<String> verify;

  PlayReceipts(Consumer<String> verify) {
    this.verify = verify;
  }

  /** A purchase update can arrive before it becomes visible in the ownership query. */
  void observe(String token, boolean purchased) {
    Receipt receipt = receipts.computeIfAbsent(token, ignored -> new Receipt());
    receipt.owned = true;
    if (!purchased) {
      if (receipt.state == null) receipt.state = State.PENDING;
      return;
    }
    if (receipt.state == State.VERIFYING || receipt.state == State.CONFIRMED) return;
    receipt.state = State.VERIFYING;
    verify.accept(token);
  }

  /** Only a successful full inventory can retire a cancelled or already consumed purchase. */
  void reconcile(Set<String> ownedTokens) {
    receipts.entrySet().removeIf(entry -> {
      Receipt receipt = entry.getValue();
      receipt.owned = ownedTokens.contains(entry.getKey());
      return !receipt.owned && receipt.state != State.VERIFYING;
    });
  }

  void complete(String token, boolean verified) {
    Receipt receipt = receipts.get(token);
    if (receipt == null || receipt.state != State.VERIFYING) return;
    if (receipt.owned) receipt.state = verified ? State.CONFIRMED : State.RETRY;
    else receipts.remove(token);
  }

  boolean pending() { return contains(State.PENDING); }
  boolean verifying() { return contains(State.VERIFYING); }
  boolean needsRetry() { return contains(State.RETRY); }

  private boolean contains(State state) {
    return receipts.values().stream().anyMatch(receipt -> receipt.state == state);
  }
}
