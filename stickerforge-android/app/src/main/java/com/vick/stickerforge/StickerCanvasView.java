package com.vick.stickerforge;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/**
 * Lienzo del editor: 1 dedo mueve, 2 dedos hacen zoom y giran la capa seleccionada
 * (la imagen o un texto). En modo "libre" el dedo dibuja la forma de recorte.
 */
public class StickerCanvasView extends View {
    public EditState state = new EditState();
    public Bitmap frame;
    public EditState.TextLayer selected; // null = imagen
    public boolean drawingFree;
    public Runnable onChange;

    private Bitmap rendered;
    private Path drawing;
    private float lastX, lastY, lastDist, lastAngle, lastMx, lastMy;
    private int pointers;
    private final Paint checker = new Paint();
    private final Paint outline = new Paint(Paint.ANTI_ALIAS_FLAG);

    public StickerCanvasView(Context c) {
        super(c);
        Bitmap ch = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888);
        Canvas cc = new Canvas(ch);
        cc.drawColor(0xFFCCCCCC);
        Paint p = new Paint();
        p.setColor(0xFF999999);
        cc.drawRect(0, 0, 16, 16, p);
        cc.drawRect(16, 16, 32, 32, p);
        checker.setShader(new android.graphics.BitmapShader(ch,
                android.graphics.Shader.TileMode.REPEAT, android.graphics.Shader.TileMode.REPEAT));
        outline.setStyle(Paint.Style.STROKE);
        outline.setStrokeWidth(3);
        outline.setColor(Color.CYAN);
        outline.setPathEffect(new DashPathEffect(new float[]{12, 8}, 0));
    }

    @Override
    protected void onMeasure(int w, int h) {
        int s = MeasureSpec.getSize(w);
        setMeasuredDimension(s, s);
    }

    public void refresh() {
        if (rendered != null) rendered.recycle();
        rendered = state.render(frame);
        invalidate();
        if (onChange != null) onChange.run();
    }

    private float scale() { return getWidth() / (float) EditState.S; }

    @Override
    protected void onDraw(Canvas c) {
        c.drawRect(0, 0, getWidth(), getHeight(), checker);
        c.save();
        float s = scale();
        c.scale(s, s);
        if (rendered != null) {
            if (state.anim != EditState.Anim.NONE) {
                float t = (System.currentTimeMillis() % 1500) / 1500f;
                c.drawBitmap(rendered, state.animMatrix(t), new Paint(Paint.FILTER_BITMAP_FLAG));
                postInvalidateOnAnimation();
            } else {
                c.drawBitmap(rendered, 0, 0, new Paint(Paint.FILTER_BITMAP_FLAG));
            }
        }
        if (selected != null && state.texts.contains(selected)) {
            Path p = new Path();
            p.addRect(selected.bounds(), Path.Direction.CW);
            p.transform(selected.m);
            c.drawPath(p, outline);
        }
        if (drawing != null) c.drawPath(drawing, outline);
        c.restore();
    }

    private Matrix target() { return selected != null ? selected.m : state.image; }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        getParent().requestDisallowInterceptTouchEvent(true);
        float s = scale();
        float x = e.getX() / s, y = e.getY() / s;

        if (drawingFree) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    drawing = new Path();
                    drawing.moveTo(x, y);
                    lastX = x;
                    lastY = y;
                    break;
                case MotionEvent.ACTION_MOVE:
                    drawing.quadTo(lastX, lastY, (x + lastX) / 2, (y + lastY) / 2);
                    lastX = x;
                    lastY = y;
                    invalidate();
                    break;
                case MotionEvent.ACTION_UP:
                    drawing.close();
                    state.freePath = drawing;
                    state.shape = EditState.Shape.FREE;
                    drawing = null;
                    drawingFree = false;
                    refresh();
                    break;
            }
            return true;
        }

        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                selected = hitText(x, y);
                lastX = x;
                lastY = y;
                pointers = 1;
                invalidate();
                if (onChange != null) onChange.run();
                break;
            case MotionEvent.ACTION_POINTER_DOWN:
                if (e.getPointerCount() == 2) {
                    pointers = 2;
                    startTwo(e, s);
                }
                break;
            case MotionEvent.ACTION_MOVE:
                if (pointers == 2 && e.getPointerCount() >= 2) {
                    float x0 = e.getX(0) / s, y0 = e.getY(0) / s, x1 = e.getX(1) / s, y1 = e.getY(1) / s;
                    float mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                    float dist = (float) Math.hypot(x1 - x0, y1 - y0);
                    float ang = (float) Math.toDegrees(Math.atan2(y1 - y0, x1 - x0));
                    Matrix m = target();
                    m.postTranslate(mx - lastMx, my - lastMy);
                    if (lastDist > 10) m.postScale(dist / lastDist, dist / lastDist, mx, my);
                    m.postRotate(ang - lastAngle, mx, my);
                    lastMx = mx;
                    lastMy = my;
                    lastDist = dist;
                    lastAngle = ang;
                    refresh();
                } else if (pointers == 1) {
                    target().postTranslate(x - lastX, y - lastY);
                    lastX = x;
                    lastY = y;
                    refresh();
                }
                break;
            case MotionEvent.ACTION_POINTER_UP: {
                // sigue arrastrando con el dedo que queda, sin saltos
                int keep = e.getActionIndex() == 0 ? 1 : 0;
                lastX = e.getX(keep) / s;
                lastY = e.getY(keep) / s;
                pointers = e.getPointerCount() - 1 == 1 ? 1 : 2;
                if (pointers == 2) startTwo(e, s);
                break;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                pointers = 0;
                break;
        }
        return true;
    }

    private void startTwo(MotionEvent e, float s) {
        float x0 = e.getX(0) / s, y0 = e.getY(0) / s, x1 = e.getX(1) / s, y1 = e.getY(1) / s;
        lastMx = (x0 + x1) / 2;
        lastMy = (y0 + y1) / 2;
        lastDist = (float) Math.hypot(x1 - x0, y1 - y0);
        lastAngle = (float) Math.toDegrees(Math.atan2(y1 - y0, x1 - x0));
    }

    private EditState.TextLayer hitText(float x, float y) {
        for (int i = state.texts.size() - 1; i >= 0; i--) {
            EditState.TextLayer t = state.texts.get(i);
            Matrix inv = new Matrix();
            if (!t.m.invert(inv)) continue;
            float[] pt = {x, y};
            inv.mapPoints(pt);
            if (t.bounds().contains(pt[0], pt[1])) return t;
        }
        return null;
    }
}
