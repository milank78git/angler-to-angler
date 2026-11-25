package app.anglers.journal;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.function.Consumer;

/**
 * Serves the private journal origin and permits public topographic tile images. HTTPS links open
 * externally.
 */
final class LocalAssetClient extends WebViewClient {
  private static final String HOST = "journal.invalid";
  static final String ENTRY = "https://" + HOST + "/index.html";
  private final android.content.Context context;
  private final AssetManager assets;
  private final Consumer<Uri> openExternal;

  LocalAssetClient(AssetManager assets, Consumer<Uri> openExternal) {
    this(null, assets, openExternal);
  }

  LocalAssetClient(android.content.Context context, AssetManager assets, Consumer<Uri> openExternal) {
    this.context = context;
    this.assets = assets;
    this.openExternal = openExternal;
  }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    Uri uri = request.getUrl();
    String path = uri.getPath();
    // Let WebView use its normal HTTP image cache. The map provider receives only tile coordinates.
    if (context != null && !request.isForMainFrame() && "GET".equals(request.getMethod())
        && "https".equals(uri.getScheme()) && "tile.openmaps.fr".equals(uri.getEncodedAuthority())
        && uri.getEncodedQuery() == null && path != null
        && path.matches("/opentopomap/(?:[0-9]|1[0-7])/[0-9]{1,6}/[0-9]{1,6}\\.png")) {
      return null;
    }
    if ("https".equals(uri.getScheme())
        && HOST.equals(uri.getHost())
        && path != null
        && path.matches("/[a-z][a-z0-9.-]*")) {
      try {
        if (context != null && path.equals("/water-update.json")) {
          return new WebResourceResponse("application/json", "utf-8", 200, "OK",
              java.util.Collections.singletonMap("Cache-Control", "no-store"),
              WaterCatalogue.open(context, uri.getQueryParameter("revision")));
        }
        String mime = contentType(path);
        return new WebResourceResponse(
            mime, "image/webp".equals(mime) ? null : "utf-8", assets.open(path.substring(1)));
      } catch (IOException ignored) {
        /* Missing assets receive the same response as unknown paths. */
      }
    }
    return new WebResourceResponse(
        "text/plain", "utf-8", 404, "Missing", null, new ByteArrayInputStream(new byte[0]));
  }

  private static String contentType(String path) {
    switch (path.substring(path.lastIndexOf('.') + 1)) {
      case "html":
        return "text/html";
      case "js":
        return "text/javascript";
      case "css":
        return "text/css";
      case "webp":
        return "image/webp";
      case "svg":
        return "image/svg+xml";
      case "json":
        return "application/json";
      default:
        return "text/plain";
    }
  }

  @Override
  public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
    Uri uri = request.getUrl();
    if (request.isForMainFrame()
        && request.hasGesture()
        && "https".equals(uri.getScheme())
        && !HOST.equals(uri.getHost())) openExternal.accept(uri);
    return true;
  }
}
