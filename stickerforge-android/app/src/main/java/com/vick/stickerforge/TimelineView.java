package com.vick.stickerforge;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/** Línea de tiempo con miniaturas, dos manijas (inicio/fin) y cabezal de reproducción. */
public class TimelineView extends View {
    public interface Listener {
        void onRange(long start, long end, boolean fromStartHandle);
        void onSeek(long pos);
    }

    public long dur = 1, start, end, pos;
    public long maxLen = 8000, minLen = 500;
    public final Bitmap[] thumbs = new Bitmap[10];
    public Listener listener;

    private int drag; // 0 nada, 1 inicio, 2 fin, 3 mover rango, 4 cabezal
    private float downX;
    private long downStart, downEnd;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);

    public TimelineView(Context c) {
        super(c);
    }

    @Override
    protected void onMeasure(int w, int h) {
        setMeasuredDimension(MeasureSpec.getSize(w), Ui.dp(getContext(), 76));
    }

    private float pad() { return Ui.dp(getContext(), 14); }
    private float strip() { return getWidth() - 2 * pad(); }
    private float xOf(long t) { return pad() + strip() * t / (float) dur; }
    private long tOf(float x) { return Math.max(0, Math.min(dur, (long) ((x - pad()) / strip() * dur))); }

    @Override
    protected void onDraw(Canvas c) {
        float top = Ui.dp(getContext(), 8), bot = getHeight() - Ui.dp(getContext(), 8);
        float tw = strip() / thumbs.length;
        p.setColor(0xFF333333);
        c.drawRect(pad(), top, pad() + strip(), bot, p);
        for (int i = 0; i < thumbs.length; i++) {
            Bitmap b = thumbs[i];
            if (b == null) continue;
            RectF dst = new RectF(pad() + i * tw, top, pad() + (i + 1) * tw, bot);
            // recorte centrado para llenar la celda
            float s = Math.max(dst.width() / b.getWidth(), dst.height() / b.getHeight());
            float sw = dst.width() / s, sh = dst.height() / s;
            android.graphics.Rect src = new android.graphics.Rect((int) ((b.getWidth() - sw) / 2),
                    (int) ((b.getHeight() - sh) / 2), (int) ((b.getWidth() + sw) / 2), (int) ((b.getHeight() + sh) / 2));
            c.drawBitmap(b, src, dst, p);
        }
        float xs = xOf(start), xe = xOf(end);
        p.setColor(0xAA000000);
        c.drawRect(pad(), top, xs, bot, p);
        c.drawRect(xe, top, pad() + strip(), bot, p);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(Ui.dp(getContext(), 3));
        p.setColor(0xFFFFC107);
        c.drawRect(xs, top, xe, bot, p);
        p.setStyle(Paint.Style.FILL);
        float hw = Ui.dp(getContext(), 12);
        c.drawRoundRect(new RectF(xs - hw, top - 4, xs, bot + 4), 8, 8, p);
        c.drawRoundRect(new RectF(xe, top - 4, xe + hw, bot + 4), 8, 8, p);
        p.setColor(Color.BLACK);
        float mid = (top + bot) / 2;
        c.drawRect(xs - hw / 2 - 2, mid - 12, xs - hw / 2 + 2, mid + 12, p);
        c.drawRect(xe + hw / 2 - 2, mid - 12, xe + hw / 2 + 2, mid + 12, p);
        p.setColor(Color.WHITE);
        float xp = xOf(pos);
        c.drawRect(xp - 2, 0, xp + 2, getHeight(), p);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        getParent().requestDisallowInterceptTouchEvent(true);
        float x = e.getX();
        float grab = Ui.dp(getContext(), 26);
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = x;
                downStart = start;
                downEnd = end;
                float ds = Math.abs(x - (xOf(start) - Ui.dp(getContext(), 6)));
                float de = Math.abs(x - (xOf(end) + Ui.dp(getContext(), 6)));
                if (ds < grab && ds <= de) drag = 1;
                else if (de < grab) drag = 2;
                else if (x > xOf(start) && x < xOf(end)) drag = 3;
                else drag = 4;
                if (drag == 4) seek(tOf(x));
                break;
            case MotionEvent.ACTION_MOVE:
                long dt = (long) ((x - downX) / strip() * dur);
                if (drag == 1) {
                    long s = Math.max(0, Math.min(downStart + dt, end - minLen));
                    start = Math.max(s, end - maxLen);
                    if (start != s) end = Math.min(dur, start + maxLen);
                    pos = start;
                    changed(true);
                } else if (drag == 2) {
                    end = Math.min(dur, Math.max(downEnd + dt, start + minLen));
                    if (end - start > maxLen) start = end - maxLen;
                    pos = end;
                    changed(false);
                } else if (drag == 3) {
                    long len = downEnd - downStart;
                    start = Math.max(0, Math.min(downStart + dt, dur - len));
                    end = start + len;
                    pos = start;
                    changed(true);
                } else if (drag == 4) {
                    seek(tOf(x));
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (drag == 2 && listener != null) listener.onSeek(start);
                drag = 0;
                break;
        }
        return true;
    }

    private void seek(long t) {
        pos = t;
        invalidate();
        if (listener != null) listener.onSeek(t);
    }

    private void changed(boolean fromStart) {
        invalidate();
        if (listener != null) listener.onRange(start, end, fromStart);
    }
}
