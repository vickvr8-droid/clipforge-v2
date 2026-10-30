package com.vick.stickerforge;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/** Proveedor que WhatsApp consulta para leer los paquetes (formato del SDK oficial de stickers). */
public class StickerContentProvider extends ContentProvider {
    public static final String AUTHORITY = "com.vick.stickerforge.stickercontentprovider";

    private static final int METADATA = 1, METADATA_SINGLE = 2, STICKERS = 3, ASSET = 4;
    private static final UriMatcher MATCHER = new UriMatcher(UriMatcher.NO_MATCH);

    static {
        MATCHER.addURI(AUTHORITY, "metadata", METADATA);
        MATCHER.addURI(AUTHORITY, "metadata/*", METADATA_SINGLE);
        MATCHER.addURI(AUTHORITY, "stickers/*", STICKERS);
        MATCHER.addURI(AUTHORITY, "stickers_asset/*/*", ASSET);
    }

    private static final String[] PACK_COLUMNS = {
            "sticker_pack_identifier", "sticker_pack_name", "sticker_pack_publisher",
            "sticker_pack_icon", "android_play_store_link", "ios_app_download_link",
            "sticker_pack_publisher_email", "sticker_pack_publisher_website",
            "sticker_pack_privacy_policy_website", "sticker_pack_license_agreement_website",
            "image_data_version", "whatsapp_will_not_cache_stickers", "animated_sticker_pack"};

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        List<PackStore.Pack> packs = PackStore.load(getContext());
        switch (MATCHER.match(uri)) {
            case METADATA: {
                MatrixCursor c = new MatrixCursor(PACK_COLUMNS);
                for (PackStore.Pack p : packs) addPack(c, p);
                return c;
            }
            case METADATA_SINGLE: {
                MatrixCursor c = new MatrixCursor(PACK_COLUMNS);
                PackStore.Pack p = PackStore.find(packs, uri.getLastPathSegment());
                if (p != null) addPack(c, p);
                return c;
            }
            case STICKERS: {
                MatrixCursor c = new MatrixCursor(new String[]{
                        "sticker_file_name", "sticker_emoji", "sticker_accessibility_text"});
                PackStore.Pack p = PackStore.find(packs, uri.getLastPathSegment());
                if (p != null) {
                    for (PackStore.Sticker s : p.stickers) c.addRow(new Object[]{s.file, s.emoji, ""});
                }
                return c;
            }
            default:
                throw new IllegalArgumentException("URI desconocida: " + uri);
        }
    }

    private void addPack(MatrixCursor c, PackStore.Pack p) {
        c.addRow(new Object[]{p.id, p.name, p.publisher, "tray.png", "", "", "", "", "", "",
                String.valueOf(p.version), 0, p.animated ? 1 : 0});
    }

    @Override
    public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        if (MATCHER.match(uri) != ASSET) throw new FileNotFoundException(uri.toString());
        List<String> seg = uri.getPathSegments();
        String id = seg.get(seg.size() - 2), name = seg.get(seg.size() - 1);
        if (!id.matches("[A-Za-z0-9_-]+") || !name.matches("[A-Za-z0-9_-]+\\.(webp|png)")) {
            throw new FileNotFoundException(name);
        }
        File f = new File(PackStore.packDir(getContext(), id), name);
        return new AssetFileDescriptor(ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY),
                0, AssetFileDescriptor.UNKNOWN_LENGTH);
    }

    @Override
    public String getType(Uri uri) {
        switch (MATCHER.match(uri)) {
            case METADATA: return "vnd.android.cursor.dir/vnd." + AUTHORITY + ".metadata";
            case METADATA_SINGLE: return "vnd.android.cursor.item/vnd." + AUTHORITY + ".metadata";
            case STICKERS: return "vnd.android.cursor.dir/vnd." + AUTHORITY + ".stickers";
            case ASSET: return uri.getLastPathSegment().endsWith(".png") ? "image/png" : "image/webp";
            default: return null;
        }
    }

    @Override public Uri insert(Uri uri, ContentValues v) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
