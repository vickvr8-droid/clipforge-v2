package com.vick.stickerforge;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class WebPEncoderTest {
    private static List<Bitmap> frames(int n) {
        List<Bitmap> fs = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            Bitmap b = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888); // fondo transparente
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setColor(Color.RED);
            new Canvas(b).drawCircle(100 + i * 30, 256, 90, p);
            fs.add(b);
        }
        return fs;
    }

    @Test
    public void androidCompressProducesAlphaChunks() {
        byte[] w = WebPEncoder.compress(frames(1).get(0), 75);
        List<String> ch = TestUtil.chunks(w);
        String all = String.join(",", ch);
        assertTrue("debe tener canal alfa: " + all, all.contains("ALPH"));
        assertTrue("debe tener VP8: " + all, all.contains("VP8 "));
    }

    @Test
    public void animatedContainerIsValid() throws Exception {
        byte[] w = WebPEncoder.encodeAnimated(frames(10), 100, 75, WebPEncoder.MAX_ANIMATED);
        assertNotNull(w);
        TestUtil.write("anim_basic.webp", w);
        assertEquals("RIFF", new String(w, 0, 4));
        assertEquals(w.length - 8, TestUtil.le32(w, 4));
        assertEquals("WEBP", new String(w, 8, 4));
        List<String> ch = TestUtil.chunks(w);
        assertTrue(ch.get(0).startsWith("VP8X"));
        assertEquals(0x12, w[20] & 0xff);           // animación + alfa
        assertEquals(511, TestUtil.le24(w, 24));     // ancho - 1
        assertEquals(511, TestUtil.le24(w, 27));     // alto - 1
        assertTrue(ch.get(1).startsWith("ANIM"));
        assertEquals(0, (w[42] & 0xff) | (w[43] & 0xff) << 8); // bucle infinito
        int anmf = 0;
        for (String c : ch) if (c.startsWith("ANMF")) anmf++;
        assertEquals(10, anmf);
        // recorre los ANMF y comprueba duración y contenido
        int off = 12;
        while (off + 8 <= w.length) {
            int size = TestUtil.le32(w, off + 4);
            if (new String(w, off, 4).equals("ANMF")) {
                assertEquals(100, TestUtil.le24(w, off + 8 + 12));
                String inner = new String(w, off + 8 + 16, 4);
                assertTrue(inner, inner.equals("ALPH") || inner.equals("VP8 ") || inner.equals("VP8L"));
            }
            off += 8 + size + (size & 1);
        }
        assertEquals(w.length, off);
    }

    @Test
    public void animatedRespectsLimit() {
        assertNull(WebPEncoder.encodeAnimated(frames(10), 100, 75, 2000));
    }

    @Test
    public void staticUnder100KB() throws Exception {
        Bitmap noisy = new TestUtil.FakeVideo(512, 512, 0).frameAt(1);
        byte[] w = WebPEncoder.encodeStatic(noisy);
        TestUtil.write("static_noisy.webp", w);
        assertTrue("pesa " + w.length, w.length <= WebPEncoder.MAX_STATIC);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsMixedSizes() {
        List<Bitmap> fs = frames(2);
        fs.add(Bitmap.createBitmap(300, 300, Bitmap.Config.ARGB_8888));
        WebPEncoder.encodeAnimated(fs, 100, 75, WebPEncoder.MAX_ANIMATED);
    }
}
