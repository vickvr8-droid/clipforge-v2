package com.vick.stickerforge;

import static org.junit.Assert.*;

import android.graphics.Bitmap;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class StickerMakerTest {
    @Test
    public void croppedSourceKeepsResolution() {
        // 9:16 centrado sobre un video 1920x1080 → 607x1080 aprox., luego máx 1024
        StickerMaker.FrameSource s = new StickerMaker.CroppedSource(new TestUtil.FakeVideo(1920, 1080, 5000),
                new float[]{0.342f, 0f, 0.658f, 1f});
        Bitmap b = s.frameAt(0);
        assertEquals(1024, b.getHeight());
        assertEquals(1024 * 0.316f * 1920 / 1080, b.getWidth(), 6);
    }

    @Test
    public void animatedFromHdVideoFitsWhatsApp() throws Exception {
        EditState st = new EditState();
        st.baseW = 1024;
        st.baseH = 1024;
        st.fit(true);
        StickerMaker.FrameSource src = new StickerMaker.CroppedSource(new TestUtil.FakeVideo(1920, 1080, 10000),
                new float[]{0.2f, 0f, 0.7625f, 1f});
        StringBuilder log = new StringBuilder();
        byte[] w = StickerMaker.makeAnimated(src, 1000, 4000, 12, st, m -> log.append(m).append('\n'));
        assertNotNull("no cupo:\n" + log, w);
        TestUtil.write("anim_video_12fps.webp", w);
        assertTrue("pesa " + w.length, w.length <= WebPEncoder.MAX_ANIMATED);
    }

    @Test
    public void longClipNeverExceedsTenSeconds() throws Exception {
        EditState st = new EditState();
        st.baseW = 640;
        st.baseH = 360;
        st.fit(false);
        byte[] w = StickerMaker.makeAnimated(new TestUtil.FakeVideo(640, 360, 20000), 0, 8000, 20, st, m -> { });
        assertNotNull(w);
        TestUtil.write("anim_long_20fps.webp", w);
        assertTrue(w.length <= WebPEncoder.MAX_ANIMATED);
    }
}
