package app.anglers.journal;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import android.widget.*;
import java.io.IOException;
import java.io.InputStream;

/** Native account screens share the river photography, typography and colours of the journal. */
final class AccountLayout {
  enum Action {
    PRIMARY,
    SECONDARY,
    DANGER,
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
    boolean systemDark =
        (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
    dark =
        activity
            .getSharedPreferences("appearance", Activity.MODE_PRIVATE)
            .getBoolean("dark", systemDark);
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
    if (android.os.Build.VERSION.SDK_INT >= 30) {
      android.view.WindowInsetsController bars = window.getInsetsController();
      int flags =
          android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
              | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
      if (bars != null) bars.setSystemBarsAppearance(dark ? 0 : flags, flags);
    } else {
      window
          .getDecorView()
          .setSystemUiVisibility(
              dark
                  ? 0
                  : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                      | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

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
    button(form, AppLanguage.text(activity, "common.help"), Action.LINK, this::showGuide);
    status = text("", 15, muted, Typeface.DEFAULT);
    status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    add(form, status, 8);
    status.setVisibility(View.GONE);
  }

  /** Open the same bundled guide during sign-in, without exposing the authenticated bridge. */
  private void showGuide() {
    WebView web = new WebView(activity);
    web.setBackgroundColor(surface);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.setWebViewClient(new LocalAssetClient(activity.getAssets(), ignored -> {}));
    Uri guide = Uri.parse(LocalAssetClient.ENTRY).buildUpon()
        .path("/guide.html")
        .appendQueryParameter("lang", activity.getResources().getConfiguration().getLocales().get(0).toLanguageTag())
        .appendQueryParameter("theme", dark ? "dark" : "light")
        .fragment(activity instanceof WaterSettingsActivity ? "start" : activity instanceof GroupsActivity ? "groups" : "accounts")
        .build();
    Prompt reader = new Prompt(AppLanguage.text(activity, "common.help"), web);
    reader.action(AppLanguage.text(activity, "common.close"), Action.SECONDARY, null);
    reader.setOnDismissListener(ignored -> {
      ((LinearLayout) web.getParent()).removeView(web);
      web.destroy();
    });
    reader.show();
    web.loadUrl(guide.toString());
  }

  void message(String message) {
    status.setText(message);
    status.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
  }

  /** Provide the same explanation on a tap, a long press and through accessibility focus. */
  void explain(String fieldName, String explanation, View field) {
    field.setTooltipText(explanation);
    String label = AppLanguage.text(activity, "common.explain") + " · " + fieldName;
    button((LinearLayout) field.getParent(), label, Action.LINK, () -> {
      Prompt hint = prompt(fieldName);
      hint.description(explanation);
      hint.action(AppLanguage.text(activity, "common.close"), Action.SECONDARY, null);
      hint.show();
    });
  }

  TextView label(String s) {
    TextView v = text(s, 16, muted, Typeface.DEFAULT);
    v.setLineSpacing(dp(2), 1);
    add(form, v, 8);
    return v;
  }

  void tip(String byline, String message) {
    LinearLayout card = new LinearLayout(activity);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setBackground(shape(surface, border, 14));
    card.setPadding(dp(16), dp(12), dp(16), dp(14));
    add(form, card, 12);
    card.addView(text(byline, 14, muted, Typeface.create("sans-serif-medium", 0)));
    TextView body = text(message, 17, ink, Typeface.DEFAULT);
    body.setTextIsSelectable(true);
    add(card, body, 8);
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
    int foreground = kind == Action.PRIMARY ? onPrimary : primary;
    int outline = kind == Action.SECONDARY ? border : 0;
    if (kind == Action.DANGER) {
      fill = colour("#FFF1E8", "#492D25");
      foreground = colour("#8F3526", "#FFD6CC");
      outline = colour("#B77D6D", "#A87C68");
    }
    b.setTextColor(
        new ColorStateList(
            new int[][] {{-android.R.attr.state_enabled}, {}}, new int[] {muted, foreground}));
    Drawable background = shape(fill, outline, 14);
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
    return field(form, hint, type);
  }

  private EditText field(LinearLayout parent, String hint, int type) {
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
    add(parent, f, 12);
    return f;
  }

  /** A journal-styled modal with scrollable content and actions that stay within reach. */
  final class Prompt extends Dialog {
    private final LinearLayout body;
    private final LinearLayout actions;

    Prompt(String title) {
      this(title, null);
    }

    Prompt(String title, WebView reader) {
      super(activity);
      requestWindowFeature(Window.FEATURE_NO_TITLE);
      setTitle(title);
      LinearLayout panel = new LinearLayout(activity);
      panel.setOrientation(LinearLayout.VERTICAL);
      panel.setPadding(dp(20), dp(20), dp(20), dp(16));
      panel.setBackground(shape(surface, colour("#CFDBCE", "#3B5148"), 18));
      panel.setFocusableInTouchMode(true);
      body = new LinearLayout(activity);
      body.setOrientation(LinearLayout.VERTICAL);
      if (reader == null) {
        ScrollView scroll = new ScrollView(activity);
        panel.addView(scroll, new LinearLayout.LayoutParams(-1, -2, 1));
        scroll.addView(body);
      } else {
        panel.addView(body);
        // The guide scrolls in the WebView. The native Close action stays reachable.
        int preferredHeight = dp(activity.getResources().getConfiguration().screenHeightDp * 0.55f);
        panel.addView(reader, new LinearLayout.LayoutParams(-1, preferredHeight, 1));
      }
      LinearLayout header = new LinearLayout(activity);
      header.setGravity(Gravity.CENTER_VERTICAL);
      body.addView(header);
      ImageView mark = new ImageView(activity);
      mark.setImageResource(R.drawable.fish);
      mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      mark.setBackground(shape(0xff154b43, 0, 10));
      mark.setClipToOutline(true);
      header.addView(mark, new LinearLayout.LayoutParams(dp(36), dp(36)));
      TextView heading = text(title, 23, ink, Typeface.create("serif", Typeface.BOLD));
      if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
      LinearLayout.LayoutParams label = new LinearLayout.LayoutParams(0, -2, 1);
      label.setMarginStart(dp(12));
      header.addView(heading, label);
      actions = new LinearLayout(activity);
      actions.setOrientation(LinearLayout.VERTICAL);
      add(panel, actions, 4);
      setContentView(panel);
      Window window = getWindow();
      window.setBackgroundDrawableResource(android.R.color.transparent);
      int width =
          Math.min(dp(448), dp(activity.getResources().getConfiguration().screenWidthDp - 32));
      window.setLayout(width, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
      window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
      setCanceledOnTouchOutside(true);
    }

    void description(String value) {
      TextView paragraph = text(value, 16, ink, Typeface.DEFAULT);
      paragraph.setLineSpacing(dp(3), 1);
      add(body, paragraph, 14);
    }

    void code(String value) {
      TextView token = text(value, 17, primary, Typeface.MONOSPACE);
      token.setTextIsSelectable(true);
      token.setBackground(shape(colour("#DCEAE0", "#29463B"), 0, 12));
      token.setPadding(dp(14), dp(12), dp(14), dp(12));
      add(body, token, 14);
    }

    EditText input(String hint, int type) {
      return field(body, hint, type);
    }

    void choice(String label, Action kind, Runnable next) {
      button(
          body,
          label,
          kind,
          () -> {
            dismiss();
            next.run();
          });
    }

    /** The editor keeps the dialog open until validation and the server request succeed. */
    void submit(String label, Runnable submit) {
      button(actions, label, Action.PRIMARY, submit).setId(android.R.id.button1);
    }

    void action(String label, Action kind, Runnable next) {
      button(
              actions,
              label,
              kind,
              () -> {
                dismiss();
                if (next != null) next.run();
              })
          .setId(kind == Action.SECONDARY ? android.R.id.button2 : android.R.id.button1);
    }
  }

  Prompt prompt(String title) {
    return new Prompt(title);
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
