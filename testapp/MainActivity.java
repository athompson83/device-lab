package com.devicelab.probe;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

// Deliberately exercises the Device Lab pipeline: taps, text input, toasts,
// logcat output, and an on-demand crash for testing crash capture.
// Full-bleed layout: header at top, giant counter centered, controls at bottom.
public class MainActivity extends Activity {
    private int count = 0;

    private LinearLayout.LayoutParams lp(int h, float weight) {
        LinearLayout.LayoutParams p =
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, h, weight);
        p.setMargins(48, 12, 48, 12);
        return p;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.parseColor("#141a2e"), Color.parseColor("#0c101d") });
        root.setBackground(bg);

        TextView title = new TextView(this);
        title.setText("🔬 Device Lab Probe");
        title.setTextSize(24);
        title.setTextColor(Color.WHITE);
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 96, 0, 0);
        root.addView(title, lp(ViewGroup.LayoutParams.WRAP_CONTENT, 0));

        TextView subtitle = new TextView(this);
        subtitle.setText("Tap, type, toast, crash — watch Device Lab react");
        subtitle.setTextSize(13);
        subtitle.setTextColor(Color.parseColor("#8a90a5"));
        subtitle.setGravity(Gravity.CENTER);
        root.addView(subtitle, lp(ViewGroup.LayoutParams.WRAP_CONTENT, 0));

        // giant centered counter soaks up all free vertical space
        TextView counter = new TextView(this);
        counter.setText("0");
        counter.setTextSize(110);
        counter.setTextColor(Color.parseColor("#5b8cff"));
        counter.setTypeface(null, Typeface.BOLD);
        counter.setGravity(Gravity.CENTER);
        root.addView(counter, lp(0, 1f));

        Button inc = new Button(this);
        inc.setText("TAP ME");
        inc.setTextSize(16);
        inc.setOnClickListener(v -> {
            count++;
            counter.setText(String.valueOf(count));
            Log.i("Probe", "Tap count=" + count);
        });
        root.addView(inc, lp(150, 0));

        EditText input = new EditText(this);
        input.setHint("Type here…");
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        root.addView(input, lp(ViewGroup.LayoutParams.WRAP_CONTENT, 0));

        Button toast = new Button(this);
        toast.setText("SHOW TOAST");
        toast.setOnClickListener(v ->
            Toast.makeText(this, "Hello: " + input.getText(), Toast.LENGTH_SHORT).show());
        root.addView(toast, lp(130, 0));

        Button crash = new Button(this);
        crash.setText("CRASH APP 💥");
        crash.setOnClickListener(v -> {
            Log.e("Probe", "Crash button pressed — throwing");
            throw new RuntimeException("Deliberate test crash from Device Lab Probe");
        });
        LinearLayout.LayoutParams crashLp = lp(130, 0);
        crashLp.setMargins(48, 12, 48, 72);
        root.addView(crash, crashLp);

        setContentView(root);
    }
}
