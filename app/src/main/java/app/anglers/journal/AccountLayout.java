package app.anglers.journal;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.*;
import java.io.IOException;
import java.io.InputStream;

/** Native account screens share the river photography, typography and colours of the journal. */
final class AccountLayout {
  enum Action {
    PRIMARY,
    SECONDARY,
    LINK
  }

  private final Activity activity;
  private final boolean dark;
  private final int paper, surface, ink, muted, border, primary, onPrimary;
  private Bitmap river;
  LinearLayout form;
  TextView status;

  AccountLayout(Activity activity) {
    this.activity = activity;
    dark =
        (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
    paper = colour("#F5F6EF", "#101D1C");
    surface = colour("#FFFEF8", "#1B2E2A");
    ink = colour("#142F2B", "#EEF4E9");
    muted = colour("#50635C", "#B8CBBF");
    border = colour("#71867C", "#86988C");
    primary = colour("#165449", "#9DD9BD");
    onPrimary = colour("#FFFFFF", "#11342C");
    try (InputStream in = activity.getAssets().open("sazava.webp")) {
      river = BitmapFactory.decodeStream(in);
    } catch (IOException ignored) {
      /* The same masthead also works with a solid background. */
    }
  }

  private int colour(String day, String night) {
    return Color.parseColor(dark ? night : day);
  }

  private int dp(float v) {
    return Math.round(v * activity.getResources().getDisplayMetrics().density);
  }

  private GradientDrawable shape(int fill, int stroke, int radius) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(fill);
    d.setCornerRadius(dp(radius));
    if (stroke != 0) d.setStroke(dp(1), stroke);
    return d;
  }

  private TextView text(String title, int size, int color, Typeface face) {
    TextView v = new TextView(activity);
    v.setText(title);
    v.setTextSize(size);
    v.setTextColor(color);
    v.setTypeface(face);
    v.setIncludeFontPadding(false);
    return v;
  }

  private void add(LinearLayout parent, View child, int gap) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.topMargin = dp(gap);
    parent.addView(child, p);
  }

  void page(String title, boolean cover) {
    Window window = activity.getWindow();
    window.setStatusBarColor(paper);
    window.setNavigationBarColor(paper);
    window
        .getDecorView()
        .setSystemUiVisibility(
            dark
                ? 0
                : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    ScrollView scroll = new ScrollView(activity);
    scroll.setBackgroundColor(paper);
    scroll.setFitsSystemWindows(true);
    scroll.setFillViewport(true);
    LinearLayout column =
        new LinearLayout(activity) {
          @Override
          protected void onMeasure(int width, int height) {
            int limit = Math.min(MeasureSpec.getSize(width), dp(524));
            super.onMeasure(MeasureSpec.makeMeasureSpec(limit, MeasureSpec.EXACTLY), height);
          }
        };
    column.setOrientation(LinearLayout.VERTICAL);
    column.setPadding(dp(20), dp(14), dp(20), dp(20));
    column.setFocusableInTouchMode(true);
    scroll.addView(
        column, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL));
    activity.setContentView(scroll);

    FrameLayout masthead = new FrameLayout(activity);
    masthead.setBackground(shape(0xff163e36, 0, 20));
    masthead.setClipToOutline(true);
    column.addView(masthead, new LinearLayout.LayoutParams(-1, dp(cover ? 180 : 110)));
    if (river != null) {
      ImageView photo = new ImageView(activity);
      photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
      photo.setImageBitmap(river);
      photo.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      masthead.addView(photo, new FrameLayout.LayoutParams(-1, -1));
    }
    View shade = new View(activity);
    shade.setBackground(
        new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] {0x25152c27, 0x18091412, 0xdf092b25}));
    masthead.addView(shade, new FrameLayout.LayoutParams(-1, -1));
    TextView brand =
        text(
            activity.getString(R.string.app_name),
            cover ? 34 : 26,
            Color.WHITE,
            Typeface.create("serif", Typeface.BOLD));
    FrameLayout.LayoutParams wordmark =
        new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.START);
    wordmark.setMargins(dp(18), 0, dp(16), dp(15));
    masthead.addView(brand, wordmark);
    TextView version =
        text(AppVersion.label(activity), 12, Color.WHITE, Typeface.create("sans-serif-medium", 0));
    version.setPadding(dp(10), dp(5), dp(10), dp(5));
    version.setBackground(shape(0xd816372f, 0, 18));
    FrameLayout.LayoutParams tag = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END);
    tag.setMargins(dp(12), dp(12), dp(12), 0);
    masthead.addView(version, tag);

    form = new LinearLayout(activity);
    form.setOrientation(LinearLayout.VERTICAL);
    form.setPadding(dp(4), 0, dp(4), 0);
    add(column, form, 24);
    TextView heading = text(title, 28, ink, Typeface.create("sans-serif-medium", 0));
    if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
    form.addView(heading);
    status = text("", 15, muted, Typeface.DEFAULT);
    status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    add(form, status, 8);
    status.setVisibility(View.GONE);
  }

  void message(String message) {
    status.setText(message);
    status.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
  }

  TextView label(String s) {
    TextView v = text(s, 16, muted, Typeface.DEFAULT);
    v.setLineSpacing(dp(2), 1);
    add(form, v, 8);
    return v;
  }

  Button button(LinearLayout parent, String label, Action kind, Runnable click) {
    Button b = new Button(activity);
    b.setAllCaps(false);
    b.setText(label);
    b.setTextSize(16);
    b.setTypeface(Typeface.create("sans-serif-medium", 0));
    b.setLetterSpacing(0);
    b.setMinHeight(dp(kind == Action.LINK ? 48 : 52));
    b.setPadding(dp(16), dp(8), dp(16), dp(8));
    int fill = kind == Action.PRIMARY ? primary : kind == Action.SECONDARY ? surface : paper;
    b.setTextColor(
        new ColorStateList(
            new int[][] {{-android.R.attr.state_enabled}, {}},
            new int[] {muted, kind == Action.PRIMARY ? onPrimary : primary}));
    Drawable background = shape(fill, kind == Action.SECONDARY ? border : 0, 14);
    android.graphics.drawable.StateListDrawable states =
        new android.graphics.drawable.StateListDrawable();
    states.addState(
        new int[] {-android.R.attr.state_enabled}, shape(colour("#DAE2DA", "#2D413B"), 0, 14));
    states.addState(new int[] {}, background);
    b.setStateListAnimator(null);
    b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x35799c8d), states, null));
    b.setOnClickListener(v -> click.run());
    add(parent, b, kind == Action.LINK ? 3 : 10);
    return b;
  }

  EditText field(String hint, int type) {
    EditText f = new EditText(activity);
    f.setSingleLine();
    f.setInputType(type);
    f.setHint(hint);
    f.setTextSize(16);
    f.setTextColor(ink);
    f.setHintTextColor(muted);
    f.setPadding(dp(16), dp(10), dp(16), dp(10));
    f.setMinHeight(dp(52));
    android.graphics.drawable.StateListDrawable state =
        new android.graphics.drawable.StateListDrawable();
    state.addState(new int[] {android.R.attr.state_focused}, shape(surface, primary, 14));
    state.addState(new int[] {}, shape(surface, border, 14));
    f.setBackground(state);
    add(form, f, 12);
    return f;
  }

  CheckBox check(String title) {
    CheckBox b = new CheckBox(activity);
    b.setText(title);
    b.setTextSize(16);
    b.setTextColor(ink);
    b.setMinHeight(dp(48));
    b.setButtonTintList(ColorStateList.valueOf(primary));
    add(form, b, 5);
    return b;
  }
}
