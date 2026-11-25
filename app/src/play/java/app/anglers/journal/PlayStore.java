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
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final BillingClient client;
  private final Map<String,ProductDetails> products = new HashMap<>();
  private final Map<String,ProductDetails.OneTimePurchaseOfferDetails> offers = new HashMap<>();
  private boolean connecting,closed;

  PlayStore(FishingActivity activity, WebView web, String subject) {
    this.activity=activity;
    this.web=web;
    this.subject=subject;
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
    client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
        (result,purchases)->{ if (result.getResponseCode()==0) deliver(purchases); });
  }
  private void launch(String sku) {
    if (!active() || !client.isReady() || !products.containsKey(sku)) { emit("unavailable"); return; }
    try {
      StringBuilder account=new StringBuilder();
      for (byte b:MessageDigest.getInstance("SHA-256").digest(subject.getBytes(StandardCharsets.UTF_8)))
        account.append(String.format(Locale.ROOT,"%02x",b & 255));
      BillingFlowParams.ProductDetailsParams item=BillingFlowParams.ProductDetailsParams.newBuilder()
          .setProductDetails(products.get(sku)).setOfferToken(offers.get(sku).getOfferToken()).build();
      BillingResult result=client.launchBillingFlow(activity,BillingFlowParams.newBuilder()
          .setObfuscatedAccountId(account.toString()).setProductDetailsParamsList(Collections.singletonList(item)).build());
      if (result.getResponseCode()!=0) emit("unavailable");
    } catch (Exception error) { emit("unavailable"); }
  }
  public void onPurchasesUpdated(BillingResult result,List<Purchase> purchases) {
    if (result.getResponseCode()==0 && purchases!=null) deliver(purchases);
    else if (result.getResponseCode()!=BillingClient.BillingResponseCode.USER_CANCELED) emit("unavailable");
  }
  private void deliver(List<Purchase> purchases) {
    handler.post(()->{
      if (!active()) return;
      for (Purchase purchase:purchases) {
        if (purchase.getPurchaseState()!=Purchase.PurchaseState.PURCHASED) { emit("pending"); continue; }
        worker.execute(()->{
          try {
            IdentityService service=new IdentityService(activity);
            IdentityService.Session auth=AccountStore.online(activity,service,subject,null);
            service.verifyPlay(auth.access,purchase.getPurchaseToken());
            emit("credited");
          } catch (Exception error) { emit("pending"); }
        });
      }
    });
  }
  void close() {
    closed=true; web.removeJavascriptInterface("PlayMarket"); client.endConnection(); worker.shutdown();
  }
}
