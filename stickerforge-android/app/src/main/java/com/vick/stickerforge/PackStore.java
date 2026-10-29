package com.vick.stickerforge;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/** Guarda los paquetes en filesDir/packs.json y los archivos en filesDir/packs/<id>/. */
public class PackStore {
    public static class Sticker {
        public String file;
        public String emoji;
    }

    public static class Pack {
        public String id, name, publisher;
        public boolean animated;
        public int version = 1;
        public List<Sticker> stickers = new ArrayList<>();
    }

    private static File index(Context c) {
        return new File(c.getFilesDir(), "packs.json");
    }

    public static File packDir(Context c, String id) {
        File d = new File(c.getFilesDir(), "packs/" + id);
        d.mkdirs();
        return d;
    }

    public static synchronized List<Pack> load(Context c) {
        List<Pack> out = new ArrayList<>();
        try {
            File f = index(c);
            if (!f.exists()) return out;
            JSONArray arr = new JSONArray(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Pack p = new Pack();
                p.id = o.getString("id");
                p.name = o.getString("name");
                p.publisher = o.getString("publisher");
                p.animated = o.getBoolean("animated");
                p.version = o.optInt("version", 1);
                JSONArray st = o.getJSONArray("stickers");
                for (int j = 0; j < st.length(); j++) {
                    Sticker s = new Sticker();
                    s.file = st.getJSONObject(j).getString("file");
                    s.emoji = st.getJSONObject(j).optString("emoji", "😀");
                    p.stickers.add(s);
                }
                out.add(p);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return out;
    }

    public static synchronized void save(Context c, List<Pack> packs) {
        try {
            JSONArray arr = new JSONArray();
            for (Pack p : packs) {
                JSONObject o = new JSONObject();
                o.put("id", p.id);
                o.put("name", p.name);
                o.put("publisher", p.publisher);
                o.put("animated", p.animated);
                o.put("version", p.version);
                JSONArray st = new JSONArray();
                for (Sticker s : p.stickers) {
                    st.put(new JSONObject().put("file", s.file).put("emoji", s.emoji));
                }
                o.put("stickers", st);
                arr.put(o);
            }
            try (FileOutputStream fo = new FileOutputStream(index(c))) {
                fo.write(arr.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static Pack find(List<Pack> packs, String id) {
        for (Pack p : packs) if (p.id.equals(id)) return p;
        return null;
    }

    /** Regenera el icono de bandeja (96x96 PNG) a partir del primer sticker. */
    public static void updateTray(Context c, Pack p) {
        File tray = new File(packDir(c, p.id), "tray.png");
        if (p.stickers.isEmpty()) {
            tray.delete();
            return;
        }
        try {
            File first = new File(packDir(c, p.id), p.stickers.get(0).file);
            Bitmap b = ImageDecoder.decodeBitmap(ImageDecoder.createSource(first),
                    (dec, info, src) -> dec.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE));
            Bitmap small = Bitmap.createScaledBitmap(b, 96, 96, true);
            try (FileOutputStream fo = new FileOutputStream(tray)) {
                small.compress(Bitmap.CompressFormat.PNG, 100, fo);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
