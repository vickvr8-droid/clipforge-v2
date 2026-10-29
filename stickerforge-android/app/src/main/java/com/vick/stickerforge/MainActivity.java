package com.vick.stickerforge;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class MainActivity extends Activity {
    private ListView list;
    private List<PackStore.Pack> packs = new ArrayList<>();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("Mis paquetes de stickers");
        int pad = Ui.dp(this, 12);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        Button nuevo = Ui.button(this, "+ Nuevo paquete");
        nuevo.setOnClickListener(v -> newPackDialog());
        root.addView(nuevo);
        list = new ListView(this);
        root.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        list.setOnItemClickListener((p, v, pos, id) ->
                startActivity(new Intent(this, PackActivity.class).putExtra("id", packs.get(pos).id)));
        list.setOnItemLongClickListener((p, v, pos, id) -> {
            PackStore.Pack pk = packs.get(pos);
            new AlertDialog.Builder(this).setTitle("¿Borrar \"" + pk.name + "\"?")
                    .setPositiveButton("Borrar", (d, w) -> {
                        File dir = PackStore.packDir(this, pk.id);
                        File[] fs = dir.listFiles();
                        if (fs != null) for (File f : fs) f.delete();
                        dir.delete();
                        packs.remove(pos);
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
        List<String> rows = new ArrayList<>();
        for (PackStore.Pack p : packs) {
            rows.add(p.name + "\n" + (p.animated ? "🎞 Animado" : "🖼 Estático") + " · " + p.stickers.size() + " stickers");
        }
        list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, rows));
    }

    private void newPackDialog() {
        int pad = Ui.dp(this, 16);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(pad, pad, pad, 0);
        EditText name = new EditText(this);
        name.setHint("Nombre del paquete");
        EditText author = new EditText(this);
        author.setHint("Autor");
        author.setText(getSharedPreferences("p", 0).getString("author", ""));
        CheckBox anim = new CheckBox(this);
        anim.setText("Paquete animado (videos y GIF)");
        anim.setChecked(true);
        l.addView(name);
        l.addView(author);
        l.addView(anim);
        new AlertDialog.Builder(this).setTitle("Nuevo paquete").setView(l)
                .setPositiveButton("Crear", (d, w) -> {
                    String n = name.getText().toString().trim();
                    String a = author.getText().toString().trim();
                    if (n.isEmpty()) n = "Mis stickers";
                    if (a.isEmpty()) a = "Yo";
                    getSharedPreferences("p", 0).edit().putString("author", a).apply();
                    PackStore.Pack p = new PackStore.Pack();
                    p.id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                    p.name = n.length() > 120 ? n.substring(0, 120) : n;
                    p.publisher = a.length() > 120 ? a.substring(0, 120) : a;
                    p.animated = anim.isChecked();
                    packs.add(p);
                    PackStore.save(this, packs);
                    startActivity(new Intent(this, PackActivity.class).putExtra("id", p.id));
                }).setNegativeButton("Cancelar", null).show();
    }
}
