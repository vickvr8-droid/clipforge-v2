package com.vick.stickerforge;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

/** Elige el fragmento (línea de tiempo) y la zona del video (recuadro) que irán al sticker. */
public class VideoTrimActivity extends Activity {
    private Uri uri;
    private MediaPlayer mp;
    private TimelineView timeline;
    private CropOverlay crop;
    private TextView info;
    private Button play;
    private int vw = 1, vh = 1;
    private boolean animated;
    private boolean handedOff;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        public void run() {
            if (mp != null) {
                try {
                    if (mp.isPlaying()) {
                        int p = mp.getCurrentPosition();
                        if (p >= timeline.end || p < timeline.start - 300) {
                            mp.seekTo(timeline.start, MediaPlayer.SEEK_CLOSEST);
                            p = (int) timeline.start;
                        }
                        timeline.pos = p;
                        timeline.invalidate();
                    }
                } catch (IllegalStateException ignored) { }
            }
            h.postDelayed(this, 40);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("Elegir fragmento");
        uri = getIntent().getData();
        animated = getIntent().getBooleanExtra("animated", true);

        long dur;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(this, uri);
            dur = Long.parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            vw = Integer.parseInt(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH));
            vh = Integer.parseInt(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
            String rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
            if (rot != null && (rot.equals("90") || rot.equals("270"))) { int t = vw; vw = vh; vh = t; }
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo abrir el video", Toast.LENGTH_LONG).show();
            finish();
            return;
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }

        int pad = Ui.dp(this, 12);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(pad, pad, pad, pad);

        // Área de video con el recuadro encima, ajustada a la proporción del video
        int sw = getResources().getDisplayMetrics().widthPixels - 2 * pad;
        int maxH = (int) (getResources().getDisplayMetrics().heightPixels * 0.5f);
        int boxW = sw, boxH = (int) (sw * vh / (float) vw);
        if (boxH > maxH) { boxH = maxH; boxW = (int) (maxH * vw / (float) vh); }
        FrameLayout stage = new FrameLayout(this);
        stage.setBackgroundColor(0xFF000000);
        TextureView tv = new TextureView(this);
        crop = new CropOverlay(this);
        crop.videoAspect = vw / (float) vh;
        FrameLayout.LayoutParams fl = new FrameLayout.LayoutParams(boxW, boxH, Gravity.CENTER);
        stage.addView(tv, fl);
        stage.addView(crop, new FrameLayout.LayoutParams(boxW, boxH, Gravity.CENTER));
        l.addView(stage, new LinearLayout.LayoutParams(-1, boxH));

        info = Ui.label(this, "");
        l.addView(info);

        timeline = new TimelineView(this);
        timeline.dur = Math.max(1, dur);
        timeline.start = 0;
        timeline.end = animated ? Math.min(dur, 3000) : Math.min(dur, 500);
        timeline.listener = new TimelineView.Listener() {
            public void onRange(long s, long e, boolean fromStart) {
                updateInfo();
                if (mp != null) mp.seekTo((int) (fromStart ? s : e), MediaPlayer.SEEK_CLOSEST);
            }

            public void onSeek(long p) {
                if (mp != null) mp.seekTo((int) p, MediaPlayer.SEEK_CLOSEST);
            }
        };
        l.addView(timeline);
        TextView hint = Ui.label(this, "Arrastra las manijas amarillas para elegir inicio y fin; arrastra el centro para mover el fragmento. "
                + "En el video, mueve el recuadro y estíralo desde las esquinas.");
        hint.setTextSize(12);
        l.addView(hint);

        play = Ui.button(this, "⏸ Pausa");
        play.setOnClickListener(v -> {
            if (mp == null) return;
            if (mp.isPlaying()) { mp.pause(); play.setText("▶ Reproducir"); }
            else { mp.start(); play.setText("⏸ Pausa"); }
        });
        l.addView(play);

        l.addView(Ui.label(this, "Forma del recorte"));
        HorizontalScrollView hs = new HorizontalScrollView(this);
        LinearLayout ratios = new LinearLayout(this);
        hs.addView(ratios);
        l.addView(hs);
        String[] names = {"Todo", "1:1", "9:16", "16:9", "4:5", "Libre"};
        float[] vals = {0, 1, 9 / 16f, 16 / 9f, 4 / 5f, -1};
        for (int i = 0; i < names.length; i++) {
            final float v = vals[i];
            Button bt = Ui.button(this, names[i]);
            bt.setOnClickListener(x -> {
                if (v < 0) { crop.ratio = 0; Toast.makeText(this, "Recorte libre: estira desde las esquinas", Toast.LENGTH_SHORT).show(); }
                else crop.setRatio(v);
            });
            ratios.addView(bt);
        }

        Button next = Ui.button(this, "Siguiente ➜ (texto, forma, borde)");
        next.setOnClickListener(v -> next());
        l.addView(next);

        ScrollView sv = new ScrollView(this);
        sv.addView(l);
        setContentView(sv);

        crop.onChange = this::updateInfo;
        crop.setRatio(1);
        updateInfo();
        loadThumbs();

        tv.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int hh) { startPlayer(new Surface(st)); }
            public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int hh) { }
            public boolean onSurfaceTextureDestroyed(SurfaceTexture st) { releasePlayer(); return true; }
            public void onSurfaceTextureUpdated(SurfaceTexture st) { }
        });
    }

    private void startPlayer(Surface s) {
        try {
            mp = new MediaPlayer();
            mp.setDataSource(this, uri);
            mp.setSurface(s);
            mp.setVolume(0, 0);
            mp.setOnPreparedListener(m -> {
                m.seekTo((int) timeline.start, MediaPlayer.SEEK_CLOSEST);
                m.start();
                h.post(tick);
            });
            mp.prepareAsync();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo reproducir el video", Toast.LENGTH_SHORT).show();
        }
    }

    private void releasePlayer() {
        h.removeCallbacks(tick);
        if (mp != null) { mp.release(); mp = null; }
    }

    private void loadThumbs() {
        new Thread(() -> {
            MediaMetadataRetriever r = new MediaMetadataRetriever();
            try {
                r.setDataSource(this, uri);
                int n = timeline.thumbs.length;
                for (int i = 0; i < n && !isFinishing(); i++) {
                    long t = timeline.dur * (2L * i + 1) / (2L * n);
                    Bitmap bm = r.getScaledFrameAtTime(t * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 160, 160);
                    timeline.thumbs[i] = bm;
                    timeline.postInvalidate();
                }
            } catch (Exception ignored) {
            } finally {
                try { r.release(); } catch (Exception ignored) { }
            }
        }).start();
    }

    private void updateInfo() {
        int cw = Math.round(crop.r.width() * vw), ch = Math.round(crop.r.height() * vh);
        String q = Math.max(cw, ch) >= 512 ? "✅ buena calidad" : "⚠️ zona pequeña: se verá pixelado";
        info.setText(animated
                ? String.format(Locale.US, "Fragmento %.1fs → %.1fs  (%.1f s, máx 8 s)\nZona: %d×%d px de %d×%d · %s",
                timeline.start / 1000f, timeline.end / 1000f, (timeline.end - timeline.start) / 1000f, cw, ch, vw, vh, q)
                : String.format(Locale.US, "Cuadro en %.1fs\nZona: %d×%d px de %d×%d · %s",
                timeline.start / 1000f, cw, ch, vw, vh, q));
    }

    private void next() {
        Intent i = new Intent(this, EditorActivity.class)
                .setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .putExtras(getIntent())
                .putExtra("trimmed", true)
                .putExtra("start", timeline.start)
                .putExtra("end", timeline.end)
                .putExtra("crop", new float[]{crop.r.left, crop.r.top, crop.r.right, crop.r.bottom});
        handedOff = true;
        startActivity(i);
        finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mp != null && mp.isPlaying()) { mp.pause(); play.setText("▶ Reproducir"); }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        releasePlayer();
        if (!handedOff && isFinishing()) TempFiles.delete(this, uri);
    }
}
