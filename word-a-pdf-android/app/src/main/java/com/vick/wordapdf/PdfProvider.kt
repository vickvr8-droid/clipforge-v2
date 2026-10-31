package com.vick.wordapdf

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Expone los PDF generados (guardados en la caché de la app) a otras apps,
 * como WhatsApp o un editor de PDF, mediante permisos temporales de URI.
 */
class PdfProvider : ContentProvider() {

    companion object {
        fun carpeta(ctx: Context): File = File(ctx.cacheDir, "pdf").apply { mkdirs() }

        fun uriPara(ctx: Context, archivo: File): Uri = Uri.Builder()
            .scheme("content")
            .authority("${ctx.packageName}.archivos")
            .appendPath(archivo.name)
            .build()
    }

    override fun onCreate() = true

    private fun archivo(uri: Uri): File {
        val nombre = uri.lastPathSegment ?: throw FileNotFoundException(uri.toString())
        val dir = carpeta(context!!)
        val f = File(dir, nombre)
        if (f.canonicalFile.parentFile != dir.canonicalFile || !f.exists()) throw FileNotFoundException(nombre)
        return f
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
        val f = archivo(uri)
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val valores = cols.map {
            when (it) {
                OpenableColumns.DISPLAY_NAME -> f.name
                OpenableColumns.SIZE -> f.length()
                else -> null
            }
        }
        return MatrixCursor(cols, 1).apply { addRow(valores) }
    }

    override fun getType(uri: Uri) = "application/pdf"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
        ParcelFileDescriptor.open(archivo(uri), ParcelFileDescriptor.parseMode(mode))

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?) = 0
}
