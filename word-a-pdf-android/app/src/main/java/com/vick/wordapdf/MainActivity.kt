package com.vick.wordapdf

import android.app.Activity
import android.content.ActivityNotFoundException
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

class MainActivity : Activity() {

    companion object {
        private const val REQ_ELEGIR = 1
        private const val REQ_GUARDAR = 2
        private const val MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        private const val MIME_PDF = "application/pdf"
    }

    private lateinit var btnElegir: Button
    private lateinit var btnAbrir: Button
    private lateinit var btnCompartir: Button
    private lateinit var progreso: ProgressBar
    private lateinit var txtEstado: TextView

    private var origen: Uri? = null
    private var resultado: Uri? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        btnElegir = findViewById(R.id.btnElegir)
        btnAbrir = findViewById(R.id.btnAbrir)
        btnCompartir = findViewById(R.id.btnCompartir)
        progreso = findViewById(R.id.progreso)
        txtEstado = findViewById(R.id.txtEstado)

        btnElegir.setOnClickListener { elegirWord() }
        btnAbrir.setOnClickListener { resultado?.let { abrirPdf(it) } }
        btnCompartir.setOnClickListener { resultado?.let { compartirPdf(it) } }

        if (savedInstanceState == null) recibirDeOtraApp(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        recibirDeOtraApp(intent)
    }

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
        origen = uri
        pedirDestino(uri)
    }

    private fun elegirWord() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = MIME_DOCX
        }
        startActivityForResult(i, REQ_ELEGIR)
    }

    private fun nombreDe(uri: Uri): String {
        var nombre: String? = null
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) nombre = c.getString(0)
            }
        }
        return nombre ?: uri.lastPathSegment?.substringAfterLast('/') ?: "documento.docx"
    }

    private fun pedirDestino(origen: Uri) {
        val base = nombreDe(origen).substringBeforeLast('.')
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = MIME_PDF
            putExtra(Intent.EXTRA_TITLE, "$base.pdf")
        }
        startActivityForResult(i, REQ_GUARDAR)
    }

    @Deprecated("Activity framework API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        when (requestCode) {
            REQ_ELEGIR -> { origen = uri; pedirDestino(uri) }
            REQ_GUARDAR -> origen?.let { convertir(it, uri) }
        }
    }

    private fun convertir(desde: Uri, hacia: Uri) {
        btnElegir.isEnabled = false
        btnAbrir.visibility = View.GONE
        btnCompartir.visibility = View.GONE
        progreso.visibility = View.VISIBLE
        txtEstado.setText(R.string.convirtiendo)

        Thread {
            val error = runCatching {
                val doc = contentResolver.openInputStream(desde)?.use { DocxParser.parse(it) }
                    ?: throw IllegalStateException("No se pudo leer el archivo")
                val out = contentResolver.openOutputStream(hacia, "wt")
                    ?: throw IllegalStateException("No se pudo escribir el PDF")
                out.use { PdfComposer(doc.page).write(doc.blocks, it) }
            }.exceptionOrNull()

            runOnUiThread {
                btnElegir.isEnabled = true
                progreso.visibility = View.GONE
                if (error == null) {
                    resultado = hacia
                    txtEstado.text = getString(R.string.listo, nombreDe(hacia))
                    btnAbrir.visibility = View.VISIBLE
                    btnCompartir.visibility = View.VISIBLE
                } else {
                    runCatching { contentResolver.delete(hacia, null, null) }
                    txtEstado.text = getString(R.string.error, error.message ?: error.javaClass.simpleName)
                }
            }
        }.start()
    }

    private fun abrirPdf(uri: Uri) {
        // Se concede lectura Y escritura para que el editor de PDF pueda guardar cambios.
        val i = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, MIME_PDF)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        try {
            startActivity(Intent.createChooser(i, getString(R.string.abrir)))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.sin_app, Toast.LENGTH_LONG).show()
        }
    }

    private fun compartirPdf(uri: Uri) {
        val i = Intent(Intent.ACTION_SEND).apply {
            type = MIME_PDF
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(i, getString(R.string.compartir)))
    }
}
