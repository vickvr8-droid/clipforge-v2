package com.vick.wordapdf

/** Modelo intermedio del documento, independiente de Android (se puede probar en la JVM). */

data class RunStyle(
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strike: Boolean = false,
    val sizePt: Float = 11f,
    val color: Int? = null,
    val highlight: Int? = null,
    val font: String? = null,
    val superscript: Boolean = false,
    val subscript: Boolean = false,
)

data class TextRun(val text: String, val style: RunStyle)

enum class Align { LEFT, CENTER, RIGHT, JUSTIFY }

data class ParaFormat(
    val align: Align = Align.LEFT,
    val spaceBeforePt: Float = 0f,
    val spaceAfterPt: Float = 0f,
    val lineMult: Float = 1f,
    val indentLeftPt: Float = 0f,
    val indentRightPt: Float = 0f,
    val firstLinePt: Float = 0f,
)

sealed interface Block

data class Paragraph(val runs: List<TextRun>, val format: ParaFormat, val markSizePt: Float) : Block {
    val text: String get() = runs.joinToString("") { it.text }
}

class ImageBlock(val bytes: ByteArray, val widthPt: Float, val heightPt: Float, val align: Align) : Block

object PageBreak : Block

data class TableCell(val paragraphs: List<Paragraph>, val shading: Int?, val gridSpan: Int)

data class TableBlock(val rows: List<List<TableCell>>, val colWidthsPt: List<Float>) : Block

data class PageSetup(
    val widthPt: Float = 595f,
    val heightPt: Float = 842f,
    val marginTopPt: Float = 72f,
    val marginBottomPt: Float = 72f,
    val marginLeftPt: Float = 72f,
    val marginRightPt: Float = 72f,
)

data class DocxDocument(val blocks: List<Block>, val page: PageSetup)
