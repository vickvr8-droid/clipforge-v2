package com.vick.wordapdf

import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.InputStream
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Lee un .docx (zip con XML de WordprocessingML) y lo convierte en [DocxDocument].
 * Soporta: estilos (con herencia), negrita/cursiva/subrayado/tachado, tamaños, colores,
 * resaltado, alineación, sangrías, interlineado, listas numeradas y con viñetas,
 * tablas, imágenes, saltos de línea y de página.
 */
class DocxParser private constructor(private val parts: Map<String, ByteArray>) {

    companion object {
        private const val W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        private const val A = "http://schemas.openxmlformats.org/drawingml/2006/main"
        private const val R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        private const val MAX_PART_BYTES = 64L * 1024 * 1024

        fun parse(input: InputStream): DocxDocument {
            val parts = HashMap<String, ByteArray>()
            ZipInputStream(input).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val name = entry.name.trimStart('/')
                    if (!entry.isDirectory && name.startsWith("word/")) {
                        parts[name] = readLimited(zip)
                    }
                }
            }
            if ("word/document.xml" !in parts) {
                throw IllegalArgumentException("El archivo no es un documento Word .docx válido")
            }
            return DocxParser(parts).parseDocument()
        }

        private fun readLimited(input: InputStream): ByteArray {
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > MAX_PART_BYTES) throw IllegalArgumentException("Archivo demasiado grande")
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }

        private fun twipsToPt(v: String?): Float? = v?.toFloatOrNull()?.div(20f)
    }

    // ---------- Propiedades parciales (para combinar estilos) ----------

    private data class RProps(
        val bold: Boolean? = null, val italic: Boolean? = null, val underline: Boolean? = null,
        val strike: Boolean? = null, val sizePt: Float? = null, val color: Int? = null,
        val highlight: Int? = null, val font: String? = null, val vertAlign: String? = null,
        val hidden: Boolean? = null,
    ) {
        fun over(o: RProps?): RProps = if (o == null) this else RProps(
            o.bold ?: bold, o.italic ?: italic, o.underline ?: underline, o.strike ?: strike,
            o.sizePt ?: sizePt, o.color ?: color, o.highlight ?: highlight, o.font ?: font,
            o.vertAlign ?: vertAlign, o.hidden ?: hidden,
        )

        fun resolve() = RunStyle(
            bold = bold ?: false, italic = italic ?: false, underline = underline ?: false,
            strike = strike ?: false, sizePt = sizePt ?: 11f, color = color, highlight = highlight,
            font = font, superscript = vertAlign == "superscript", subscript = vertAlign == "subscript",
        )
    }

    private data class PProps(
        val align: Align? = null, val before: Float? = null, val after: Float? = null,
        val lineMult: Float? = null, val left: Float? = null, val right: Float? = null,
        val firstLine: Float? = null, val numId: String? = null, val ilvl: Int? = null,
    ) {
        fun over(o: PProps?): PProps = if (o == null) this else PProps(
            o.align ?: align, o.before ?: before, o.after ?: after, o.lineMult ?: lineMult,
            o.left ?: left, o.right ?: right, o.firstLine ?: firstLine, o.numId ?: numId, o.ilvl ?: ilvl,
        )

        fun resolve() = ParaFormat(
            align = align ?: Align.LEFT, spaceBeforePt = before ?: 0f, spaceAfterPt = after ?: 0f,
            lineMult = lineMult ?: 1f, indentLeftPt = left ?: 0f, indentRightPt = right ?: 0f,
            firstLinePt = firstLine ?: 0f,
        )
    }

    private class Style(val basedOn: String?, val r: RProps?, val p: PProps?)

    private class Level(val fmt: String, val text: String, val start: Int, val p: PProps?)

    private val styles = HashMap<String, Style>()
    private var defaultParaStyle: String? = null
    private var docDefaultR = RProps()
    private var docDefaultP = PProps()
    private val rels = HashMap<String, String>()
    private val abstractNums = HashMap<String, Map<Int, Level>>()
    private val numToAbstract = HashMap<String, String>()
    private val counters = HashMap<String, IntArray>()
    private var page = PageSetup()

    // ---------- XML helpers ----------

    private fun xml(name: String): Element? {
        val bytes = parts[name] ?: return null
        val f = DocumentBuilderFactory.newInstance()
        f.isNamespaceAware = true
        runCatching { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
        runCatching { f.isExpandEntityReferences = false }
        return f.newDocumentBuilder().parse(bytes.inputStream()).documentElement
    }

    private fun Element.children(): List<Element> {
        val out = ArrayList<Element>()
        var n: Node? = firstChild
        while (n != null) {
            if (n is Element) out += n
            n = n.nextSibling
        }
        return out
    }

    private fun Element.child(local: String): Element? = children().firstOrNull { it.localName == local }

    private fun Element.w(attr: String): String? =
        getAttributeNS(W, attr).ifEmpty { null }

    private fun Element.wval(): String? = w("val")

    private fun Element.descendants(local: String): List<Element> {
        val out = ArrayList<Element>()
        fun walk(e: Element) {
            for (c in e.children()) {
                if (c.localName == local) out += c
                walk(c)
            }
        }
        walk(this)
        return out
    }

    private fun toggle(e: Element?): Boolean? {
        if (e == null) return null
        return when (e.wval()?.lowercase()) {
            "0", "false", "off", "none" -> false
            else -> true
        }
    }

    private fun parseHex(v: String?): Int? {
        if (v == null || v.equals("auto", true) || v.length != 6) return null
        val rgb = v.toIntOrNull(16) ?: return null
        return (0xFF shl 24) or rgb
    }

    private fun highlightColor(name: String?): Int? = when (name) {
        "yellow" -> 0xFFFFFF00.toInt(); "green" -> 0xFF00FF00.toInt(); "cyan" -> 0xFF00FFFF.toInt()
        "magenta" -> 0xFFFF00FF.toInt(); "blue" -> 0xFF0000FF.toInt(); "red" -> 0xFFFF0000.toInt()
        "darkBlue" -> 0xFF000080.toInt(); "darkCyan" -> 0xFF008080.toInt(); "darkGreen" -> 0xFF008000.toInt()
        "darkMagenta" -> 0xFF800080.toInt(); "darkRed" -> 0xFF800000.toInt(); "darkYellow" -> 0xFF808000.toInt()
        "darkGray" -> 0xFF808080.toInt(); "lightGray" -> 0xFFC0C0C0.toInt(); "black" -> 0xFF000000.toInt()
        else -> null
    }

    private fun readRPr(rPr: Element?): RProps? {
        if (rPr == null) return null
        val u = rPr.child("u")
        val shd = parseHex(rPr.child("shd")?.w("fill"))
        return RProps(
            bold = toggle(rPr.child("b")),
            italic = toggle(rPr.child("i")),
            underline = u?.let { it.wval() != "none" },
            strike = toggle(rPr.child("strike")) ?: toggle(rPr.child("dstrike")),
            sizePt = rPr.child("sz")?.wval()?.toFloatOrNull()?.div(2f),
            color = parseHex(rPr.child("color")?.wval()),
            highlight = highlightColor(rPr.child("highlight")?.wval()) ?: shd,
            font = rPr.child("rFonts")?.let { it.w("ascii") ?: it.w("hAnsi") },
            vertAlign = rPr.child("vertAlign")?.wval(),
            hidden = toggle(rPr.child("vanish")),
        )
    }

    private fun readPPr(pPr: Element?): PProps? {
        if (pPr == null) return null
        val spacing = pPr.child("spacing")
        val ind = pPr.child("ind")
        val numPr = pPr.child("numPr")
        val line = spacing?.w("line")?.toFloatOrNull()
        val lineRule = spacing?.w("lineRule") ?: "auto"
        val hanging = twipsToPt(ind?.w("hanging"))
        return PProps(
            align = when (pPr.child("jc")?.wval()) {
                "center" -> Align.CENTER
                "right", "end" -> Align.RIGHT
                "both", "distribute", "justify" -> Align.JUSTIFY
                "left", "start" -> Align.LEFT
                else -> null
            },
            before = twipsToPt(spacing?.w("before")),
            after = twipsToPt(spacing?.w("after")),
            lineMult = if (line != null && lineRule == "auto") (line / 240f).coerceIn(0.5f, 4f) else null,
            left = twipsToPt(ind?.w("left") ?: ind?.w("start")),
            right = twipsToPt(ind?.w("right") ?: ind?.w("end")),
            firstLine = hanging?.let { -it } ?: twipsToPt(ind?.w("firstLine")),
            numId = numPr?.child("numId")?.wval(),
            ilvl = numPr?.child("ilvl")?.wval()?.toIntOrNull(),
        )
    }

    // ---------- Estilos, relaciones, numeración ----------

    private fun loadStyles() {
        val root = xml("word/styles.xml") ?: return
        root.child("docDefaults")?.let { dd ->
            readRPr(dd.child("rPrDefault")?.child("rPr"))?.let { docDefaultR = docDefaultR.over(it) }
            readPPr(dd.child("pPrDefault")?.child("pPr"))?.let { docDefaultP = docDefaultP.over(it) }
        }
        for (s in root.children().filter { it.localName == "style" }) {
            val id = s.w("styleId") ?: continue
            styles[id] = Style(s.child("basedOn")?.wval(), readRPr(s.child("rPr")), readPPr(s.child("pPr")))
            if (s.w("type") == "paragraph" && s.w("default") == "1") defaultParaStyle = id
        }
    }

    private fun styleChain(id: String?): List<Style> {
        val chain = ArrayList<Style>()
        val seen = HashSet<String>()
        var cur = id
        while (cur != null && seen.add(cur)) {
            val s = styles[cur] ?: break
            chain.add(0, s)
            cur = s.basedOn
        }
        return chain
    }

    private fun styleR(id: String?): RProps = styleChain(id).fold(RProps()) { acc, s -> acc.over(s.r) }
    private fun styleP(id: String?): PProps = styleChain(id).fold(PProps()) { acc, s -> acc.over(s.p) }

    private fun loadRels() {
        val root = xml("word/_rels/document.xml.rels") ?: return
        for (r in root.children()) {
            val id = r.getAttribute("Id")
            val target = r.getAttribute("Target")
            if (id.isNotEmpty() && target.isNotEmpty() && r.getAttribute("TargetMode") != "External") {
                rels[id] = if (target.startsWith("/")) target.trimStart('/') else "word/$target"
            }
        }
    }

    private fun loadNumbering() {
        val root = xml("word/numbering.xml") ?: return
        for (an in root.children().filter { it.localName == "abstractNum" }) {
            val id = an.w("abstractNumId") ?: continue
            val levels = HashMap<Int, Level>()
            for (lvl in an.children().filter { it.localName == "lvl" }) {
                val il = lvl.w("ilvl")?.toIntOrNull() ?: continue
                levels[il] = Level(
                    fmt = lvl.child("numFmt")?.wval() ?: "decimal",
                    text = lvl.child("lvlText")?.wval() ?: "",
                    start = lvl.child("start")?.wval()?.toIntOrNull() ?: 1,
                    p = readPPr(lvl.child("pPr")),
                )
            }
            abstractNums[id] = levels
        }
        for (num in root.children().filter { it.localName == "num" }) {
            val id = num.w("numId") ?: continue
            num.child("abstractNumId")?.wval()?.let { numToAbstract[id] = it }
        }
    }

    private fun roman(n: Int): String {
        val vals = intArrayOf(1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1)
        val syms = arrayOf("m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i")
        var x = n
        val sb = StringBuilder()
        for (i in vals.indices) while (x >= vals[i]) { sb.append(syms[i]); x -= vals[i] }
        return sb.toString()
    }

    private fun letters(n: Int): String {
        if (n <= 0) return ""
        val c = ('a' + (n - 1) % 26)
        return c.toString().repeat((n - 1) / 26 + 1)
    }

    private fun formatNumber(n: Int, fmt: String): String = when (fmt) {
        "lowerLetter" -> letters(n)
        "upperLetter" -> letters(n).uppercase()
        "lowerRoman" -> roman(n)
        "upperRoman" -> roman(n).uppercase()
        "none" -> ""
        else -> n.toString()
    }

    /** Devuelve (etiqueta de la lista, propiedades de sangría del nivel). */
    private fun listLabel(numId: String?, ilvl: Int): Pair<String, PProps?>? {
        if (numId == null || numId == "0") return null
        val levels = abstractNums[numToAbstract[numId] ?: return null] ?: return null
        val lvl = levels[ilvl] ?: return null
        val cnt = counters.getOrPut(numId) { IntArray(9) { (levels[it]?.start ?: 1) - 1 } }
        val idx = ilvl.coerceIn(0, 8)
        cnt[idx]++
        for (deeper in idx + 1 until 9) cnt[deeper] = (levels[deeper]?.start ?: 1) - 1
        if (lvl.fmt == "bullet") {
            val bullet = when (idx % 3) { 0 -> "•"; 1 -> "◦"; else -> "▪" }
            return bullet to lvl.p
        }
        var label = lvl.text
        for (k in 0..idx) {
            val fmtK = levels[k]?.fmt ?: "decimal"
            label = label.replace("%${k + 1}", formatNumber(cnt[k].coerceAtLeast(1), fmtK))
        }
        return label to lvl.p
    }

    // ---------- Documento ----------

    private fun parseDocument(): DocxDocument {
        loadStyles()
        loadRels()
        loadNumbering()
        val body = xml("word/document.xml")?.child("body")
            ?: throw IllegalArgumentException("document.xml sin cuerpo")
        val blocks = ArrayList<Block>()
        parseBlocks(body, blocks)
        return DocxDocument(blocks, page)
    }

    private fun parseBlocks(container: Element, out: MutableList<Block>) {
        for (e in container.children()) {
            when (e.localName) {
                "p" -> out += parseParagraph(e)
                "tbl" -> out += parseTable(e)
                "sdt" -> e.child("sdtContent")?.let { parseBlocks(it, out) }
                "customXml" -> parseBlocks(e, out)
                "sectPr" -> readSection(e)
            }
        }
    }

    private fun readSection(sectPr: Element) {
        val sz = sectPr.child("pgSz")
        val mar = sectPr.child("pgMar")
        val d = PageSetup()
        page = PageSetup(
            widthPt = twipsToPt(sz?.w("w")) ?: d.widthPt,
            heightPt = twipsToPt(sz?.w("h")) ?: d.heightPt,
            marginTopPt = twipsToPt(mar?.w("top"))?.let { kotlin.math.abs(it) } ?: d.marginTopPt,
            marginBottomPt = twipsToPt(mar?.w("bottom"))?.let { kotlin.math.abs(it) } ?: d.marginBottomPt,
            marginLeftPt = twipsToPt(mar?.w("left")) ?: d.marginLeftPt,
            marginRightPt = twipsToPt(mar?.w("right")) ?: d.marginRightPt,
        )
    }

    private fun parseParagraph(p: Element): List<Block> {
        val pPr = p.child("pPr")
        val direct = readPPr(pPr)
        val styleId = pPr?.child("pStyle")?.wval() ?: defaultParaStyle
        var pp = docDefaultP.over(styleP(styleId))
        val numId = direct?.numId ?: pp.numId
        val ilvl = direct?.ilvl ?: pp.ilvl ?: 0
        val label = listLabel(numId, ilvl)
        if (label != null) pp = pp.over(label.second)
        pp = pp.over(direct)
        val fmt = pp.resolve()
        val baseR = docDefaultR.over(styleR(styleId))
        val markR = baseR.over(readRPr(pPr?.child("rPr"))).resolve()

        val out = ArrayList<Block>()
        var runs = ArrayList<TextRun>()
        var emitted = false

        fun flush() {
            if (runs.isNotEmpty()) {
                out += Paragraph(runs, fmt, markR.sizePt)
                emitted = true
                runs = ArrayList()
            }
        }

        if (label != null && label.first.isNotEmpty()) runs += TextRun(label.first + "\t", markR.copy(underline = false, strike = false))

        fun handleRun(r: Element) {
            val rPr = r.child("rPr")
            val rStyle = rPr?.child("rStyle")?.wval()
            val props = baseR.over(styleR(rStyle)).over(readRPr(rPr))
            if (props.hidden == true) return
            val style = props.resolve()
            val sb = StringBuilder()
            fun pushText() {
                if (sb.isNotEmpty()) { runs += TextRun(sb.toString(), style); sb.clear() }
            }
            for (c in r.children()) {
                when (c.localName) {
                    "t" -> sb.append(c.textContent)
                    "tab", "ptab" -> sb.append('\t')
                    "cr" -> sb.append('\n')
                    "noBreakHyphen" -> sb.append('-')
                    "br" -> if (c.w("type") == "page") {
                        pushText(); flush(); out += PageBreak; emitted = true
                    } else sb.append('\n')
                    "sym" -> c.w("char")?.toIntOrNull(16)?.let { code ->
                        if (code !in 0xE000..0xF8FF) sb.appendCodePoint(code) else sb.append('•')
                    }
                    "drawing", "pict", "object" -> {
                        pushText()
                        image(c, fmt.align)?.let { flush(); out += it; emitted = true }
                    }
                }
            }
            pushText()
        }

        fun walk(e: Element) {
            for (c in e.children()) {
                when (c.localName) {
                    "r" -> handleRun(c)
                    "hyperlink", "ins", "smartTag", "sdt", "sdtContent", "fldSimple",
                    "customXml", "moveTo", "bdo", "dir" -> walk(c)
                }
            }
        }
        walk(p)

        // Un párrafo vacío en Word ocupa una línea en blanco.
        if (runs.isNotEmpty() || !emitted) out += Paragraph(runs, fmt, markR.sizePt)
        return out
    }

    private fun image(e: Element, align: Align): ImageBlock? {
        val blip = e.descendants("blip").firstOrNull()
        val embed = blip?.getAttributeNS(R, "embed")?.ifEmpty { null }
            ?: e.descendants("imagedata").firstOrNull()?.getAttributeNS(R, "id")?.ifEmpty { null }
            ?: return null
        val bytes = parts[rels[embed] ?: return null] ?: return null
        val extent = e.descendants("extent").firstOrNull()
            ?: e.descendants("ext").firstOrNull { it.namespaceURI == A }
        val cx = extent?.getAttribute("cx")?.toFloatOrNull()
        val cy = extent?.getAttribute("cy")?.toFloatOrNull()
        // EMU -> puntos (1 pt = 12700 EMU). 0 = usar tamaño natural.
        return ImageBlock(bytes, (cx ?: 0f) / 12700f, (cy ?: 0f) / 12700f, align)
    }

    private fun parseTable(tbl: Element): TableBlock {
        val grid = tbl.child("tblGrid")?.children()
            ?.filter { it.localName == "gridCol" }
            ?.map { twipsToPt(it.w("w")) ?: 0f } ?: emptyList()
        val rows = ArrayList<List<TableCell>>()
        for (tr in tbl.children().filter { it.localName == "tr" }) {
            val cells = ArrayList<TableCell>()
            for (tc in tr.children().filter { it.localName == "tc" || it.localName == "sdt" }) {
                val cell = if (tc.localName == "sdt") tc.child("sdtContent")?.child("tc") ?: continue else tc
                val tcPr = cell.child("tcPr")
                val blocks = ArrayList<Block>()
                parseBlocks(cell, blocks)
                val paras = blocks.flatMap { b ->
                    when (b) {
                        is Paragraph -> listOf(b)
                        is TableBlock -> b.rows.flatten().flatMap { it.paragraphs }
                        else -> emptyList()
                    }
                }
                cells += TableCell(
                    paragraphs = paras,
                    shading = parseHex(tcPr?.child("shd")?.w("fill")),
                    gridSpan = tcPr?.child("gridSpan")?.wval()?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                )
            }
            if (cells.isNotEmpty()) rows += cells
        }
        return TableBlock(rows, grid)
    }
}
