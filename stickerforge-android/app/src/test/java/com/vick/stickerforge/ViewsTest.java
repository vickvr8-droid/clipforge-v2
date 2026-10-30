package com.vick.stickerforge;

import static org.junit.Assert.*;

import android.os.SystemClock;
import android.view.MotionEvent;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ViewsTest {
    private static void touch(android.view.View v, float x0, float y0, float x1, float y1) {
        android.widget.FrameLayout parent = new android.widget.FrameLayout(v.getContext());
        if (v.getParent() == null) parent.addView(v);
        long t = SystemClock.uptimeMillis();
        v.onTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x0, y0, 0));
        for (int i = 1; i <= 10; i++) {
            v.onTouchEvent(MotionEvent.obtain(t, t + i * 10, MotionEvent.ACTION_MOVE,
                    x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10, 0));
        }
        v.onTouchEvent(MotionEvent.obtain(t, t + 200, MotionEvent.ACTION_UP, x1, y1, 0));
    }

    @Test
    public void cropRatioSquareOnLandscapeVideo() {
        CropOverlay c = new CropOverlay(RuntimeEnvironment.getApplication());
        c.videoAspect = 16 / 9f;
        c.setRatio(1);
        // en píxeles el recorte debe ser cuadrado: ancho_norm*16 == alto_norm*9
        assertEquals(c.r.height() * 9, c.r.width() * 16, 1e-3);
        assertEquals(1f, c.r.height(), 1e-4);
    }

    @Test
    public void cropMoveAndResizeKeepRatioAndBounds() {
        CropOverlay c = new CropOverlay(RuntimeEnvironment.getApplication());
        c.layout(0, 0, 1600, 900);
        c.videoAspect = 16 / 9f;
        c.setRatio(9 / 16f);
        float w0 = c.r.width();
        // arrastrar el centro muy a la derecha: no debe salirse
        touch(c, 800, 450, 3000, 450);
        assertEquals(1f, c.r.right, 1e-4);
        assertEquals(w0, c.r.width(), 1e-4);
        // achicar desde la esquina superior izquierda
        touch(c, c.r.left * 1600, 0, c.r.left * 1600 + 200, 300);
        float pxRatio = (c.r.width() * 1600) / (c.r.height() * 900);
        assertEquals(9 / 16f, pxRatio, 0.01);
        assertTrue(c.r.left >= 0 && c.r.top >= 0 && c.r.right <= 1 && c.r.bottom <= 1);
    }

    @Test
    public void timelineEnforcesMaxAndMinLength() {
        TimelineView t = new TimelineView(RuntimeEnvironment.getApplication());
        t.layout(0, 0, 1000, 200);
        t.dur = 30000;
        t.start = 0;
        t.end = 3000;
        // arrastrar la manija final al final del video → máximo 8 s
        float pad = Ui.dp(t.getContext(), 14), strip = 1000 - 2 * pad;
        float xe = pad + strip * 3000 / 30000f + Ui.dp(t.getContext(), 6);
        touch(t, xe, 100, 1000, 100);
        assertEquals(8000, t.end - t.start);
        assertEquals(30000, t.end);
        // arrastrar la manija inicial más allá del final → mínimo 0.5 s
        float xs = pad + strip * t.start / 30000f - Ui.dp(t.getContext(), 6);
        touch(t, xs, 100, 1000, 100);
        assertEquals(500, t.end - t.start);
    }
}
