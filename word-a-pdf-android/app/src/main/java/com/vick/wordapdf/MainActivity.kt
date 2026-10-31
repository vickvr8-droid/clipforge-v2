package com.vick.wordapdf

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.io.InputStream

class MainActivity : Activity() {

    companion object {
        private const val REQ_ELEGIR = 1
        private const val REQ_GUARDAR = 2
        private const val MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        private const val MIME_GOOGLE_DOC = "application/vnd.google-apps.document"
        private const val MIME_PDF = "application/pdf"
        private val PAQUETES_WHATSAPP = listOf("com.whatsapp", "com.whatsapp.w4b")
    }

    private lateinit var btnElegir: Button
    private lateinit var progreso: ProgressBar
    private lateinit var txtEstado: TextView
    private lateinit var acciones: List<Button>

    private var pdf: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        btnElegir = findViewById(R.id.btnElegir)
        progreso = findViewById(R.id.progreso)
        txtEstado = findViewById(R.id.txtEstado)
        val btnWhatsApp = findViewById<Button>(R.id.btnWhatsApp)
        val btnCompartir = findViewById<Button>(R.id.btnCompartir)
        val btnGuardar = findViewById<Button>(R.id.btnGuardar)
        val btnAbrir = findViewById<Button>(R.id.btnAbrir)
        acciones = listOf(btnWhatsApp, btnCompartir, btnGuardar, btnAbrir)

        btnElegir.setOnClickListener { elegirWord() }
        btnWhatsApp.setOnClickListener { pdf?.let { enviarWhatsApp(it) } }
        btnCompartir.setOnClickListener { pdf?.let { compartir(it) } }
        btnGuardar.setOnClickListener { pdf?.let { pedirDestino(it) } }
        btnAbrir.setOnClickListener { pdf?.let { abrirPdf(it) } }

        if (savedInstanceState == null) recibirDeOtraApp(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        recibirDeOtraApp(intent)
    }

    /** Google Docs → Compartir y exportar → Enviar una copia → Word, o "Abrir con" desde Drive. */
    private fun recibirDeOtraApp(intent: Intent?) {
        val uri = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            else -> null
        } ?: return
        convertir(uri)
    }

    private fun elegirWord() {
        // Sin CATEGORY_OPENABLE para que el selector muestre también los documentos
        // de Google Docs (archivos "virtuales" de Drive que se exportan a .docx).
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(MIME_DOCX, MIME_GOOGLE_DOC))
        }
        startActivityForResult(i, REQ_ELEGIR)
    }

    private fun pedirDestino(archivo: File) {
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = MIME_PDF
            putExtra(Intent.EXTRA_TITLE, archivo.name)
        }
        startActivityForResult(i, REQ_GUARDAR)
    }

    @Deprecated("Activity framework API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        when (requestCode) {
            REQ_ELEGIR -> convertir(uri)
            REQ_GUARDAR -> pdf?.let { guardarEn(it, uri) }
        }
    }

    private fun nombreDe(uri: Uri): String {
        var nombre: String? = null
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) nombre = c.getString(0)
            }
        }
        return nombre ?: uri.lastPathSegment?.substringAfterLast('/') ?: "documento"
    }

    /** Abre el Word; si es un documento de Google Docs, se lo pide a Drive exportado como .docx. */
    private fun abrirWord(uri: Uri): InputStream {
        if (contentResolver.getType(uri) != MIME_DOCX) {
            val tipos = contentResolver.getStreamTypes(uri, MIME_DOCX)
            if (!tipos.isNullOrEmpty()) {
                contentResolver.openTypedAssetFileDescriptor(uri, MIME_DOCX, null)?.let { return it.createInputStream() }
            }
        }
        return contentResolver.openInputStream(uri) ?: throw IllegalStateException("No se pudo leer el archivo")
    }

    private fun mostrarAcciones(visible: Boolean) {
        acciones.forEach { it.visibility = if (visible) View.VISIBLE else View.GONE }
    }

    private fun convertir(desde: Uri) {
        btnElegir.isEnabled = false
        mostrarAcciones(false)
        progreso.visibility = View.VISIBLE
        txtEstado.setText(R.string.convirtiendo)

        val base = nombreDe(desde).removeSuffix(".docx").removeSuffix(".DOCX")
            .replace(Regex("[\\\\/:*?\"<>|]"), "_").trim().ifEmpty { "documento" }

        Thread {
            val carpeta = PdfProvider.carpeta(this)
            carpeta.listFiles()?.forEach { it.delete() }
            val destino = File(carpeta, "$base.pdf")
            val error = runCatching {
                val doc = abrirWord(desde).use { DocxParser.parse(it) }
                destino.outputStream().use { PdfComposer(doc.page).write(doc.blocks, it) }
            }.exceptionOrNull()

            runOnUiThread {
                btnElegir.isEnabled = true
                progreso.visibility = View.GONE
                if (error == null) {
                    pdf = destino
                    txtEstado.text = getString(R.string.listo, destino.name)
                    mostrarAcciones(true)
                } else {
                    destino.delete()
                    pdf = null
                    txtEstado.text = getString(R.string.error, error.message ?: error.javaClass.simpleName)
                }
            }
        }.start()
    }

    private fun intentEnviar(archivo: File): Intent {
        val uri = PdfProvider.uriPara(this, archivo)
        return Intent(Intent.ACTION_SEND).apply {
            type = MIME_PDF
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri(archivo.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun enviarWhatsApp(archivo: File) {
        for (paquete in PAQUETES_WHATSAPP) {
            try {
                startActivity(intentEnviar(archivo).setPackage(paquete))
                return
            } catch (e: ActivityNotFoundException) {
                // probar con WhatsApp Business
            }
        }
        Toast.makeText(this, R.string.sin_whatsapp, Toast.LENGTH_LONG).show()
        compartir(archivo)
    }

    private fun compartir(archivo: File) {
        startActivity(Intent.createChooser(intentEnviar(archivo), getString(R.string.compartir)))
    }

    private fun guardarEn(archivo: File, uri: Uri) {
        val ok = runCatching {
            contentResolver.openOutputStream(uri, "wt")!!.use { out -> archivo.inputStream().use { it.copyTo(out) } }
        }.isSuccess
        Toast.makeText(this, if (ok) R.string.guardado else R.string.error_guardar, Toast.LENGTH_LONG).show()
    }

    private fun abrirPdf(archivo: File) {
        // Se concede lectura Y escritura para que el editor de PDF pueda guardar cambios.
        val i = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(PdfProvider.uriPara(this@MainActivity, archivo), MIME_PDF)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        try {
            startActivity(Intent.createChooser(i, getString(R.string.abrir)))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.sin_app, Toast.LENGTH_LONG).show()
        }
    }
}
