package com.vick.stickerforge;

import android.content.Context;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.TextView;

class Ui {
    static int dp(Context c, float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics());
    }

    static Button button(Context c, String text) {
        Button b = new Button(c);
        b.setText(text);
        b.setAllCaps(false);
        return b;
    }

    static TextView label(Context c, String text) {
        TextView t = new TextView(c);
        t.setText(text);
        t.setPadding(0, dp(c, 10), 0, dp(c, 2));
        return t;
    }
}
