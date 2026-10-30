package com.vick.stickerforge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.ImageDecoder;
import android.graphics.drawable.AnimatedImageDrawable;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.List;

public class PackActivity extends Activity {
    private static final int PICK = 1, ADD_WA = 2;
    private String id;
    private List<PackStore.Pack> packs;
    private PackStore.Pack pack;
    private GridView grid;
    private TextView info;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        id = getIntent().getStringExtra("id");
        int pad = Ui.dp(this, 12);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        info = new TextView(this);
        root.addView(info);
        Button add = Ui.button(this, "+ Agregar sticker");
        add.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("¿De dónde?")
                .setItems(new String[]{"📁 Galería / archivos", "🔎 Buscar en GIPHY"}, (d, w) -> {
                    if (w == 0) pick();
                    else if (pack.stickers.size() >= 30) Toast.makeText(this, "Máximo 30 stickers por paquete", Toast.LENGTH_LONG).show();
                    else startActivity(new Intent(this, GiphyActivity.class).putExtra("id", id));
                }).show());
        root.addView(add);
        grid = new GridView(this);
        grid.setNumColumns(3);
        grid.setVerticalSpacing(pad);
        grid.setHorizontalSpacing(pad);
        root.addView(grid, new LinearLayout.LayoutParams(-1, 0, 1));
        Button wa = Ui.button(this, "Añadir a WhatsApp");
        wa.setOnClickListener(v -> addToWhatsApp());
        root.addView(wa);
        grid.setOnItemLongClickListener((p, v, pos, i) -> {
            new AlertDialog.Builder(this).setTitle("¿Borrar este sticker?")
                    .setPositiveButton("Borrar", (d, w) -> {
                        PackStore.Sticker s = pack.stickers.remove(pos);
                        new File(PackStore.packDir(this, id), s.file).delete();
                        pack.version++;
                        PackStore.updateTray(this, pack);
                        PackStore.save(this, packs);
                        refresh();
                    }).setNegativeButton("Cancelar", null).show();
            return true;
        });
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        packs = PackStore.load(this);
        pack = PackStore.find(packs, id);
        if (pack == null) {
            finish();
            return;
        }
        setTitle(pack.name);
        info.setText((pack.animated ? "Paquete animado" : "Paquete estático") + " · "
                + pack.stickers.size() + "/30 stickers (mínimo 3). Mantén presionado para borrar.");
        grid.setAdapter(new BaseAdapter() {
            public int getCount() { return pack.stickers.size(); }
            public Object getItem(int i) { return pack.stickers.get(i); }
            public long getItemId(int i) { return i; }

            public View getView(int i, View v, ViewGroup parent) {
                ImageView iv = new ImageView(PackActivity.this);
                int s = Ui.dp(PackActivity.this, 100);
                iv.setLayoutParams(new GridView.LayoutParams(-1, s));
                iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
                iv.setBackgroundColor(0x22FFFFFF);
                try {
                    File f = new File(PackStore.packDir(PackActivity.this, id), pack.stickers.get(i).file);
                    Drawable d = ImageDecoder.decodeDrawable(ImageDecoder.createSource(f));
                    iv.setImageDrawable(d);
                    if (d instanceof AnimatedImageDrawable) ((AnimatedImageDrawable) d).start();
                } catch (Exception e) {
                    e.printStackTrace();
                }
                return iv;
            }
        });
    }

    private void pick() {
        if (pack.stickers.size() >= 30) {
            Toast.makeText(this, "Máximo 30 stickers por paquete", Toast.LENGTH_LONG).show();
            return;
        }
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        if (pack.animated) {
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        } else {
            i.setType("image/*");
        }
        startActivityForResult(Intent.createChooser(i, "Elige un archivo"), PICK);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK && res == RESULT_OK && data != null && data.getData() != null) {
            startActivity(new Intent(this, EditorActivity.class)
                    .setData(data.getData())
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .putExtra("id", id));
        } else if (req == ADD_WA && res == RESULT_CANCELED && data != null) {
            String err = data.getStringExtra("validation_error");
            if (err != null) {
                new AlertDialog.Builder(this).setTitle("WhatsApp rechazó el paquete")
                        .setMessage(err).setPositiveButton("OK", null).show();
            }
        }
    }

    private boolean installed(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void addToWhatsApp() {
        if (pack.stickers.size() < 3) {
            Toast.makeText(this, "WhatsApp pide al menos 3 stickers", Toast.LENGTH_LONG).show();
            return;
        }
        Intent i = new Intent("com.whatsapp.intent.action.ENABLE_STICKER_PACK");
        i.putExtra("sticker_pack_id", pack.id);
        i.putExtra("sticker_pack_authority", StickerContentProvider.AUTHORITY);
        i.putExtra("sticker_pack_name", pack.name);
        boolean wa = installed("com.whatsapp"), biz = installed("com.whatsapp.w4b");
        if (wa && !biz) i.setPackage("com.whatsapp");
        else if (biz && !wa) i.setPackage("com.whatsapp.w4b");
        try {
            startActivityForResult(i, ADD_WA);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No se encontró WhatsApp", Toast.LENGTH_LONG).show();
        }
    }
}
