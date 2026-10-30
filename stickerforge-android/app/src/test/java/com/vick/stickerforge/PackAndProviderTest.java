package com.vick.stickerforge;

import static org.junit.Assert.*;

import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PackAndProviderTest {
    private Context ctx;
    private static final String BASE = "content://" + StickerContentProvider.AUTHORITY;

    @Before
    public void setUp() throws Exception {
        ctx = RuntimeEnvironment.getApplication();
        Robolectric.setupContentProvider(StickerContentProvider.class, StickerContentProvider.AUTHORITY);
        PackStore.Pack p = new PackStore.Pack();
        p.id = "abc123";
        p.name = "Mis gatos";
        p.publisher = "Vick";
        p.animated = true;
        p.version = 7;
        for (int i = 0; i < 3; i++) {
            Bitmap b = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888);
            b.eraseColor(Color.rgb(50 * i, 100, 200));
            List<Bitmap> fr = new ArrayList<>();
            fr.add(b);
            fr.add(b);
            byte[] w = WebPEncoder.encodeAnimated(fr, 100, 70, WebPEncoder.MAX_ANIMATED);
            String name = "s" + i + ".webp";
            try (FileOutputStream fo = new FileOutputStream(new File(PackStore.packDir(ctx, p.id), name))) {
                fo.write(w);
            }
            PackStore.Sticker s = new PackStore.Sticker();
            s.file = name;
            s.emoji = "😀,🔥";
            p.stickers.add(s);
        }
        List<PackStore.Pack> all = new ArrayList<>();
        all.add(p);
        PackStore.save(ctx, all);
        PackStore.updateTray(ctx, p);
    }

    @Test
    public void storeRoundTrip() {
        PackStore.Pack p = PackStore.find(PackStore.load(ctx), "abc123");
        assertNotNull(p);
        assertEquals("Mis gatos", p.name);
        assertTrue(p.animated);
        assertEquals(7, p.version);
        assertEquals(3, p.stickers.size());
        assertEquals("😀,🔥", p.stickers.get(0).emoji);
    }

    @Test
    public void trayIs96PngUnder50KB() {
        File tray = new File(PackStore.packDir(ctx, "abc123"), "tray.png");
        assertTrue(tray.exists());
        assertTrue(tray.length() < 50 * 1024);
        Bitmap b = BitmapFactory.decodeFile(tray.getPath());
        assertEquals(96, b.getWidth());
        assertEquals(96, b.getHeight());
    }

    @Test
    public void metadataQueryHasWhatsAppColumns() {
        ContentResolver cr = ctx.getContentResolver();
        try (Cursor c = cr.query(Uri.parse(BASE + "/metadata"), null, null, null, null)) {
            assertEquals(1, c.getCount());
            c.moveToFirst();
            assertEquals("abc123", c.getString(c.getColumnIndexOrThrow("sticker_pack_identifier")));
            assertEquals("Mis gatos", c.getString(c.getColumnIndexOrThrow("sticker_pack_name")));
            assertEquals("Vick", c.getString(c.getColumnIndexOrThrow("sticker_pack_publisher")));
            assertEquals("tray.png", c.getString(c.getColumnIndexOrThrow("sticker_pack_icon")));
            assertEquals("7", c.getString(c.getColumnIndexOrThrow("image_data_version")));
            assertEquals(1, c.getInt(c.getColumnIndexOrThrow("animated_sticker_pack")));
            assertEquals(0, c.getInt(c.getColumnIndexOrThrow("whatsapp_will_not_cache_stickers")));
        }
        try (Cursor c = cr.query(Uri.parse(BASE + "/metadata/abc123"), null, null, null, null)) {
            assertEquals(1, c.getCount());
        }
        try (Cursor c = cr.query(Uri.parse(BASE + "/metadata/nope"), null, null, null, null)) {
            assertEquals(0, c.getCount());
        }
    }

    @Test
    public void stickersQueryAndAssets() throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        try (Cursor c = cr.query(Uri.parse(BASE + "/stickers/abc123"), null, null, null, null)) {
            assertEquals(3, c.getCount());
            c.moveToFirst();
            assertEquals("s0.webp", c.getString(c.getColumnIndexOrThrow("sticker_file_name")));
            assertEquals("😀,🔥", c.getString(c.getColumnIndexOrThrow("sticker_emoji")));
        }
        try (AssetFileDescriptor fd = cr.openAssetFileDescriptor(Uri.parse(BASE + "/stickers_asset/abc123/s1.webp"), "r")) {
            assertNotNull(fd);
        }
        try (AssetFileDescriptor fd = cr.openAssetFileDescriptor(Uri.parse(BASE + "/stickers_asset/abc123/tray.png"), "r")) {
            assertNotNull(fd);
        }
        assertEquals("image/webp", cr.getType(Uri.parse(BASE + "/stickers_asset/abc123/s1.webp")));
        assertEquals("image/png", cr.getType(Uri.parse(BASE + "/stickers_asset/abc123/tray.png")));
    }

    @Test
    public void pathTraversalBlocked() {
        String[] bad = {"/stickers_asset/abc123/..%2F..%2Fpacks.json", "/stickers_asset/..%2F..%2Fx/s1.webp",
                "/stickers_asset/abc123/packs.json"};
        for (String b : bad) {
            try {
                ctx.getContentResolver().openAssetFileDescriptor(Uri.parse(BASE + b), "r");
                fail("debió bloquear " + b);
            } catch (FileNotFoundException | SecurityException expected) {
            }
        }
    }

    @Test
    public void emojiCleaning() {
        assertEquals("😀,😂,🔥", EditorActivity.cleanEmojis("😀😂🔥🎉"));
        assertEquals("😀", EditorActivity.cleanEmojis("   "));
        assertEquals("👍🏽,❤️", EditorActivity.cleanEmojis("👍🏽 ❤️"));
        assertEquals("😀,😂", EditorActivity.cleanEmojis("😀, 😂"));
    }
}
