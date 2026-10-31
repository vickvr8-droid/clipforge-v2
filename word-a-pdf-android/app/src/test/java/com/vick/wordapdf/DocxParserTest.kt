package com.vick.wordapdf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DocxParserTest {

    private fun parseEjemplo(): DocxDocument =
        javaClass.getResourceAsStream("/ejemplo.docx")!!.use { DocxParser.parse(it) }

    @Test
    fun leeTextoYFormato() {
        val doc = parseEjemplo()
        val paras = doc.blocks.filterIsInstance<Paragraph>()
        assertEquals("Informe de prueba", paras.first().text)
        assertTrue(paras.first().runs.first().style.sizePt > 20f)

        val mixto = paras.first { it.text.startsWith("Texto normal") }
        assertTrue(mixto.runs.first { it.text == "negrita" }.style.bold)
        val roja = mixto.runs.first { it.text == "cursiva roja" }.style
        assertTrue(roja.italic)
        assertEquals(0xFFC00000.toInt(), roja.color)

        assertEquals(Align.CENTER, paras.first { it.text.startsWith("Centrado") }.format.align)
    }

    @Test
    fun listasTablasYSaltos() {
        val doc = parseEjemplo()
        val textos = doc.blocks.filterIsInstance<Paragraph>().map { it.text }
        assertTrue(textos.contains("1.\tUno"))
        assertTrue(textos.contains("2.\tDos"))
        assertTrue(textos.contains("•\tViñeta"))

        val tabla = doc.blocks.filterIsInstance<TableBlock>().single()
        assertEquals(2, tabla.rows.size)
        assertEquals("B2", tabla.rows[1][1].paragraphs.single().text)

        val salto = doc.blocks.indexOf(PageBreak)
        assertTrue(salto > 0)
        assertTrue(doc.blocks.drop(salto).filterIsInstance<Paragraph>().any { it.text == "Segunda página" })
        assertEquals(612f, doc.page.widthPt, 1f) // python-docx usa tamaño Carta
    }

    @Test(expected = IllegalArgumentException::class)
    fun rechazaArchivoQueNoEsDocx() {
        DocxParser.parse("no soy un zip".byteInputStream())
    }
}
