package com.vick.stickerforge;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Movie;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
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
        String type = c.getContentResolver().getType(uri);
        if (type == null) type = "";
        if (type.startsWith("video/")) return new VideoSource(c, uri);
        if (type.equals("image/gif")) return new GifSource(c, uri);
        return new ImageSource(c, uri);
    }

    static class VideoSource implements FrameSource {
        final MediaMetadataRetriever r = new MediaMetadataRetriever();
        final long dur;

        VideoSource(Context c, Uri uri) {
            r.setDataSource(c, uri);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            dur = d == null ? 0 : Long.parseLong(d);
        }

        public long durationMs() { return dur; }

        public Bitmap frameAt(long ms) {
            Bitmap b = r.getScaledFrameAtTime(Math.min(ms, Math.max(0, dur - 1)) * 1000,
                    MediaMetadataRetriever.OPTION_CLOSEST, 1024, 1024);
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

    /** Coloca el cuadro en un lienzo transparente de 512x512 y dibuja el texto. */
    public static Bitmap compose(Bitmap src, boolean fill, String text) {
        Bitmap out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(out);
        if (src != null) {
            float s = fill ? Math.max((float) SIZE / src.getWidth(), (float) SIZE / src.getHeight())
                    : Math.min((float) SIZE / src.getWidth(), (float) SIZE / src.getHeight());
            float w = src.getWidth() * s, h = src.getHeight() * s;
            RectF dst = new RectF((SIZE - w) / 2, (SIZE - h) / 2, (SIZE + w) / 2, (SIZE + h) / 2);
            cv.drawBitmap(src, null, dst, new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG));
        }
        if (text != null && !text.trim().isEmpty()) drawText(cv, text.trim());
        return out;
    }

    private static void drawText(Canvas cv, String text) {
        Paint fillP = new Paint(Paint.ANTI_ALIAS_FLAG);
        fillP.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        fillP.setTextAlign(Paint.Align.CENTER);
        float size = 80;
        fillP.setTextSize(size);
        while (fillP.measureText(text) > SIZE - 40 && size > 24) {
            size -= 4;
            fillP.setTextSize(size);
        }
        Paint stroke = new Paint(fillP);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(size / 6);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setColor(Color.BLACK);
        fillP.setColor(Color.WHITE);
        float y = SIZE - 30;
        cv.drawText(text, SIZE / 2f, y, stroke);
        cv.drawText(text, SIZE / 2f, y, fillP);
    }

    public interface Progress {
        void update(String msg);
    }

    /** Crea un sticker animado; baja calidad y luego fps hasta caber en 500 KB. */
    public static byte[] makeAnimated(FrameSource src, long startMs, long lenMs, int fps,
                                      boolean fill, String text, Progress p) {
        int frameMs = 1000 / fps;
        int count = Math.max(2, (int) (lenMs / frameMs));
        List<Bitmap> frames = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            p.update("Extrayendo cuadro " + (i + 1) + "/" + count);
            Bitmap raw = src.frameAt(startMs + (long) i * frameMs);
            if (raw == null) continue;
            frames.add(compose(raw, fill, text));
            if (!(src instanceof ImageSource)) raw.recycle();
        }
        if (frames.size() < 2) return null;
        int[] qualities = {75, 60, 45, 30, 20};
        while (true) {
            for (int q : qualities) {
                p.update("Comprimiendo (" + frames.size() + " cuadros, calidad " + q + ")");
                byte[] out = WebPEncoder.encodeAnimated(frames, frameMs, q, WebPEncoder.MAX_ANIMATED);
                if (out != null) return out;
            }
            if (frames.size() <= 4) return null;
            List<Bitmap> half = new ArrayList<>();
            for (int i = 0; i < frames.size(); i += 2) half.add(frames.get(i));
            frames = half;
            frameMs *= 2;
        }
    }
}
