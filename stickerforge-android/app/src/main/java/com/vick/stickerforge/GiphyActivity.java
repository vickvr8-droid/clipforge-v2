package com.vick.stickerforge;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.graphics.ImageDecoder;
import android.graphics.drawable.AnimatedImageDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.method.LinkMovementMethod;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Busca GIFs y stickers en GIPHY y abre el elegido en el editor. */
@SuppressWarnings("deprecation")
public class GiphyActivity extends Activity {
    static class Item {
        String preview, gif, mp4;
    }

    private final List<Item> items = new ArrayList<>();
    private final Map<String, Drawable> cache = new HashMap<>();
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private EditText query;
    private RadioGroup kind;
    private GridView grid;
    private BaseAdapter adapter;
    private int searchId;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("Buscar en GIPHY");
        int pad = Ui.dp(this, 10);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        LinearLayout bar = new LinearLayout(this);
        query = new EditText(this);
        query.setHint("Buscar (ej: gato, risa, wow)");
        query.setSingleLine(true);
        query.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        query.setOnEditorActionListener((v, a, e) -> { search(); return true; });
        bar.addView(query, new LinearLayout.LayoutParams(0, -2, 1));
        Button go = Ui.button(this, "Buscar");
        go.setOnClickListener(v -> search());
        bar.addView(go);
        root.addView(bar);

        kind = new RadioGroup(this);
        kind.setOrientation(RadioGroup.HORIZONTAL);
        RadioButton st = new RadioButton(this);
        st.setText("Stickers (fondo transparente)");
        st.setId(1);
        RadioButton gf = new RadioButton(this);
        gf.setText("GIFs");
        gf.setId(2);
        kind.addView(st);
        kind.addView(gf);
        kind.check(1);
        kind.setOnCheckedChangeListener((g, i) -> search());
        root.addView(kind);

        grid = new GridView(this);
        grid.setNumColumns(3);
        grid.setVerticalSpacing(pad / 2);
        grid.setHorizontalSpacing(pad / 2);
        adapter = new BaseAdapter() {
            public int getCount() { return items.size(); }
            public Object getItem(int i) { return items.get(i); }
            public long getItemId(int i) { return i; }

            public View getView(int i, View v, ViewGroup p) {
                ImageView iv = v instanceof ImageView ? (ImageView) v : new ImageView(GiphyActivity.this);
                iv.setLayoutParams(new GridView.LayoutParams(-1, Ui.dp(GiphyActivity.this, 110)));
                iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
                iv.setBackgroundColor(0x22FFFFFF);
                String url = items.get(i).preview;
                iv.setTag(url);
                Drawable d = cache.get(url);
                iv.setImageDrawable(d);
                if (d == null) loadPreview(url, iv);
                return iv;
            }
        };
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((p, v, pos, id) -> pick(items.get(pos)));
        root.addView(grid, new LinearLayout.LayoutParams(-1, 0, 1));

        TextView powered = new TextView(this);
        powered.setText("Powered by GIPHY");
        powered.setTextSize(11);
        root.addView(powered);
        setContentView(root);

        if (key().isEmpty()) askKey();
        else search();
    }

    private String key() {
        return getSharedPreferences("p", 0).getString("giphy_key", "");
    }

    private void askKey() {
        int pad = Ui.dp(this, 16);
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(pad, pad, pad, 0);
        TextView t = new TextView(this);
        t.setText("GIPHY pide una clave gratuita (una sola vez):\n"
                + "1. Entra a developers.giphy.com y crea una cuenta.\n"
                + "2. \"Create an API Key\" → elige \"API\".\n"
                + "3. Copia la clave y pégala aquí.");
        t.setMovementMethod(LinkMovementMethod.getInstance());
        l.addView(t);
        EditText in = new EditText(this);
        in.setHint("Clave de API");
        in.setText(key());
        l.addView(in);
        new AlertDialog.Builder(this).setTitle("Clave de GIPHY").setView(l)
                .setPositiveButton("Guardar", (d, w) -> {
                    getSharedPreferences("p", 0).edit().putString("giphy_key", in.getText().toString().trim()).apply();
                    search();
                })
                .setNeutralButton("Abrir GIPHY", (d, w) ->
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://developers.giphy.com/dashboard/"))))
                .setNegativeButton("Cancelar", null).show();
    }

    private void search() {
        if (key().isEmpty()) {
            askKey();
            return;
        }
        final int id = ++searchId;
        String q = query.getText().toString().trim();
        String type = kind.getCheckedRadioButtonId() == 1 ? "stickers" : "gifs";
        String url;
        try {
            url = "https://api.giphy.com/v1/" + type + (q.isEmpty() ? "/trending?" : "/search?q=" + URLEncoder.encode(q, "UTF-8") + "&lang=es&")
                    + "limit=36&rating=pg-13&api_key=" + URLEncoder.encode(key(), "UTF-8");
        } catch (Exception e) {
            return;
        }
        pool.execute(() -> {
            try {
                JSONArray data = new JSONObject(new String(get(url), "UTF-8")).getJSONArray("data");
                List<Item> found = new ArrayList<>();
                for (int i = 0; i < data.length(); i++) {
                    JSONObject im = data.getJSONObject(i).getJSONObject("images");
                    Item it = new Item();
                    JSONObject prev = im.optJSONObject("fixed_width_small");
                    if (prev == null) prev = im.getJSONObject("fixed_width");
                    it.preview = prev.getString("url");
                    JSONObject orig = im.getJSONObject("original");
                    it.gif = orig.optString("url", null);
                    it.mp4 = orig.optString("mp4", null);
                    found.add(it);
                }
                runOnUiThread(() -> {
                    if (id != searchId) return;
                    items.clear();
                    items.addAll(found);
                    adapter.notifyDataSetChanged();
                    if (found.isEmpty()) Toast.makeText(this, "Sin resultados", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception e) {
                String msg = String.valueOf(e.getMessage());
                runOnUiThread(() -> {
                    if (msg.contains("401") || msg.contains("403")) {
                        Toast.makeText(this, "Clave de GIPHY no válida", Toast.LENGTH_LONG).show();
                        askKey();
                    } else {
                        Toast.makeText(this, "Error de red: " + msg, Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }

    private void loadPreview(String url, ImageView iv) {
        pool.execute(() -> {
            try {
                Drawable d = ImageDecoder.decodeDrawable(ImageDecoder.createSource(ByteBuffer.wrap(get(url))));
                runOnUiThread(() -> {
                    cache.put(url, d);
                    if (url.equals(iv.getTag())) {
                        iv.setImageDrawable(d);
                        if (d instanceof AnimatedImageDrawable) ((AnimatedImageDrawable) d).start();
                    }
                });
            } catch (Exception ignored) {
            }
        });
    }

    private void pick(Item it) {
        // Stickers: GIF original (conserva transparencia). GIFs: MP4 (más liviano y nítido).
        boolean sticker = kind.getCheckedRadioButtonId() == 1;
        String url = sticker || it.mp4 == null || it.mp4.isEmpty() ? it.gif : it.mp4;
        String ext = url.contains(".mp4") ? ".mp4" : ".gif";
        ProgressDialog pd = ProgressDialog.show(this, null, "Descargando…", true);
        pool.execute(() -> {
            try {
                File f = new File(getCacheDir(), "giphy_" + System.currentTimeMillis() + ext);
                try (FileOutputStream fo = new FileOutputStream(f)) {
                    fo.write(get(url));
                }
                runOnUiThread(() -> {
                    pd.dismiss();
                    startActivity(new Intent(this, EditorActivity.class)
                            .setData(Uri.fromFile(f))
                            .putExtra("id", getIntent().getStringExtra("id")));
                    finish();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    pd.dismiss();
                    Toast.makeText(this, "No se pudo descargar: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    static byte[] get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        int code = c.getResponseCode();
        if (code >= 400) throw new Exception("HTTP " + code);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return bo.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        pool.shutdownNow();
    }
}
