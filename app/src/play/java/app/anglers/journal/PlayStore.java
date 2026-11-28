package app.anglers.journal;

import static com.android.billingclient.api.BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED;
import static com.android.billingclient.api.BillingClient.BillingResponseCode.OK;
import static com.android.billingclient.api.BillingClient.BillingResponseCode.USER_CANCELED;

import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.android.billingclient.api.AccountIdentifiers;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/** Owns one activity's Play connection. Only account-bound receipt verification runs off the UI thread. */
final class PlayStore implements PurchasesUpdatedListener {
  private enum Pack {
    SMALL("credits_50_czk", 50), LARGE("credits_100_czk", 100);

    final String sku;
    final int credits;

    /** Associate the published product ID with its corresponding credit denomination. */
    Pack(String sku, int credits) {
      this.sku = sku;
      this.credits = credits;
    }

    /** Resolve one of the explicitly supported Play product IDs. */
    static Pack find(String sku) {
      for (Pack pack : values()) if (pack.sku.equals(sku)) return pack;
      return null;
    }
  }

  private final FishingActivity activity;
  private final WebView web;
  private final String subject;
  private final String accountBinding;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final BillingClient client;
  private final PlayReceipts receipts = new PlayReceipts(this::verify);
  private final Map<String, BillingFlowParams.ProductDetailsParams> offers = new HashMap<>();
  private long catalogQuery, inventoryQuery;
  private boolean connecting, checkoutOpen, closed;

  /** Configure the billing integration supplied by this build variant. */
  PlayStore(FishingActivity activity, WebView web, String subject) {
    this.activity = activity;
    this.web = web;
    this.subject = subject;
    this.accountBinding = binding(subject);
    client = BillingClient.newBuilder(activity).setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection().build();
    web.addJavascriptInterface(new Controls(), "PlayMarket");
  }

  /** Require the original subject and a live activity before publishing billing state. */
  private boolean active() {
    return !closed && !activity.isFinishing() && subject.equals(AccountStore.active(activity));
  }

  /** All native callbacks are serialized on the main thread before publishing to the current view. */
  private void emit(String event, JSONObject data) {
    if (active()) web.evaluateJavascript(
        "window.playMarketResult?.(" + JSONObject.quote(event) + "," + data + ")", null);
  }

  /** Forward a payload-free billing status to the mounted WebView. */
  private void signal(String event) {
    emit(event, new JSONObject());
  }

  public final class Controls {
    /** Request current billing information for the mounted wallet. */
    @JavascriptInterface public void refresh() { main.post(PlayStore.this::refresh); }
    /** Move the requested SKU checkout to the Android main thread. */
    @JavascriptInterface public void buy(String sku) { main.post(() -> launch(sku)); }
  }

  /** Recover after returning from the store even if its checkout callback never reached this activity. */
  void resume() {
    checkoutOpen = false;
    refresh();
  }

  /** Request current billing information for the mounted wallet. */
  private void refresh() {
    if (!active()) return;
    if (client.isReady()) {
      loadOffers();
      loadInventory();
    } else if (!connecting) {
      connecting = true;
      client.startConnection(new BillingClientStateListener() {
        /** Resume catalogue and inventory work after the billing connection completes. */
        public void onBillingSetupFinished(BillingResult result) {
          main.post(() -> {
            connecting = false;
            if (!active()) return;
            if (result.getResponseCode() == OK) {
              loadOffers();
              loadInventory();
            } else disconnected();
          });
        }

        /** Return connection loss to the main-thread billing state owner. */
        public void onBillingServiceDisconnected() { main.post(PlayStore.this::disconnected); }
      });
    }
  }

  /** Invalidate in-flight billing queries and expose the disconnected state. */
  private void disconnected() {
    connecting = false;
    catalogQuery++;
    inventoryQuery++;
    offers.clear();
    signal("unavailable");
    signal("inventoryUnavailable");
  }

  /** Request current product details for the supported credit packs. */
  private void loadOffers() {
    long request = ++catalogQuery;
    List<QueryProductDetailsParams.Product> requested = new ArrayList<>();
    for (Pack pack : Pack.values()) {
      requested.add(QueryProductDetailsParams.Product.newBuilder()
          .setProductId(pack.sku).setProductType(BillingClient.ProductType.INAPP).build());
    }
    client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(requested).build(),
        (result, details) -> main.post(() -> {
          if (!active() || request != catalogQuery) return;
          offers.clear();
          JSONObject prices = new JSONObject();
          if (result.getResponseCode() == OK) {
            for (ProductDetails product : details.getProductDetailsList()) addOffer(product, prices);
          }
          emit(offers.isEmpty() ? "unavailable" : "prices", prices);
        }));
  }

  /** Expose the provider's price and purchase parameters for an eligible pack. */
  private void addOffer(ProductDetails product, JSONObject prices) {
    Pack pack = Pack.find(product.getProductId());
    List<ProductDetails.OneTimePurchaseOfferDetails> options = product.getOneTimePurchaseOfferDetailsList();
    if (pack == null || options == null) return;
    for (ProductDetails.OneTimePurchaseOfferDetails offer : options) {
      if (!"CZK".equals(offer.getPriceCurrencyCode()) || offer.getPriceAmountMicros() != pack.credits * 1_000_000L) continue;
      offers.put(pack.sku, BillingFlowParams.ProductDetailsParams.newBuilder()
          .setProductDetails(product).setOfferToken(offer.getOfferToken()).build());
      JSONObject quote = new JSONObject();
      put(quote, "price", offer.getFormattedPrice());
      put(quote, "credits", pack.credits);
      put(prices, pack.sku, quote);
      return;
    }
  }

  /** Query owned purchases and reconcile their receipt delivery states. */
  private void loadInventory() {
    long request = ++inventoryQuery;
    QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build();
    client.queryPurchasesAsync(params, (result, purchases) -> main.post(() -> {
      if (!active() || request != inventoryQuery) return;
      if (result.getResponseCode() != OK) {
        signal("inventoryUnavailable");
        return;
      }
      Set<String> owned = observe(purchases);
      receipts.reconcile(owned);
      publishReceipts();
      // The server can grant and consume a purchase while the app is closed.
      signal("inventoryLoaded");
    }));
  }

  /** Observe only known packs for this account. A callback list is not a complete inventory. */
  private Set<String> observe(List<Purchase> purchases) {
    Set<String> owned = new HashSet<>();
    for (Purchase purchase : purchases) {
      AccountIdentifiers owner = purchase.getAccountIdentifiers();
      if (owner == null || !accountBinding.equals(owner.getObfuscatedAccountId())) continue;
      List<String> items = purchase.getProducts();
      if (items.size() != 1 || Pack.find(items.get(0)) == null) continue;
      int state = purchase.getPurchaseState();
      if (state != Purchase.PurchaseState.PURCHASED && state != Purchase.PurchaseState.PENDING) continue;
      String token = purchase.getPurchaseToken();
      owned.add(token);
      receipts.observe(token, state == Purchase.PurchaseState.PURCHASED);
    }
    return owned;
  }

  /** Send the independent pending, verifying and retry flags to the wallet UI. */
  private void publishReceipts() {
    JSONObject status = new JSONObject();
    put(status, "pending", receipts.pending());
    put(status, "verifying", receipts.verifying());
    put(status, "retry", receipts.needsRetry());
    emit("purchases", status);
  }

  /** Add a billing result field to the WebView response object. */
  private static void put(JSONObject object, String key, Object value) {
    try {
      object.put(key, value);
    } catch (JSONException unexpected) { throw new IllegalStateException(unexpected); }
  }

  /** Hash the account identity into the obfuscated Play account binding. */
  private static String binding(String subject) {
    try {
      StringBuilder hash = new StringBuilder(64);
      for (byte b : MessageDigest.getInstance("SHA-256").digest(subject.getBytes(StandardCharsets.UTF_8)))
        hash.append(String.format(Locale.ROOT, "%02x", b & 255));
      return hash.toString();
    } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }

  /** Verify the provider receipt off the UI thread and publish its delivery status. */
  private void verify(String token) {
    worker.execute(() -> {
      boolean verified = false;
      try {
        IdentityService service = new IdentityService(activity);
        IdentityService.Session auth = AccountStore.online(activity, service, subject, null);
        try {
          service.verifyPlay(auth.access, token);
        } catch (IdentityService.HttpFailure error) {
          if (error.status != 401) throw error;
          service.verifyPlay(AccountStore.online(activity, service, subject, auth).access, token);
        }
        verified = true;
      } catch (Exception unavailable) {
        // Keep an owned receipt retryable. Provider exceptions may contain the purchase token.
      }
      final boolean delivered = verified;
      main.post(() -> {
        if (closed) return;
        receipts.complete(token, delivered);
        publishReceipts();
        if (delivered) signal("balanceChanged");
      });
    });
  }

  /** Start checkout only while the active subject and quoted purchase details are current. */
  private void launch(String sku) {
    if (!active() || checkoutOpen) return;
    BillingFlowParams.ProductDetailsParams item = offers.get(sku);
    if (!client.isReady() || item == null) {
      signal("unavailable");
      return;
    }
    checkoutOpen = true;
    BillingResult result = client.launchBillingFlow(activity, BillingFlowParams.newBuilder()
        .setObfuscatedAccountId(accountBinding).setProductDetailsParamsList(Collections.singletonList(item)).build());
    if (result.getResponseCode() != OK) {
      checkoutOpen = false;
      checkoutFailure(result.getResponseCode());
    }
  }

  /** Handle cancellation and already-owned products distinctly from an unavailable checkout. */
  private void checkoutFailure(int code) {
    if (code == ITEM_ALREADY_OWNED) loadInventory();
    else signal(code == USER_CANCELED ? "cancelled" : "checkoutUnavailable");
  }

  /** Reconcile purchases delivered by the Play billing callback. */
  @Override public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
    main.post(() -> {
      checkoutOpen = false;
      if (!active()) return;
      if (result.getResponseCode() != OK) {
        checkoutFailure(result.getResponseCode());
        return;
      }
      ++inventoryQuery; // A query started before this update must not retire its receipt.
      if (purchases == null || purchases.isEmpty()) {
        loadInventory();
        return;
      }
      observe(purchases);
      publishReceipts();
      // The callback is incremental. Keep other owned receipts until the next full query.
      signal("balanceChanged");
    });
  }

  /** Release this distribution's billing integration when leaving the activity. */
  void close() {
    closed = true;
    web.removeJavascriptInterface("PlayMarket");
    client.endConnection();
    worker.shutdownNow();
  }
}
