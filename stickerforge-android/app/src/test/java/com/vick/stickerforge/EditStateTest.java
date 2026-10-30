package com.vick.stickerforge;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Color;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class EditStateTest {
    private static Bitmap solid(int w, int h, int color) {
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        b.eraseColor(color);
        return b;
    }

    private static EditState state(int w, int h, boolean fill) {
        EditState s = new EditState();
        s.baseW = w;
        s.baseH = h;
        s.fit(fill);
        return s;
    }

    @Test
    public void fitLeavesTransparentBarsFillCovers() {
        Bitmap f = solid(1000, 500, Color.BLUE);
        Bitmap fit = state(1000, 500, false).render(f);
        assertEquals(512, fit.getWidth());
        assertEquals(0, Color.alpha(fit.getPixel(256, 10)));    // franja superior vacía
        assertEquals(Color.BLUE, fit.getPixel(256, 256));
        Bitmap fill = state(1000, 500, true).render(f);
        assertEquals(Color.BLUE, fill.getPixel(256, 10));
    }

    @Test
    public void circleShapeCutsCorners() {
        EditState s = state(512, 512, true);
        s.shape = EditState.Shape.CIRCLE;
        Bitmap out = s.render(solid(512, 512, Color.GREEN));
        assertEquals(0, Color.alpha(out.getPixel(5, 5)));
        assertEquals(Color.GREEN, out.getPixel(256, 256));
    }

    @Test
    public void heartStarAndRoundedRender() {
        for (EditState.Shape sh : new EditState.Shape[]{EditState.Shape.HEART, EditState.Shape.STAR, EditState.Shape.ROUNDED}) {
            EditState s = state(512, 512, true);
            s.shape = sh;
            Bitmap out = s.render(solid(512, 512, Color.GREEN));
            assertEquals(sh.name(), 0, Color.alpha(out.getPixel(2, 2)));
            assertEquals(sh.name(), Color.GREEN, out.getPixel(256, 300));
        }
    }

    @Test
    public void borderAroundShapeAndAroundFreeImage() {
        EditState s = state(512, 512, true);
        s.shape = EditState.Shape.CIRCLE;
        s.border = 12;
        Bitmap out = s.render(solid(512, 512, Color.GREEN));
        assertEquals(Color.WHITE, out.getPixel(256, 9)); // anillo blanco en el borde del círculo

        EditState t = state(200, 200, false); // imagen pequeña centrada, sin forma
        t.image.reset();
        t.image.postTranslate(156, 156);
        t.border = 10;
        Bitmap o2 = t.render(solid(200, 200, Color.GREEN));
        assertEquals(Color.WHITE, o2.getPixel(150, 256)); // 6 px fuera de la imagen
        assertEquals(0, Color.alpha(o2.getPixel(130, 256)));
    }

    @Test
    public void textIsDrawn() {
        EditState s = state(512, 512, true);
        EditState.TextLayer tl = new EditState.TextLayer();
        tl.text = "HOLA";
        tl.m.postTranslate(256, 470);
        s.texts.add(tl);
        Bitmap out = s.render(null);
        int painted = 0;
        for (int x = 100; x < 412; x += 2) for (int y = 400; y < 490; y += 2) if (Color.alpha(out.getPixel(x, y)) > 0) painted++;
        assertTrue("pixeles de texto: " + painted, painted > 300);
        assertEquals(0, Color.alpha(out.getPixel(256, 100)));
    }

    @Test
    public void copyIsIndependent() {
        EditState s = state(512, 512, true);
        EditState c = s.copy();
        s.image.postTranslate(50, 0);
        s.border = 9;
        assertNotEquals(s.image, c.image);
        assertEquals(0, c.border);
    }

    @Test
    public void frameOfDifferentSizeIsNormalized() {
        // la vista previa y los cuadros finales pueden venir en otra resolución
        EditState s = state(1000, 500, true);
        Bitmap big = s.render(solid(1000, 500, Color.RED));
        Bitmap small = s.render(solid(500, 250, Color.RED));
        assertEquals(big.getPixel(5, 5), small.getPixel(5, 5));
    }
}
