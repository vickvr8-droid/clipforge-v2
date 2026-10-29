package com.vick.stickerforge;

import android.app.Activity;
import android.app.ProgressDialog;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@SuppressWarnings("deprecation")
public class EditorActivity extends Activity {
    private StickerMaker.FrameSource src;
    private PackStore.Pack pack;
    private List<PackStore.Pack> packs;
    private ImageView preview;
    private RadioGroup crop, fpsGroup;
    private EditText text, emoji;
    private SeekBar start, length;
    private TextView startLbl, lenLbl;
    private long durMs;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("Editar sticker");
        packs = PackStore.load(this);
        pack = PackStore.find(packs, getIntent().getStringExtra("id"));
        Uri uri = getIntent().getData();
        try {
            src = StickerMaker.open(this, uri);
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

        int pad = Ui.dp(this, 14);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(pad, pad, pad, pad);

        preview = new ImageView(this);
        preview.setBackgroundColor(0xFF555555);
        int side = Ui.dp(this, 240);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(side, side);
        pp.gravity = android.view.Gravity.CENTER_HORIZONTAL;
        l.addView(preview, pp);

        l.addView(Ui.label(this, "Encuadre"));
        crop = new RadioGroup(this);
        crop.setOrientation(RadioGroup.HORIZONTAL);
        addRadio(crop, "Completo", 0, true);
        addRadio(crop, "Recortar al cuadrado", 1, false);
        crop.setOnCheckedChangeListener((g, i) -> updatePreview());
        l.addView(crop);

        l.addView(Ui.label(this, "Texto (opcional)"));
        text = new EditText(this);
        text.setHint("Ej: JAJAJA");
        l.addView(text);
        Button apply = Ui.button(this, "Ver texto en la vista previa");
        apply.setOnClickListener(v -> updatePreview());
        l.addView(apply);

        if (pack.animated) {
            startLbl = Ui.label(this, "");
            l.addView(startLbl);
            start = new SeekBar(this);
            start.setMax((int) Math.max(0, durMs / 100));
            l.addView(start);
            lenLbl = Ui.label(this, "");
            l.addView(lenLbl);
            length = new SeekBar(this);
            length.setMax(70); // 1.0 a 8.0 s en pasos de 0.1
            length.setProgress((int) Math.min(70, Math.max(0, durMs / 100 - 10)));
            l.addView(length);
            SeekBar.OnSeekBarChangeListener lis = new SeekBar.OnSeekBarChangeListener() {
                public void onProgressChanged(SeekBar s, int p, boolean u) { updateLabels(); }
                public void onStartTrackingTouch(SeekBar s) { }
                public void onStopTrackingTouch(SeekBar s) { if (s == start) updatePreview(); }
            };
            start.setOnSeekBarChangeListener(lis);
            length.setOnSeekBarChangeListener(lis);
            updateLabels();

            l.addView(Ui.label(this, "Fluidez (cuadros por segundo)"));
            fpsGroup = new RadioGroup(this);
            fpsGroup.setOrientation(RadioGroup.HORIZONTAL);
            addRadio(fpsGroup, "8", 8, false);
            addRadio(fpsGroup, "10", 10, true);
            addRadio(fpsGroup, "15", 15, false);
            l.addView(fpsGroup);
        }

        l.addView(Ui.label(this, "Emoji relacionado"));
        emoji = new EditText(this);
        emoji.setText("😀");
        l.addView(emoji);

        Button save = Ui.button(this, "Crear sticker");
        save.setOnClickListener(v -> create());
        l.addView(save);

        ScrollView sv = new ScrollView(this);
        sv.addView(l);
        setContentView(sv);
        updatePreview();
    }

    private void addRadio(RadioGroup g, String t, int id, boolean checked) {
        RadioButton r = new RadioButton(this);
        r.setText(t);
        r.setId(id + 1000);
        g.addView(r);
        if (checked) g.check(id + 1000);
    }

    private long startMs() { return start == null ? 0 : start.getProgress() * 100L; }
    private long lenMs() { return length == null ? 0 : 1000 + length.getProgress() * 100L; }

    private void updateLabels() {
        startLbl.setText(String.format(Locale.US, "Inicio: %.1f s (de %.1f s)", startMs() / 1000f, durMs / 1000f));
        lenLbl.setText(String.format(Locale.US, "Duración: %.1f s (máx 8 s)", lenMs() / 1000f));
    }

    private boolean fill() { return crop.getCheckedRadioButtonId() == 1001; }

    private void updatePreview() {
        long t = startMs();
        boolean f = fill();
        String txt = text.getText().toString();
        new Thread(() -> {
            Bitmap raw = src.frameAt(t);
            if (raw == null) return;
            Bitmap c = StickerMaker.compose(raw, f, txt);
            runOnUiThread(() -> preview.setImageBitmap(c));
        }).start();
    }

    private void create() {
        ProgressDialog pd = new ProgressDialog(this);
        pd.setCancelable(false);
        pd.setMessage("Creando sticker…");
        pd.show();
        boolean f = fill();
        String txt = text.getText().toString();
        long st = startMs();
        long len = Math.min(lenMs(), Math.max(1000, durMs - st));
        int fps = fpsGroup == null ? 10 : fpsGroup.getCheckedRadioButtonId() - 1000;
        String em = emoji.getText().toString().trim();
        if (em.isEmpty()) em = "😀";
        final String emo = em;
        new Thread(() -> {
            String error = null;
            try {
                byte[] data;
                if (pack.animated) {
                    data = StickerMaker.makeAnimated(src, st, len, fps, f, txt,
                            m -> runOnUiThread(() -> pd.setMessage(m)));
                    if (data == null) error = "No se pudo reducir a menos de 500 KB. Prueba con menos duración.";
                } else {
                    data = WebPEncoder.encodeStatic(StickerMaker.compose(src.frameAt(st), f, txt));
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
