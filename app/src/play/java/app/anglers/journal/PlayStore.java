package app.anglers.journal;

import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.android.billingclient.api.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Play only. Prices come from ProductDetails; tokens never enter the WebView. */
final class PlayStore implements PurchasesUpdatedListener {
  private final FishingActivity activity;
  private final WebView web;
  private final String subject;
  private final String accountBinding;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final BillingClient client;
  private final Map<String,ProductDetails> products = new HashMap<>();
  private final Map<String,ProductDetails.OneTimePurchaseOfferDetails> offers = new HashMap<>();
  private boolean connecting,closed;
  // Access receipt state only on the main thread. The WebView never receives a token.
  private final Set<String> verifying = new HashSet<>();
  private final Set<String> confirmed = new HashSet<>();
  private final Set<String> retry = new HashSet<>();
  private boolean pending;
  private long ownershipQuery;

  PlayStore(FishingActivity activity, WebView web, String subject) {
    this.activity=activity;
    this.web=web;
    this.subject=subject;
    this.accountBinding=binding(subject);
    client=BillingClient.newBuilder(activity).setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection().build();
    web.addJavascriptInterface(new Controls(),"PlayMarket");
  }

  private boolean active() { return !closed && !activity.isFinishing() && subject.equals(AccountStore.active(activity)); }
  private void emit(String state, JSONObject data) {
    handler.post(()->{
      if (active()) web.evaluateJavascript("window.playMarketResult?.("+JSONObject.quote(state)+","+data+")",null);
    });
  }
  private void emit(String state) { emit(state,new JSONObject()); }

  public final class Controls {
    @JavascriptInterface public void refresh() { handler.post(()->resume()); }
    @JavascriptInterface public void buy(String sku) { handler.post(()->launch(sku)); }
  }
  void resume() {
    if (!active()) return;
    if (client.isReady()) { query(); return; }
    if (connecting) return;
    connecting=true;
    client.startConnection(new BillingClientStateListener() {
      public void onBillingSetupFinished(BillingResult result) {
        handler.post(()->{ connecting=false; if (active() && result.getResponseCode()==0) query(); else emit("unavailable"); });
      }
      public void onBillingServiceDisconnected() { handler.post(()->{connecting=false;emit("unavailable");}); }
    });
  }
  private void query() {
    List<QueryProductDetailsParams.Product> requested=new ArrayList<>();
    for (String sku:Arrays.asList("credits_50_czk","credits_100_czk"))
      requested.add(QueryProductDetailsParams.Product.newBuilder().setProductId(sku).setProductType(BillingClient.ProductType.INAPP).build());
    client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(requested).build(),
      (result,details)->handler.post(()->{
        if (!active()) return;
        products.clear(); offers.clear();
        JSONObject prices=new JSONObject();
        if (result.getResponseCode()==0) for (ProductDetails p:details.getProductDetailsList()) {
          List<ProductDetails.OneTimePurchaseOfferDetails> options=p.getOneTimePurchaseOfferDetailsList();
          if (options==null) continue;
          long target="credits_50_czk".equals(p.getProductId())?50000000L:100000000L;
          for (ProductDetails.OneTimePurchaseOfferDetails offer:options) {
            if (!"CZK".equals(offer.getPriceCurrencyCode()) || offer.getPriceAmountMicros()!=target) continue;
            products.put(p.getProductId(),p); offers.put(p.getProductId(),offer);
            try { prices.put(p.getProductId(),offer.getFormattedPrice()); } catch (JSONException ignored) {}
            break;
          }
        }
        emit(prices.length()>0?"prices":"unavailable",prices);
      }));
    refreshPurchases();
  }
  private void refreshPurchases() {
    long request = ++ownershipQuery;
    client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
        (result, purchases) -> handler.post(() -> {
          if (!active() || request != ownershipQuery) return;
          if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            emit("purchaseUnavailable");
            return;
          }
          pending = false;
          Set<String> current = new HashSet<>();
          for (Purchase purchase : purchases) {
            AccountIdentifiers owner = purchase.getAccountIdentifiers();
            if (owner == null || !accountBinding.equals(owner.getObfuscatedAccountId())) continue;
            if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
              pending = true;
            } else if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
              String token = purchase.getPurchaseToken();
              current.add(token);
              if (!confirmed.contains(token) && verifying.add(token)) {
                retry.remove(token);
                worker.execute(() -> verify(token));
              }
            }
          }
          confirmed.retainAll(current);
          retry.retainAll(current);
          emitPurchaseStatus();
        }));
  }

  private static String binding(String subject) {
    try {
      StringBuilder hash = new StringBuilder();
      for (byte b : MessageDigest.getInstance("SHA-256").digest(subject.getBytes(StandardCharsets.UTF_8)))
        hash.append(String.format(Locale.ROOT, "%02x", b & 255));
      return hash.toString();
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private void emitPurchaseStatus() {
    JSONObject states = new JSONObject();
    try {
      states.put("pending", pending);
      states.put("verifying", !verifying.isEmpty());
      states.put("retry", !retry.isEmpty());
    } catch (JSONException unexpected) { throw new IllegalStateException(unexpected); }
    emit("purchases", states);
  }

  private void verify(String token) {
    boolean success = false;
    try {
      IdentityService service = new IdentityService(activity);
      IdentityService.Session auth = AccountStore.online(activity, service, subject, null);
      service.verifyPlay(auth.access, token);
      success = true;
    } catch (Exception failure) { /* The next ownership query retries incomplete delivery. */ }
    final boolean credited = success;
    handler.post(() -> {
      if (!active()) return;
      verifying.remove(token);
      if (credited) confirmed.add(token);
      else retry.add(token);
      emitPurchaseStatus();
      if (credited) emit("credited");
    });
  }
  private void launch(String sku) {
    if (!active() || !client.isReady() || !products.containsKey(sku)) { emit("unavailable"); return; }
    try {
      BillingFlowParams.ProductDetailsParams item=BillingFlowParams.ProductDetailsParams.newBuilder()
          .setProductDetails(products.get(sku)).setOfferToken(offers.get(sku).getOfferToken()).build();
      BillingResult result=client.launchBillingFlow(activity,BillingFlowParams.newBuilder()
          .setObfuscatedAccountId(accountBinding).setProductDetailsParamsList(Collections.singletonList(item)).build());
      if (result.getResponseCode()==BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) refreshPurchases();
      else if (result.getResponseCode()!=BillingClient.BillingResponseCode.OK) emit("purchaseUnavailable");
    } catch (Exception error) { emit("unavailable"); }
  }
  public void onPurchasesUpdated(BillingResult result,List<Purchase> purchases) {
    handler.post(() -> {
      if (!active()) return;
      int code = result.getResponseCode();
      if (code == BillingClient.BillingResponseCode.OK) {
        // A server notification may already have consumed the purchase. Read the durable balance again.
        if (purchases != null && purchases.stream().anyMatch(p -> p.getPurchaseState() == Purchase.PurchaseState.PURCHASED))
          emit("refreshBalance");
        refreshPurchases();
      } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) refreshPurchases();
      else if (code == BillingClient.BillingResponseCode.USER_CANCELED) emit("cancelled");
      else emit("purchaseUnavailable");
    });
  }
  void close() {
    closed=true; web.removeJavascriptInterface("PlayMarket"); client.endConnection(); worker.shutdown();
  }
}
