package com.vick.stickerforge;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.text.BreakIterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@SuppressWarnings("deprecation")
public class EditorActivity extends Activity {
    private static final int[] COLORS = {Color.WHITE, Color.BLACK, 0xFFFF1744, 0xFFFFEA00, 0xFF00E676,
            0xFF2979FF, 0xFFD500F9, 0xFFFF9100};

    private StickerMaker.FrameSource src;
    private PackStore.Pack pack;
    private List<PackStore.Pack> packs;
    private StickerCanvasView canvas;
    private LinearLayout panel;
    private EditText emoji;
    private SeekBar start, length;
    private TextView timeLbl;
    private RadioGroup fpsGroup;
    private long durMs;
    private boolean trimmed;
    private int fpsChoice = 10;
    private long trimStart, trimLen;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("Editar sticker");
        packs = PackStore.load(this);
        pack = PackStore.find(packs, getIntent().getStringExtra("id"));
        Uri uri = getIntent().getData();
        trimmed = getIntent().getBooleanExtra("trimmed", false);
        if (!trimmed && StickerMaker.isVideo(this, uri)) {
            // Videos pasan primero por la pantalla de fragmento y recorte
            startActivity(new Intent(this, VideoTrimActivity.class).setData(uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .putExtras(getIntent()).putExtra("animated", pack.animated));
            finish();
            return;
        }
        try {
            if (trimmed) {
                src = new StickerMaker.CroppedSource(StickerMaker.open(this, uri, 2048), getIntent().getFloatArrayExtra("crop"));
                trimStart = getIntent().getLongExtra("start", 0);
                trimLen = Math.max(500, getIntent().getLongExtra("end", 3000) - trimStart);
            } else {
                src = StickerMaker.open(this, uri);
            }
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo abrir el archivo: " + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        durMs = src.durationMs();
        if (pack.animated && durMs <= 0) {
            Toast.makeText(this, "Este paquete es animado: elige un video o GIF", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        int pad = Ui.dp(this, 12);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(pad, pad, pad, pad);

        canvas = new StickerCanvasView(this);
        l.addView(canvas);
        TextView hint = Ui.label(this, "1 dedo: mover · 2 dedos: zoom y girar · toca un texto para editarlo");
        hint.setTextSize(12);
        l.addView(hint);

        HorizontalScrollView tabsScroll = new HorizontalScrollView(this);
        LinearLayout tabs = new LinearLayout(this);
        tabsScroll.addView(tabs);
        l.addView(tabsScroll);
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(0, pad / 2, 0, pad / 2);
        l.addView(panel);

        tab(tabs, "📐 Tamaño", this::showSize);
        tab(tabs, "⭕ Forma", this::showShape);
        tab(tabs, "🔤 Texto", this::showText);
        tab(tabs, "⬜ Borde", this::showBorder);
        if (durMs > 0 && !trimmed) tab(tabs, "⏱ Tiempo", this::showTime);

        // Controles de tiempo se crean una vez para conservar sus valores
        if (durMs > 0 && !trimmed) buildTimeControls();

        if (trimmed && pack.animated) {
            l.addView(Ui.label(this, "Fluidez (más fps = más suave, pero menos calidad por cuadro)"));
            RadioGroup fg = new RadioGroup(this);
            fg.setOrientation(RadioGroup.HORIZONTAL);
            for (int f : new int[]{8, 10, 12, 15, 20}) {
                RadioButton rb = new RadioButton(this);
                rb.setText(String.valueOf(f));
                rb.setId(2000 + f);
                fg.addView(rb);
            }
            fg.check(2012);
            fpsChoice = 12;
            fg.setOnCheckedChangeListener((g, i) -> fpsChoice = i - 2000);
            l.addView(fg);
        }

        l.addView(Ui.label(this, "Emojis (1 a 3)"));
        emoji = new EditText(this);
        emoji.setText("😀");
        l.addView(emoji);
        Button save = Ui.button(this, "✅ Crear sticker");
        save.setOnClickListener(v -> create());
        l.addView(save);

        ScrollView sv = new ScrollView(this);
        sv.addView(l);
        setContentView(sv);

        new Thread(() -> {
            Bitmap f = src.frameAt(trimStart);
            runOnUiThread(() -> {
                if (f == null) {
                    Toast.makeText(this, "No se pudo leer el archivo", Toast.LENGTH_LONG).show();
                    finish();
                    return;
                }
                canvas.frame = f;
                canvas.state.baseW = f.getWidth();
                canvas.state.baseH = f.getHeight();
                canvas.state.fit(false);
                canvas.refresh();
            });
        }).start();
        showSize();
    }

    private void tab(LinearLayout tabs, String t, Runnable r) {
        Button b = Ui.button(this, t);
        b.setOnClickListener(v -> r.run());
        tabs.addView(b);
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        HorizontalScrollView h = new HorizontalScrollView(this);
        h.addView(r);
        panel.addView(h);
        return r;
    }

    private void add(LinearLayout r, String t, Runnable a) {
        Button b = Ui.button(this, t);
        b.setOnClickListener(v -> a.run());
        r.addView(b);
    }

    private void colorRow(String label, java.util.function.IntConsumer pick) {
        panel.addView(Ui.label(this, label));
        LinearLayout r = row();
        int s = Ui.dp(this, 36), m = Ui.dp(this, 4);
        for (int c : COLORS) {
            View v = new View(this);
            GradientDrawable d = new GradientDrawable();
            d.setShape(GradientDrawable.OVAL);
            d.setColor(c);
            d.setStroke(2, Color.GRAY);
            v.setBackground(d);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(s, s);
            lp.setMargins(m, m, m, m);
            v.setOnClickListener(x -> pick.accept(c));
            r.addView(v, lp);
        }
    }

    private void showSize() {
        panel.removeAllViews();
        LinearLayout r = row();
        add(r, "Ajustar", () -> { canvas.state.fit(false); canvas.refresh(); });
        add(r, "Llenar", () -> { canvas.state.fit(true); canvas.refresh(); });
        add(r, "Girar 90°", () -> { canvas.state.image.postRotate(90, 256, 256); canvas.refresh(); });
        add(r, "Espejo", () -> { canvas.state.image.postScale(-1, 1, 256, 256); canvas.refresh(); });
        LinearLayout r2 = row();
        add(r2, "＋ Zoom", () -> { canvas.state.image.postScale(1.1f, 1.1f, 256, 256); canvas.refresh(); });
        add(r2, "－ Zoom", () -> { canvas.state.image.postScale(0.9f, 0.9f, 256, 256); canvas.refresh(); });
    }

    private void setShape(EditState.Shape s) {
        canvas.drawingFree = false;
        canvas.state.shape = s;
        canvas.refresh();
    }

    private void showShape() {
        panel.removeAllViews();
        LinearLayout r = row();
        add(r, "Original", () -> setShape(EditState.Shape.NONE));
        add(r, "Redondeado", () -> setShape(EditState.Shape.ROUNDED));
        add(r, "Círculo", () -> setShape(EditState.Shape.CIRCLE));
        add(r, "Corazón", () -> setShape(EditState.Shape.HEART));
        add(r, "Estrella", () -> setShape(EditState.Shape.STAR));
        LinearLayout r2 = row();
        add(r2, "✏️ Recorte libre (dibuja con el dedo)", () -> {
            canvas.drawingFree = true;
            Toast.makeText(this, "Dibuja el contorno alrededor de lo que quieres conservar", Toast.LENGTH_LONG).show();
        });
    }

    private void showText() {
        panel.removeAllViews();
        EditText in = new EditText(this);
        in.setHint("Escribe el texto");
        if (canvas.selected != null) in.setText(canvas.selected.text);
        panel.addView(in);
        LinearLayout r = row();
        add(r, "➕ Nuevo texto", () -> {
            String t = in.getText().toString().trim();
            if (t.isEmpty()) return;
            EditState.TextLayer tl = new EditState.TextLayer();
            tl.text = t;
            tl.m.postTranslate(256, 470);
            float w = tl.paint().measureText(t);
            if (w > 470) tl.m.postScale(470 / w, 470 / w, 256, 450);
            canvas.state.texts.add(tl);
            canvas.selected = tl;
            canvas.refresh();
        });
        add(r, "✔ Cambiar seleccionado", () -> {
            if (canvas.selected == null) return;
            canvas.selected.text = in.getText().toString();
            canvas.refresh();
        });
        add(r, "🗑 Borrar", () -> {
            if (canvas.selected == null) return;
            canvas.state.texts.remove(canvas.selected);
            canvas.selected = null;
            canvas.refresh();
        });
        LinearLayout fonts = row();
        String[] names = {"Normal", "Serif", "Mono", "Cursiva"};
        for (int i = 0; i < names.length; i++) {
            final int f = i;
            add(fonts, names[i], () -> { if (canvas.selected != null) { canvas.selected.font = f; canvas.refresh(); } });
        }
        colorRow("Color del texto", c -> { if (canvas.selected != null) { canvas.selected.color = c; canvas.refresh(); } });
        colorRow("Color del contorno", c -> { if (canvas.selected != null) { canvas.selected.strokeColor = c; canvas.refresh(); } });
        TextView h = Ui.label(this, "Arrastra el texto en el lienzo; con 2 dedos lo agrandas y giras.");
        h.setTextSize(12);
        panel.addView(h);
    }

    private void showBorder() {
        panel.removeAllViews();
        TextView lbl = Ui.label(this, "Grosor del borde: " + canvas.state.border);
        panel.addView(lbl);
        SeekBar sb = new SeekBar(this);
        sb.setMax(20);
        sb.setProgress(canvas.state.border);
        sb.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean u) { lbl.setText("Grosor del borde: " + p); }
            public void onStartTrackingTouch(SeekBar s) { }
            public void onStopTrackingTouch(SeekBar s) { canvas.state.border = s.getProgress(); canvas.refresh(); }
        });
        panel.addView(sb);
        colorRow("Color del borde", c -> { canvas.state.borderColor = c; canvas.refresh(); });
    }

    private void buildTimeControls() {
        timeLbl = Ui.label(this, "");
        start = new SeekBar(this);
        start.setMax((int) Math.max(0, durMs / 100));
        length = new SeekBar(this);
        length.setMax(75); // 0.5 a 8.0 s
        length.setProgress((int) Math.min(75, Math.max(0, durMs / 100 - 5)));
        SeekBar.OnSeekBarChangeListener lis = new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean u) { updateTime(); }
            public void onStartTrackingTouch(SeekBar s) { }
            public void onStopTrackingTouch(SeekBar s) { if (s == start) loadFrame(startMs()); }
        };
        start.setOnSeekBarChangeListener(lis);
        length.setOnSeekBarChangeListener(lis);
        fpsGroup = new RadioGroup(this);
        fpsGroup.setOrientation(RadioGroup.HORIZONTAL);
        int[] fps = {8, 10, 15};
        for (int f : fps) {
            RadioButton rb = new RadioButton(this);
            rb.setText(f + " fps");
            rb.setId(1000 + f);
            fpsGroup.addView(rb);
        }
        fpsGroup.check(1010);
        updateTime();
    }

    private void showTime() {
        panel.removeAllViews();
        panel.addView(timeLbl);
        panel.addView(Ui.label(this, "Inicio"));
        panel.addView(start);
        if (pack.animated) {
            panel.addView(Ui.label(this, "Duración"));
            panel.addView(length);
            panel.addView(Ui.label(this, "Fluidez"));
            panel.addView(fpsGroup);
        }
    }

    private long startMs() { return trimmed ? trimStart : start == null ? 0 : start.getProgress() * 100L; }
    private long lenMs() { return trimmed ? trimLen : length == null ? 0 : 500 + length.getProgress() * 100L; }

    private void updateTime() {
        long end = Math.min(durMs, startMs() + lenMs());
        timeLbl.setText(pack.animated
                ? String.format(Locale.US, "Fragmento: %.1f s → %.1f s (%.1f s de %.1f s)",
                startMs() / 1000f, end / 1000f, (end - startMs()) / 1000f, durMs / 1000f)
                : String.format(Locale.US, "Cuadro en %.1f s", startMs() / 1000f));
    }

    private void loadFrame(long t) {
        new Thread(() -> {
            Bitmap f = src.frameAt(t);
            if (f == null) return;
            runOnUiThread(() -> {
                canvas.frame = f;
                canvas.refresh();
            });
        }).start();
    }

    private String cleanEmojis(String in) {
        StringBuilder out = new StringBuilder();
        BreakIterator it = BreakIterator.getCharacterInstance();
        it.setText(in);
        int count = 0;
        for (int s = it.first(), e = it.next(); e != BreakIterator.DONE && count < 3; s = e, e = it.next()) {
            String g = in.substring(s, e).trim();
            if (g.isEmpty() || g.equals(",")) continue;
            if (out.length() > 0) out.append(',');
            out.append(g);
            count++;
        }
        return out.length() == 0 ? "😀" : out.toString();
    }

    private void create() {
        if (canvas.frame == null) return;
        ProgressDialog pd = new ProgressDialog(this);
        pd.setCancelable(false);
        pd.setMessage("Creando sticker…");
        pd.show();
        EditState st = canvas.state.copy();
        long s0 = startMs();
        long len = Math.max(500, Math.min(lenMs(), durMs - s0));
        int fps = fpsGroup != null ? fpsGroup.getCheckedRadioButtonId() - 1000 : fpsChoice;
        String emo = cleanEmojis(emoji.getText().toString());
        Bitmap still = canvas.frame;
        new Thread(() -> {
            String error = null;
            try {
                byte[] data;
                if (pack.animated) {
                    data = StickerMaker.makeAnimated(src, s0, len, fps, st,
                            m -> runOnUiThread(() -> pd.setMessage(m)));
                    if (data == null) error = "No cupo en 500 KB. Prueba con menos duración o menos fps.";
                } else {
                    data = WebPEncoder.encodeStatic(st.render(still));
                    if (data.length > WebPEncoder.MAX_STATIC) error = "La imagen pesa demasiado.";
                }
                if (error == null) {
                    String name = UUID.randomUUID().toString().substring(0, 8) + ".webp";
                    try (FileOutputStream fo = new FileOutputStream(new File(PackStore.packDir(this, pack.id), name))) {
                        fo.write(data);
                    }
                    PackStore.Sticker s = new PackStore.Sticker();
                    s.file = name;
                    s.emoji = emo;
                    pack.stickers.add(s);
                    pack.version++;
                    PackStore.updateTray(this, pack);
                    PackStore.save(this, packs);
                }
            } catch (Throwable e) {
                e.printStackTrace();
                error = "Error: " + e;
            }
            final String err = error;
            runOnUiThread(() -> {
                pd.dismiss();
                if (err != null) {
                    Toast.makeText(this, err, Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(this, "¡Sticker creado!", Toast.LENGTH_SHORT).show();
                    finish();
                }
            });
        }).start();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (src != null) src.release();
    }
}
