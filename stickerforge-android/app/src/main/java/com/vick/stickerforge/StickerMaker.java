package com.vick.stickerforge;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ImageDecoder;
import android.graphics.Movie;
import android.media.MediaMetadataRetriever;
import android.net.Uri;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** Extrae cuadros de imágenes, GIF o videos y los convierte en stickers de 512x512. */
public class StickerMaker {
    public static final int SIZE = 512;

    public interface FrameSource {
        long durationMs();
        Bitmap frameAt(long ms);
        void release();
    }

    public static FrameSource open(Context c, Uri uri) throws Exception {
        return open(c, uri, 1024);
    }

    public static boolean isVideo(Context c, Uri uri) {
        String t = c.getContentResolver().getType(uri);
        if (t == null || "file".equals(uri.getScheme())) return String.valueOf(uri.getPath()).toLowerCase().endsWith(".mp4");
        return t.startsWith("video/");
    }

    public static FrameSource open(Context c, Uri uri, int maxSide) throws Exception {
        String type = c.getContentResolver().getType(uri);
        if (type == null || "file".equals(uri.getScheme())) {
            String p = String.valueOf(uri.getPath()).toLowerCase();
            type = p.endsWith(".mp4") ? "video/mp4" : p.endsWith(".gif") ? "image/gif" : "";
        }
        if (type.startsWith("video/")) return new VideoSource(c, uri, maxSide);
        if (type.equals("image/gif")) return new GifSource(c, uri);
        return new ImageSource(c, uri);
    }

    static class VideoSource implements FrameSource {
        final MediaMetadataRetriever r = new MediaMetadataRetriever();
        final long dur;
        final int maxSide;

        VideoSource(Context c, Uri uri, int maxSide) {
            this.maxSide = maxSide;
            r.setDataSource(c, uri);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            dur = d == null ? 0 : Long.parseLong(d);
        }

        public long durationMs() { return dur; }

        public Bitmap frameAt(long ms) {
            Bitmap b = r.getScaledFrameAtTime(Math.min(ms, Math.max(0, dur - 1)) * 1000,
                    MediaMetadataRetriever.OPTION_CLOSEST, maxSide, maxSide);
            if (b == null) b = r.getFrameAtTime(ms * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            return b;
        }

        public void release() {
            try { r.release(); } catch (Exception ignored) { }
        }
    }

    @SuppressWarnings("deprecation")
    static class GifSource implements FrameSource {
        final Movie movie;

        GifSource(Context c, Uri uri) throws Exception {
            try (InputStream in = c.getContentResolver().openInputStream(uri)) {
                byte[] data = in.readAllBytes();
                movie = Movie.decodeByteArray(data, 0, data.length);
            }
            if (movie == null) throw new Exception("No se pudo leer el GIF");
        }

        public long durationMs() { return movie.duration() > 0 ? movie.duration() : 1000; }

        public Bitmap frameAt(long ms) {
            Bitmap b = Bitmap.createBitmap(movie.width(), movie.height(), Bitmap.Config.ARGB_8888);
            movie.setTime((int) (ms % durationMs()));
            movie.draw(new Canvas(b), 0, 0);
            return b;
        }

        public void release() { }
    }

    static class ImageSource implements FrameSource {
        final Bitmap bmp;

        ImageSource(Context c, Uri uri) throws Exception {
            bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(c.getContentResolver(), uri),
                    (dec, info, src) -> {
                        dec.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                        int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                        float s = Math.min(1f, 1024f / Math.max(w, h));
                        dec.setTargetSize(Math.max(1, (int) (w * s)), Math.max(1, (int) (h * s)));
                    });
        }

        public long durationMs() { return 0; }
        public Bitmap frameAt(long ms) { return bmp; }
        public void release() { }
    }

    /** Recorta cada cuadro a una zona (coordenadas 0..1) sin perder resolución. */
    public static class CroppedSource implements FrameSource {
        final FrameSource src;
        final float l, t, r, b;

        public CroppedSource(FrameSource src, float[] c) {
            this.src = src;
            l = c[0]; t = c[1]; r = c[2]; b = c[3];
        }

        public long durationMs() { return src.durationMs(); }

        public Bitmap frameAt(long ms) {
            Bitmap f = src.frameAt(ms);
            if (f == null) return null;
            int x = Math.round(l * f.getWidth()), y = Math.round(t * f.getHeight());
            int w = Math.max(1, Math.min(f.getWidth() - x, Math.round((r - l) * f.getWidth())));
            int h = Math.max(1, Math.min(f.getHeight() - y, Math.round((b - t) * f.getHeight())));
            Bitmap c = Bitmap.createBitmap(f, x, y, w, h);
            float s = 1024f / Math.max(w, h);
            if (s < 1) c = Bitmap.createScaledBitmap(c, Math.round(w * s), Math.round(h * s), true);
            if (c != f) f.recycle();
            return c;
        }

        public void release() { src.release(); }
    }

    public interface Progress {
        void update(String msg);
    }

    /** Crea un sticker animado; baja calidad y luego fps hasta caber en 500 KB. */
    public static byte[] makeAnimated(FrameSource src, long startMs, long lenMs, int fps,
                                      EditState st, Progress p) {
        int frameMs = Math.max(8, 1000 / fps);
        int count = Math.max(2, (int) (lenMs / frameMs));
        List<Bitmap> frames = new ArrayList<>();
        boolean still = src.durationMs() <= 0;
        if (still && st.anim == EditState.Anim.NONE) {
            // Se ve fija, pero con 2 cuadros WhatsApp la acepta en un paquete animado
            frameMs = 500;
            count = 2;
        }
        Bitmap base = still ? st.render(src.frameAt(0)) : null; // imagen fija: se dibuja una vez
        for (int i = 0; i < count; i++) {
            p.update((still ? "Animando cuadro " : "Extrayendo cuadro ") + (i + 1) + "/" + count);
            float t = i / (float) count;
            if (still) {
                frames.add(st.applyAnim(base, t));
                continue;
            }
            Bitmap raw = src.frameAt(startMs + (long) i * frameMs);
            if (raw == null) continue;
            Bitmap r = st.render(raw);
            raw.recycle();
            if (st.anim != EditState.Anim.NONE) {
                Bitmap a = st.applyAnim(r, t);
                r.recycle();
                r = a;
            }
            frames.add(r);
        }
        if (frames.size() < 2) return null;
        while (frames.size() > 2 && frames.size() * frameMs > 10000) frames.remove(frames.size() - 1);
        while (true) {
            // Busca la mayor calidad que entre en 500 KB
            p.update("Comprimiendo (" + frames.size() + " cuadros, calidad 92)");
            byte[] best = WebPEncoder.encodeAnimated(frames, frameMs, 92, WebPEncoder.MAX_ANIMATED);
            if (best != null) return best;
            int lo = 10, hi = 92;
            p.update("Comprimiendo (" + frames.size() + " cuadros)");
            best = WebPEncoder.encodeAnimated(frames, frameMs, lo, WebPEncoder.MAX_ANIMATED);
            if (best != null) {
                while (hi - lo > 5) {
                    int mid = (lo + hi) / 2;
                    p.update("Ajustando calidad: " + mid);
                    byte[] o = WebPEncoder.encodeAnimated(frames, frameMs, mid, WebPEncoder.MAX_ANIMATED);
                    if (o != null) { best = o; lo = mid; } else hi = mid;
                }
                return best;
            }
            if (frames.size() <= 4) return null;
            List<Bitmap> half = new ArrayList<>();
            for (int i = 0; i < frames.size(); i += 2) half.add(frames.get(i));
            frames = half;
            while (frames.size() > 2 && frames.size() * frameMs * 2 > 10000) frames.remove(frames.size() - 1);
            frameMs *= 2;
        }
    }
}
