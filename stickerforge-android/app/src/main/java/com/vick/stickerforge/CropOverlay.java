package com.vick.stickerforge;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/** Recuadro sobre el video que marca qué parte de la imagen va al sticker. Coordenadas 0..1. */
public class CropOverlay extends View {
    public final RectF r = new RectF(0, 0, 1, 1);
    public float ratio = 0;      // ancho/alto en píxeles; 0 = libre
    public float videoAspect = 1; // ancho/alto del video
    public Runnable onChange;

    private int mode; // 0 nada, 1 mover, 2..5 esquinas (tl, tr, bl, br)
    private float lx, ly;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

    public CropOverlay(Context c) {
        super(c);
    }

    /** Aplica una proporción y centra el recuadro lo más grande posible. */
    public void setRatio(float rr) {
        ratio = rr;
        if (rr <= 0) {
            r.set(0, 0, 1, 1);
        } else {
            float nw = rr / videoAspect; // ancho normalizado por cada unidad de alto normalizado
            float w, h;
            if (nw <= 1) { h = 1; w = nw; } else { w = 1; h = 1 / nw; }
            r.set((1 - w) / 2, (1 - h) / 2, (1 + w) / 2, (1 + h) / 2);
        }
        invalidate();
        if (onChange != null) onChange.run();
    }

    @Override
    protected void onDraw(Canvas c) {
        float W = getWidth(), H = getHeight();
        RectF px = new RectF(r.left * W, r.top * H, r.right * W, r.bottom * H);
        p.setStyle(Paint.Style.FILL);
        p.setColor(0x99000000);
        c.drawRect(0, 0, W, px.top, p);
        c.drawRect(0, px.bottom, W, H, p);
        c.drawRect(0, px.top, px.left, px.bottom, p);
        c.drawRect(px.right, px.top, W, px.bottom, p);
        p.setStyle(Paint.Style.STROKE);
        p.setColor(0x66FFFFFF);
        p.setStrokeWidth(1.5f);
        for (int i = 1; i < 3; i++) {
            float x = px.left + px.width() * i / 3, y = px.top + px.height() * i / 3;
            c.drawLine(x, px.top, x, px.bottom, p);
            c.drawLine(px.left, y, px.right, y, p);
        }
        p.setColor(Color.WHITE);
        p.setStrokeWidth(Ui.dp(getContext(), 2));
        c.drawRect(px, p);
        p.setStrokeWidth(Ui.dp(getContext(), 5));
        float L = Ui.dp(getContext(), 18);
        float[][] cs = {{px.left, px.top, 1, 1}, {px.right, px.top, -1, 1}, {px.left, px.bottom, 1, -1}, {px.right, px.bottom, -1, -1}};
        for (float[] k : cs) {
            c.drawLine(k[0], k[1], k[0] + L * k[2], k[1], p);
            c.drawLine(k[0], k[1], k[0], k[1] + L * k[3], p);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        getParent().requestDisallowInterceptTouchEvent(true);
        float W = getWidth(), H = getHeight();
        float x = e.getX() / W, y = e.getY() / H;
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                float gx = Ui.dp(getContext(), 30) / W, gy = Ui.dp(getContext(), 30) / H;
                mode = 0;
                float[][] cs = {{r.left, r.top}, {r.right, r.top}, {r.left, r.bottom}, {r.right, r.bottom}};
                for (int i = 0; i < 4; i++) {
                    if (Math.abs(x - cs[i][0]) < gx && Math.abs(y - cs[i][1]) < gy) { mode = 2 + i; break; }
                }
                if (mode == 0 && r.contains(x, y)) mode = 1;
                lx = x;
                ly = y;
                break;
            }
            case MotionEvent.ACTION_MOVE:
                if (mode == 1) {
                    float dx = Math.max(-r.left, Math.min(x - lx, 1 - r.right));
                    float dy = Math.max(-r.top, Math.min(y - ly, 1 - r.bottom));
                    r.offset(dx, dy);
                } else if (mode >= 2) {
                    resize(mode - 2, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
                }
                lx = x;
                ly = y;
                invalidate();
                if (onChange != null) onChange.run();
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                mode = 0;
                break;
        }
        return true;
    }

    private void resize(int corner, float x, float y) {
        float min = 0.08f;
        boolean left = corner == 0 || corner == 2, topC = corner == 0 || corner == 1;
        float ax = left ? r.right : r.left, ay = topC ? r.bottom : r.top; // esquina fija
        float w = Math.max(min, Math.abs(x - ax)), h = Math.max(min, Math.abs(y - ay));
        if (ratio > 0) {
            float k = ratio / videoAspect; // w = k*h en coordenadas normalizadas
            if (w / h > k) w = h * k; else h = w / k;
            float maxW = left ? ax : 1 - ax, maxH = topC ? ay : 1 - ay;
            if (w > maxW) { w = maxW; h = w / k; }
            if (h > maxH) { h = maxH; w = h * k; }
        }
        float nl = left ? ax - w : ax, nt = topC ? ay - h : ay;
        r.set(Math.max(0, nl), Math.max(0, nt), Math.min(1, nl + w), Math.min(1, nt + h));
    }
}
