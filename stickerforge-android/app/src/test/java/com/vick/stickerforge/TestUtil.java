package com.vick.stickerforge;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

class TestUtil {
    static final File OUT = new File("build/test-out");

    static void write(String name, byte[] data) throws Exception {
        OUT.mkdirs();
        try (FileOutputStream fo = new FileOutputStream(new File(OUT, name))) {
            fo.write(data);
        }
    }

    static int le32(byte[] b, int o) {
        return (b[o] & 0xff) | (b[o + 1] & 0xff) << 8 | (b[o + 2] & 0xff) << 16 | (b[o + 3] & 0xff) << 24;
    }

    static int le24(byte[] b, int o) {
        return (b[o] & 0xff) | (b[o + 1] & 0xff) << 8 | (b[o + 2] & 0xff) << 16;
    }

    /** Lista de chunks de primer nivel: "TAG@offset:size". */
    static List<String> chunks(byte[] w) {
        List<String> out = new ArrayList<>();
        int off = 12;
        while (off + 8 <= w.length) {
            int size = le32(w, off + 4);
            out.add(new String(w, off, 4) + "@" + off + ":" + size);
            off += 8 + size + (size & 1);
        }
        return out;
    }

    /** Video falso: escena 16:9 con ruido y un círculo que se mueve (difícil de comprimir). */
    static class FakeVideo implements StickerMaker.FrameSource {
        final int w, h;
        final long dur;
        int calls;

        FakeVideo(int w, int h, long dur) {
            this.w = w;
            this.h = h;
            this.dur = dur;
        }

        public long durationMs() { return dur; }

        public Bitmap frameAt(long ms) {
            calls++;
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            Random r = new Random(ms);
            Paint p = new Paint();
            for (int i = 0; i < 400; i++) {
                p.setColor(Color.rgb(r.nextInt(256), r.nextInt(256), r.nextInt(256)));
                float x = r.nextInt(w), y = r.nextInt(h);
                c.drawRect(x, y, x + w / 20f, y + h / 20f, p);
            }
            p.setColor(Color.YELLOW);
            c.drawCircle(w / 2f + (float) Math.sin(ms / 300.0) * w / 4, h / 2f, h / 5f, p);
            return b;
        }

        public void release() { }
    }
}
