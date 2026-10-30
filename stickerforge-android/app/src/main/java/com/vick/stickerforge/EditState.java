package com.vick.stickerforge;

import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;

import java.util.ArrayList;
import java.util.List;

/** Todo lo que define el aspecto del sticker: posición de la imagen, forma, borde y textos. */
public class EditState {
    public static final int S = 512;

    public enum Shape { NONE, ROUNDED, CIRCLE, HEART, STAR, FREE }

    public static class TextLayer {
        public String text;
        public int color = Color.WHITE, strokeColor = Color.BLACK;
        public int font = 0; // 0 normal, 1 serif, 2 mono, 3 cursiva
        public final Matrix m = new Matrix();

        TextLayer copy() {
            TextLayer t = new TextLayer();
            t.text = text;
            t.color = color;
            t.strokeColor = strokeColor;
            t.font = font;
            t.m.set(m);
            return t;
        }

        Paint paint() {
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            Typeface base = font == 1 ? Typeface.SERIF : font == 2 ? Typeface.MONOSPACE : Typeface.DEFAULT;
            p.setTypeface(Typeface.create(base, font == 3 ? Typeface.BOLD_ITALIC : Typeface.BOLD));
            p.setTextSize(64);
            p.setTextAlign(Paint.Align.CENTER);
            return p;
        }

        /** Límites del texto en coordenadas locales (centrado en 0,0). */
        RectF bounds() {
            Paint p = paint();
            float w = p.measureText(text);
            return new RectF(-w / 2 - 10, -60, w / 2 + 10, 22);
        }

        void draw(Canvas c) {
            Paint p = paint();
            c.save();
            c.concat(m);
            Paint st = new Paint(p);
            st.setStyle(Paint.Style.STROKE);
            st.setStrokeWidth(11);
            st.setStrokeJoin(Paint.Join.ROUND);
            st.setColor(strokeColor);
            c.drawText(text, 0, 0, st);
            p.setColor(color);
            c.drawText(text, 0, 0, p);
            c.restore();
        }
    }

    public int baseW = 1, baseH = 1;
    public final Matrix image = new Matrix();
    public Shape shape = Shape.NONE;
    public Path freePath;
    public int border = 0;
    public int borderColor = Color.WHITE;
    public List<TextLayer> texts = new ArrayList<>();

    public EditState copy() {
        EditState e = new EditState();
        e.baseW = baseW;
        e.baseH = baseH;
        e.image.set(image);
        e.shape = shape;
        e.freePath = freePath == null ? null : new Path(freePath);
        e.border = border;
        e.borderColor = borderColor;
        for (TextLayer t : texts) e.texts.add(t.copy());
        return e;
    }

    public void fit(boolean fill) {
        float s = fill ? Math.max((float) S / baseW, (float) S / baseH) : Math.min((float) S / baseW, (float) S / baseH);
        image.reset();
        image.postScale(s, s);
        image.postTranslate((S - baseW * s) / 2, (S - baseH * s) / 2);
    }

    /** Forma de recorte en coordenadas 512, o null si no hay. */
    public Path shapePath() {
        float in = border + 6;
        RectF r = new RectF(in, in, S - in, S - in);
        Path p = new Path();
        switch (shape) {
            case ROUNDED:
                p.addRoundRect(r, 70, 70, Path.Direction.CW);
                return p;
            case CIRCLE:
                p.addOval(r, Path.Direction.CW);
                return p;
            case HEART: {
                float x = r.left, y = r.top, w = r.width(), h = r.height();
                p.moveTo(x + w / 2, y + h * 0.25f);
                p.cubicTo(x + w * 0.35f, y - h * 0.05f, x - w * 0.05f, y + h * 0.05f, x + w * 0.02f, y + h * 0.38f);
                p.cubicTo(x + w * 0.08f, y + h * 0.65f, x + w * 0.4f, y + h * 0.82f, x + w / 2, y + h * 0.98f);
                p.cubicTo(x + w * 0.6f, y + h * 0.82f, x + w * 0.92f, y + h * 0.65f, x + w * 0.98f, y + h * 0.38f);
                p.cubicTo(x + w * 1.05f, y + h * 0.05f, x + w * 0.65f, y - h * 0.05f, x + w / 2, y + h * 0.25f);
                p.close();
                return p;
            }
            case STAR: {
                float cx = S / 2f, cy = S / 2f + 15, R = r.width() / 2, ri = R * 0.48f;
                for (int i = 0; i < 10; i++) {
                    double a = -Math.PI / 2 + i * Math.PI / 5;
                    float rr = i % 2 == 0 ? R : ri;
                    float px = cx + (float) (Math.cos(a) * rr), py = cy + (float) (Math.sin(a) * rr);
                    if (i == 0) p.moveTo(px, py); else p.lineTo(px, py);
                }
                p.close();
                return p;
            }
            case FREE:
                return freePath;
            default:
                return null;
        }
    }

    /** Dibuja el sticker final de 512x512 a partir de un cuadro de la fuente. */
    public Bitmap render(Bitmap frame) {
        Bitmap content = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
        Canvas cc = new Canvas(content);
        Paint bp = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
        if (frame != null) {
            Matrix m = new Matrix();
            m.setScale((float) baseW / frame.getWidth(), (float) baseH / frame.getHeight());
            m.postConcat(image);
            cc.drawBitmap(frame, m, bp);
        }
        Path mask = shapePath();
        if (mask != null) {
            // rellena la forma usando la imagen como "pintura": recorte con borde suavizado
            Bitmap masked = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
            Paint sp = new Paint(Paint.ANTI_ALIAS_FLAG);
            sp.setShader(new BitmapShader(content, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
            new Canvas(masked).drawPath(mask, sp);
            content.recycle();
            content = masked;
        }

        Bitmap out = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
        Canvas oc = new Canvas(out);
        if (border > 0) {
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setColor(borderColor);
            if (mask != null) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(border * 2);
                p.setStrokeJoin(Paint.Join.ROUND);
                oc.drawPath(mask, p);
            } else {
                Bitmap a = content.extractAlpha();
                for (float rad : new float[]{border / 2f, border}) {
                    for (int i = 0; i < 24; i++) {
                        double ang = i * Math.PI / 12;
                        oc.drawBitmap(a, (float) Math.cos(ang) * rad, (float) Math.sin(ang) * rad, p);
                    }
                }
                a.recycle();
            }
        }
        oc.drawBitmap(content, 0, 0, null);
        content.recycle();
        for (TextLayer t : texts) t.draw(oc);
        return out;
    }
}
