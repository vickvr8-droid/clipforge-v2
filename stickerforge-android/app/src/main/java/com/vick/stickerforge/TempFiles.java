package com.vick.stickerforge;

import android.content.Context;
import android.net.Uri;

import java.io.File;

/** Copias temporales (compartidos, GIPHY) que se borran apenas dejan de hacer falta. */
class TempFiles {
    static boolean isTemp(Context c, Uri uri) {
        if (uri == null || !"file".equals(uri.getScheme()) || uri.getPath() == null) return false;
        File f = new File(uri.getPath());
        return c.getCacheDir().equals(f.getParentFile())
                && (f.getName().startsWith("share_") || f.getName().startsWith("giphy_"));
    }

    static void delete(Context c, Uri uri) {
        if (isTemp(c, uri)) new File(uri.getPath()).delete();
    }

    /** Limpia restos de sesiones anteriores (por ejemplo si la app se cerró a la fuerza). */
    static void cleanOld(Context c) {
        File[] fs = c.getCacheDir().listFiles();
        if (fs == null) return;
        long limit = System.currentTimeMillis() - 60 * 60 * 1000;
        for (File f : fs) {
            if ((f.getName().startsWith("share_") || f.getName().startsWith("giphy_")) && f.lastModified() < limit) f.delete();
        }
    }
}
