package com.vick.wordapdf

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.MetricAffectingSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.SubscriptSpan
import android.text.style.SuperscriptSpan
import android.text.style.TypefaceSpan
import android.text.style.UnderlineSpan
import java.io.OutputStream

/**
 * Dibuja un [DocxDocument] en un PDF con texto real (seleccionable y editable).
 * El PDF resultante NO lleva cifrado ni contraseña, así que no tiene restricciones
 * de permisos: cualquier editor de PDF puede modificarlo, copiar texto e imprimir.
 * 1 unidad del lienzo = 1 punto PDF.
 */
class PdfComposer(private val page: PageSetup) {

    private class SizeSpan(private val sizePt: Float) : MetricAffectingSpan() {
        override fun updateDrawState(tp: TextPaint) { tp.textSize = sizePt }
        override fun updateMeasureState(tp: TextPaint) { tp.textSize = sizePt }
    }

    private val doc = PdfDocument()
    private var current: PdfDocument.Page? = null
    private var pageNo = 0
    private var y = 0f
    private var pageHasContent = false

    private val left = page.marginLeftPt
    private val top = page.marginTopPt
    private val bottom = page.heightPt - page.marginBottomPt
    private val contentW = (page.widthPt - page.marginLeftPt - page.marginRightPt).coerceAtLeast(72f)
    private val canvas: Canvas get() = current!!.canvas

    fun write(blocks: List<Block>, out: OutputStream) {
        try {
            newPage()
            for (b in blocks) {
                when (b) {
                    is Paragraph -> drawParagraph(b)
                    is ImageBlock -> drawImage(b)
                    is TableBlock -> drawTable(b)
                    PageBreak -> newPage()
                }
            }
            current?.let { doc.finishPage(it) }
            current = null
            doc.writeTo(out)
        } finally {
            doc.close()
        }
    }

    private fun newPage() {
        current?.let { doc.finishPage(it) }
        pageNo++
        val info = PdfDocument.PageInfo.Builder(page.widthPt.toInt(), page.heightPt.toInt(), pageNo).create()
        current = doc.startPage(info)
        y = top
        pageHasContent = false
    }

    // ---------- Texto ----------

    private fun familyFor(font: String?): String? {
        val f = font?.lowercase() ?: return null
        return when {
            listOf("courier", "consolas", "mono", "lucida console").any { it in f } -> "monospace"
            listOf("times", "cambria", "georgia", "garamond", "book antiqua", "palatino", "serif")
                .any { it in f } && "sans" !in f -> "serif"
            else -> null
        }
    }

    private fun appendRuns(sb: SpannableStringBuilder, runs: List<TextRun>) {
        for (r in runs) {
            val s = sb.length
            sb.append(r.text)
            val e = sb.length
            if (s == e) continue
            val st = r.style
            fun span(o: Any) = sb.setSpan(o, s, e, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            when {
                st.bold && st.italic -> span(StyleSpan(Typeface.BOLD_ITALIC))
                st.bold -> span(StyleSpan(Typeface.BOLD))
                st.italic -> span(StyleSpan(Typeface.ITALIC))
            }
            if (st.underline) span(UnderlineSpan())
            if (st.strike) span(StrikethroughSpan())
            val size = if (st.superscript || st.subscript) st.sizePt * 0.65f else st.sizePt
            span(SizeSpan(size))
            if (st.superscript) span(SuperscriptSpan())
            if (st.subscript) span(SubscriptSpan())
            st.color?.let { span(ForegroundColorSpan(it)) }
            st.highlight?.let { span(BackgroundColorSpan(it)) }
            familyFor(st.font)?.let { span(TypefaceSpan(it)) }
        }
    }

    private fun layoutFor(text: CharSequence, baseSize: Float, width: Int, fmt: ParaFormat): StaticLayout {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = baseSize
            color = 0xFF000000.toInt()
        }
        val align = when (fmt.align) {
            Align.CENTER -> Layout.Alignment.ALIGN_CENTER
            Align.RIGHT -> Layout.Alignment.ALIGN_OPPOSITE
            else -> Layout.Alignment.ALIGN_NORMAL
        }
        val b = StaticLayout.Builder.obtain(text, 0, text.length, paint, width.coerceAtLeast(10))
            .setAlignment(align)
            .setLineSpacing(0f, fmt.lineMult)
            .setIncludePad(false)
        if (fmt.align == Align.JUSTIFY && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b.setJustificationMode(Layout.JUSTIFICATION_MODE_INTER_WORD)
        }
        return b.build()
    }

    private fun paragraphText(p: Paragraph): CharSequence {
        val sb = SpannableStringBuilder()
        appendRuns(sb, p.runs)
        val fmt = p.format
        val leftInd = fmt.indentLeftPt.coerceAtLeast(0f)
        val first = (leftInd + fmt.firstLinePt).coerceAtLeast(0f)
        if (sb.isNotEmpty() && (leftInd > 0f || first > 0f)) {
            sb.setSpan(LeadingMarginSpan.Standard(first.toInt(), leftInd.toInt()), 0, sb.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        }
        return sb
    }

    private fun drawParagraph(p: Paragraph) {
        val fmt = p.format
        if (pageHasContent) y += fmt.spaceBeforePt
        val width = (contentW - fmt.indentRightPt.coerceAtLeast(0f)).toInt()
        val layout = layoutFor(paragraphText(p), p.markSizePt, width, fmt)
        drawLayoutSplit(layout, left)
        y += fmt.spaceAfterPt
    }

    /** Dibuja el layout repartiendo sus líneas entre páginas cuando no cabe. */
    private fun drawLayoutSplit(layout: StaticLayout, x: Float) {
        var line = 0
        while (line < layout.lineCount) {
            val avail = bottom - y
            val startTop = layout.getLineTop(line)
            var end = line
            while (end < layout.lineCount && layout.getLineBottom(end) - startTop <= avail) end++
            if (end == line) {
                if (pageHasContent) { newPage(); continue }
                end = line + 1 // línea más alta que la página: se dibuja igual
            }
            val h = (layout.getLineBottom(end - 1) - startTop).toFloat()
            canvas.save()
            canvas.clipRect(0f, y, page.widthPt, y + h)
            canvas.translate(x, y - startTop)
            layout.draw(canvas)
            canvas.restore()
            y += h
            pageHasContent = true
            line = end
            if (line < layout.lineCount) newPage()
        }
    }

    // ---------- Imágenes ----------

    private fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > 2400 || bounds.outHeight / sample > 2400) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun drawImage(img: ImageBlock) {
        val bmp = decode(img.bytes) ?: return // formatos no soportados (EMF/WMF) se omiten
        try {
            var w = if (img.widthPt > 0f) img.widthPt else bmp.width * 0.75f
            var h = if (img.heightPt > 0f) img.heightPt else bmp.height * 0.75f
            val maxH = bottom - top
            val scale = minOf(1f, contentW / w, maxH / h)
            w *= scale; h *= scale
            if (y + h > bottom && pageHasContent) newPage()
            val x = when (img.align) {
                Align.CENTER -> left + (contentW - w) / 2f
                Align.RIGHT -> left + contentW - w
                else -> left
            }
            canvas.drawBitmap(bmp, null, RectF(x, y, x + w, y + h), Paint(Paint.FILTER_BITMAP_FLAG))
            y += h
            pageHasContent = true
        } finally {
            bmp.recycle()
        }
    }

    // ---------- Tablas ----------

    private fun drawTable(t: TableBlock) {
        val maxCols = maxOf(t.colWidthsPt.size, t.rows.maxOfOrNull { r -> r.sumOf { it.gridSpan } } ?: 1)
        var cols = if (t.colWidthsPt.size == maxCols && t.colWidthsPt.all { it > 0f }) t.colWidthsPt
        else List(maxCols) { contentW / maxCols }
        val total = cols.sum()
        if (total > contentW) cols = cols.map { it * contentW / total }

        val pad = 4f
        val border = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 0.5f; color = 0xFF000000.toInt() }
        val fill = Paint().apply { style = Paint.Style.FILL }

        for (row in t.rows) {
            var col = 0
            val cells = row.map { cell ->
                val span = cell.gridSpan.coerceAtMost(cols.size - col).coerceAtLeast(1)
                val x = left + cols.take(col).sum()
                val w = cols.drop(col).take(span).sum()
                col += span
                val sb = SpannableStringBuilder()
                cell.paragraphs.forEachIndexed { i, p ->
                    if (i > 0) sb.append('\n')
                    appendRuns(sb, p.runs)
                }
                val fmt = cell.paragraphs.firstOrNull()?.format?.copy(lineMult = 1f) ?: ParaFormat()
                val size = cell.paragraphs.firstOrNull()?.markSizePt ?: 11f
                Triple(cell, RectF(x, 0f, x + w, 0f), layoutFor(sb, size, (w - 2 * pad).toInt(), fmt))
            }
            val rowH = (cells.maxOfOrNull { it.third.height.toFloat() } ?: 0f) + 2 * pad
            if (y + rowH > bottom && pageHasContent) newPage()
            for ((cell, r, layout) in cells) {
                r.top = y; r.bottom = y + rowH
                cell.shading?.let { fill.color = it; canvas.drawRect(r, fill) }
                canvas.save()
                canvas.clipRect(r)
                canvas.translate(r.left + pad, y + pad)
                layout.draw(canvas)
                canvas.restore()
                canvas.drawRect(r, border)
            }
            y += rowH
            pageHasContent = true
        }
        y += 6f
    }
}
