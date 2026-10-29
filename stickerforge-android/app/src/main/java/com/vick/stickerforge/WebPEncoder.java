package com.vick.stickerforge;

import android.graphics.Bitmap;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Crea WebP estáticos y animados sin librerías nativas: cada cuadro se comprime con el
 * codificador WebP de Android y sus chunks (ALPH + VP8) se envuelven en ANMF dentro de un
 * contenedor VP8X animado.
 */
public class WebPEncoder {
    public static final int MAX_STATIC = 100 * 1024;
    public static final int MAX_ANIMATED = 500 * 1024;

    @SuppressWarnings("deprecation")
    static byte[] compress(Bitmap b, int quality) {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        Bitmap.CompressFormat fmt = Build.VERSION.SDK_INT >= 30
                ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP;
        b.compress(fmt, quality, bo);
        return bo.toByteArray();
    }

    public static byte[] encodeStatic(Bitmap b) {
        byte[] out = null;
        for (int q = 90; q >= 10; q -= 10) {
            out = compress(b, q);
            if (out.length <= MAX_STATIC) return out;
        }
        return out;
    }

    /** Devuelve null si con esta calidad no cabe en el límite. */
    public static byte[] encodeAnimated(List<Bitmap> frames, int frameMs, int quality, int limit) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        int w = frames.get(0).getWidth(), h = frames.get(0).getHeight();

        // VP8X: animación + alfa
        writeTag(body, "VP8X");
        le32(body, 10);
        body.write(0x12);
        le24(body, 0);
        le24(body, w - 1);
        le24(body, h - 1);

        // ANIM: fondo transparente, bucle infinito
        writeTag(body, "ANIM");
        le32(body, 6);
        le32(body, 0);
        body.write(0);
        body.write(0);

        for (Bitmap f : frames) {
            byte[] webp = compress(f, quality);
            ByteArrayOutputStream payload = new ByteArrayOutputStream();
            le24(payload, 0);
            le24(payload, 0);
            le24(payload, w - 1);
            le24(payload, h - 1);
            le24(payload, frameMs);
            payload.write(0x02); // sin mezcla, sin disposición
            int off = 12;
            while (off + 8 <= webp.length) {
                String tag = new String(webp, off, 4, StandardCharsets.US_ASCII);
                int size = (webp[off + 4] & 0xff) | (webp[off + 5] & 0xff) << 8
                        | (webp[off + 6] & 0xff) << 16 | (webp[off + 7] & 0xff) << 24;
                int len = 8 + size + (size & 1);
                if (tag.equals("ALPH") || tag.equals("VP8 ") || tag.equals("VP8L")) {
                    payload.write(webp, off, Math.min(len, webp.length - off));
                }
                off += len;
            }
            writeTag(body, "ANMF");
            le32(body, payload.size());
            body.write(payload.toByteArray(), 0, payload.size());
            if (body.size() + 12 > limit) return null;
        }

        ByteArrayOutputStream file = new ByteArrayOutputStream();
        writeTag(file, "RIFF");
        le32(file, body.size() + 4);
        writeTag(file, "WEBP");
        file.write(body.toByteArray(), 0, body.size());
        return file.toByteArray();
    }

    private static void writeTag(ByteArrayOutputStream o, String t) {
        o.write(t.getBytes(StandardCharsets.US_ASCII), 0, 4);
    }

    private static void le24(ByteArrayOutputStream o, int v) {
        o.write(v & 0xff);
        o.write((v >> 8) & 0xff);
        o.write((v >> 16) & 0xff);
    }

    private static void le32(ByteArrayOutputStream o, int v) {
        le24(o, v);
        o.write((v >> 24) & 0xff);
    }
}
