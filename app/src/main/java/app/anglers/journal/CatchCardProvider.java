package app.anglers.journal;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/** Exposes one short-lived JPEG through a per-file Android read grant. */
public final class CatchCardProvider extends ContentProvider {
  private static final long LIFETIME = TimeUnit.DAYS.toMillis(1);
  private static final Pattern NAME =
      Pattern.compile("[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\\.jpg");

  /** Select the app-private location for exported catch cards. */
  private static File directory(Context context) {
    return new File(context.getCacheDir(), "shared-catches");
  }

  /** Write a shareable catch-card file and return its content URI. */
  static Uri publish(Context context, byte[] jpeg) throws IOException {
    File dir = directory(context);
    if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory())
      throw new IOException("Cache unavailable");
    purgeExpired(dir);
    String name = UUID.randomUUID() + ".jpg";
    File card = new File(dir, name);
    try (FileOutputStream out = new FileOutputStream(card)) {
      out.write(jpeg);
    } catch (IOException error) {
      card.delete();
      throw error;
    }
    return new Uri.Builder()
        .scheme("content")
        .authority(context.getPackageName() + ".catchcards")
        .appendPath(name)
        .build();
  }

  /** Remove exported files that have outlived the sharing period. */
  private static void purgeExpired(File dir) {
    File[] files = dir.listFiles();
    if (files != null) for (File file : files) if (expired(file)) file.delete();
  }

  /** Determine whether the temporary export is beyond its allowed lifetime. */
  private static boolean expired(File file) {
    return file.lastModified() <= System.currentTimeMillis() - LIFETIME;
  }

  /** Purge expired card exports when Android initializes the provider. */
  @Override
  public boolean onCreate() {
    purgeExpired(directory(getContext()));
    return true;
  }

  /** Check the export URI before exposing a file to a recipient. */
  private File resolve(Uri uri) {
    String name = uri.getLastPathSegment();
    if (!("content".equals(uri.getScheme())
        && (getContext().getPackageName() + ".catchcards").equals(uri.getAuthority())
        && name != null
        && NAME.matcher(name).matches()
        && ("/" + name).equals(uri.getEncodedPath()))) return null;
    File file = new File(directory(getContext()), name);
    return file.isFile() && !expired(file) ? file : null;
  }

  /** Open the validated catch export for a recipient's read request. */
  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    File file = resolve(uri);
    if (!"r".equals(mode) || file == null) throw new FileNotFoundException("Card unavailable");
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
  }

  /** Return share-sheet metadata for the requested export. */
  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
    String[] columns =
        projection != null
            ? projection
            : new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
    MatrixCursor result = new MatrixCursor(columns);
    File file = resolve(uri);
    if (file != null) {
      MatrixCursor.RowBuilder row = result.newRow();
      for (String col : columns) {
        if (OpenableColumns.DISPLAY_NAME.equals(col)) row.add("catch-photo.jpg");
        else if (OpenableColumns.SIZE.equals(col)) row.add(file.length());
        else row.add(null);
      }
    }
    return result;
  }

  /** Expose the media type of the validated shared card. */
  @Override
  public String getType(Uri uri) {
    return resolve(uri) == null ? null : "image/jpeg";
  }

  /** Reject resolver inserts because the journal publishes complete card files. */
  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException();
  }

  /** Keep a published export immutable for its recipient. */
  @Override
  public int update(Uri uri, ContentValues values, String selection, String[] args) {
    throw new UnsupportedOperationException();
  }

  /** Keep deletion of exported cards under the provider's expiry policy. */
  @Override
  public int delete(Uri uri, String selection, String[] args) {
    throw new UnsupportedOperationException();
  }
}
