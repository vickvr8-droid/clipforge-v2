package com.vick.stickerforge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.EditText;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Recibe imágenes, GIF y videos desde "Compartir" (capturas, galería, reels descargados),
 * pregunta a qué paquete van y abre el editor.
 */
@SuppressWarnings("deprecation")
public class ShareActivity extends Activity {
    private File file;
    private boolean moving;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent in = getIntent();
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(in.getAction())) {
            uri = in.getParcelableExtra(Intent.EXTRA_STREAM);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(in.getAction())) {
            ArrayList<Uri> list = in.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null && !list.isEmpty()) uri = list.get(0);
        }
        if (uri == null) {
            ClipData cd = in.getClipData();
            if (cd != null && cd.getItemCount() > 0) uri = cd.getItemAt(0).getUri();
        }
        if (uri == null) {
            String text = in.getStringExtra(Intent.EXTRA_TEXT);
            linkHelp(text);
            return;
        }

        String type = in.getType();
        String rt = getContentResolver().getType(uri);
        if (rt != null && !rt.endsWith("/*")) type = rt;
        if (type == null) type = "";
        moving = type.startsWith("video/") || type.equals("image/gif");
        String ext = type.startsWith("video/") ? ".mp4" : type.equals("image/gif") ? ".gif" : ".img";
        try {
            // El permiso de lectura es temporal: copiamos el archivo enseguida
            file = new File(getCacheDir(), "share_" + System.currentTimeMillis() + ext);
            try (InputStream is = getContentResolver().openInputStream(uri);
                 FileOutputStream fo = new FileOutputStream(file)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = is.read(buf)) > 0) fo.write(buf, 0, n);
            }
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo leer el archivo: " + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        if (Intent.ACTION_SEND_MULTIPLE.equals(in.getAction())) {
            Toast.makeText(this, "Se usará solo el primer archivo", Toast.LENGTH_SHORT).show();
        }
        choosePack();
    }

    private void choosePack() {
        List<PackStore.Pack> all = PackStore.load(this);
        List<PackStore.Pack> ok = new ArrayList<>();
        for (PackStore.Pack p : all) {
            // Las imágenes fijas solo van a paquetes estáticos; videos y GIF a cualquiera
            if ((moving || !p.animated) && p.stickers.size() < 30) ok.add(p);
        }
        List<String> names = new ArrayList<>();
        for (PackStore.Pack p : ok) names.add((p.animated ? "🎞 " : "🖼 ") + p.name + " (" + p.stickers.size() + ")");
        names.add(moving ? "➕ Nuevo paquete animado" : "➕ Nuevo paquete estático");
        new AlertDialog.Builder(this).setTitle("¿A qué paquete?")
                .setItems(names.toArray(new String[0]), (d, w) -> {
                    if (w < ok.size()) open(ok.get(w).id);
                    else newPack(all);
                })
                .setOnCancelListener(d -> finish())
                .show();
    }

    private void newPack(List<PackStore.Pack> all) {
        EditText name = new EditText(this);
        name.setHint("Nombre del paquete");
        new AlertDialog.Builder(this).setTitle("Nuevo paquete").setView(name)
                .setPositiveButton("Crear", (d, w) -> {
                    PackStore.Pack p = new PackStore.Pack();
                    p.id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                    String n = name.getText().toString().trim();
                    p.name = n.isEmpty() ? "Mis stickers" : n;
                    String a = getSharedPreferences("p", 0).getString("author", "");
                    p.publisher = a.isEmpty() ? "Yo" : a;
                    p.animated = moving;
                    all.add(p);
                    PackStore.save(this, all);
                    open(p.id);
                })
                .setOnCancelListener(x -> finish())
                .setNegativeButton("Cancelar", (x, y) -> finish()).show();
    }

    private void open(String packId) {
        startActivity(new Intent(this, EditorActivity.class).setData(Uri.fromFile(file)).putExtra("id", packId));
        finish();
    }

    private void linkHelp(String text) {
        boolean ig = text != null && text.contains("instagram.com");
        String msg = ig
                ? "Instagram solo comparte el enlace, no la imagen.\n\n"
                + "• Imagen o comentario: haz una captura (o captura parcial con 3 dedos) y compártela a StickerForge.\n"
                + "• Reel: usa \"Descargar\" en Instagram (si está disponible) o grabación de pantalla, y compártelo aquí.\n"
                + "• GIF de un comentario: búscalo en GIPHY desde la app."
                : "Comparte una imagen, GIF o video para convertirlo en sticker.";
        AlertDialog.Builder bld = new AlertDialog.Builder(this).setTitle("Hacer sticker").setMessage(msg)
                .setPositiveButton("Entendido", (d, w) -> finish())
                .setOnCancelListener(d -> finish());
        if (ig) {
            bld.setNeutralButton("Abrir en Instagram", (d, w) -> {
                try {
                    String url = text.substring(text.indexOf("http")).split("\\s")[0];
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
                finish();
            });
        }
        bld.show();
    }
}
