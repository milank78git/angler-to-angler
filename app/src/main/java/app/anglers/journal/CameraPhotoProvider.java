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
import java.io.IOException;
import java.util.UUID;

/** One temporary, app-owned output URI granted only to the chosen camera. */
public final class CameraPhotoProvider extends ContentProvider {
  /** Select the app-private directory used for temporary camera captures. */
  private static File directory(Context context) {
    return new File(context.getCacheDir(), "camera");
  }

  /** Allocate a temporary capture destination that can be shared with the camera app. */
  static Uri create(Context context) throws IOException {
    File dir = directory(context);
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Camera directory");
    File[] previous = dir.listFiles();
    if (previous != null)
      for (File file : previous)
        if (file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
    File out = new File(dir, UUID.randomUUID() + ".jpg");
    if (!out.createNewFile()) throw new IOException("Camera output");
    return new Uri.Builder()
        .scheme("content")
        .authority(context.getPackageName() + ".camera")
        .appendPath(out.getName())
        .build();
  }

  /** Delete the temporary capture identified by the provider URI. */
  static void discard(Context context, Uri uri) {
    if (uri != null) {
      File file = resolve(context, uri);
      if (file != null) file.delete();
    }
  }

  /** Validate the requested capture URI before resolving its app-private file. */
  private static File resolve(Context context, Uri uri) {
    String name = uri.getLastPathSegment();
    if (name == null
        || !name.matches("[0-9a-f-]{36}\\.jpg")
        || !("/" + name).equals(uri.getEncodedPath())) return null;
    File file = new File(directory(context), name);
    return file.isFile() ? file : null;
  }

  /** Open only the validated temporary camera file for the requested access mode. */
  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    File file = resolve(getContext(), uri);
    if (file == null) throw new FileNotFoundException();
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode));
  }

  /** Make the provider available before a capture file is requested. */
  @Override
  public boolean onCreate() {
    return true;
  }

  /** Expose the MIME type expected by the camera activity. */
  @Override
  public String getType(Uri uri) {
    return resolve(getContext(), uri) == null ? null : "image/jpeg";
  }

  /** Return file metadata for the validated temporary capture. */
  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
    String[] columns =
        projection == null
            ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
            : projection;
    MatrixCursor result = new MatrixCursor(columns);
    File file = resolve(getContext(), uri);
    if (file != null) {
      MatrixCursor.RowBuilder row = result.newRow();
      for (String col : columns) {
        if (OpenableColumns.DISPLAY_NAME.equals(col)) row.add("catch.jpg");
        else if (OpenableColumns.SIZE.equals(col)) row.add(file.length());
        else row.add(null);
      }
    }
    return result;
  }

  /** Reject content-resolver inserts because captures are allocated by the app. */
  @Override
  public Uri insert(Uri u, ContentValues v) {
    throw new UnsupportedOperationException();
  }

  /** Reject provider metadata changes to temporary captures. */
  @Override
  public int update(Uri u, ContentValues v, String s, String[] a) {
    throw new UnsupportedOperationException();
  }

  /** Leave file cleanup to the capture owner. */
  @Override
  public int delete(Uri u, String s, String[] a) {
    throw new UnsupportedOperationException();
  }
}
