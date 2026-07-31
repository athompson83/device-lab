package com.devicelab.probe;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

// Deliberately exercises the Device Lab pipeline: taps, text input,
// toasts, logcat output, and an on-demand crash for testing crash capture.
public class MainActivity extends Activity {
    private int count = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 140, 48, 48);
        root.setBackgroundColor(Color.parseColor("#101423"));

        TextView title = new TextView(this);
        title.setText("🔬 Device Lab Probe");
        title.setTextSize(26);
        title.setTextColor(Color.WHITE);

        TextView counter = new TextView(this);
        counter.setText("Taps: 0");
        counter.setTextSize(20);
        counter.setTextColor(Color.parseColor("#5b8cff"));
        counter.setPadding(0, 32, 0, 16);

        Button inc = new Button(this);
        inc.setText("Tap me");
        inc.setOnClickListener(v -> {
            count++;
            counter.setText("Taps: " + count);
            Log.i("Probe", "Tap count=" + count);
        });

        EditText input = new EditText(this);
        input.setHint("Type here");
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);

        Button toast = new Button(this);
        toast.setText("Show toast");
        toast.setOnClickListener(v ->
            Toast.makeText(this, "Hello: " + input.getText(), Toast.LENGTH_SHORT).show());

        Button crash = new Button(this);
        crash.setText("Crash app 💥");
        crash.setOnClickListener(v -> {
            Log.e("Probe", "Crash button pressed — throwing");
            throw new RuntimeException("Deliberate test crash from Device Lab Probe");
        });

        root.addView(title);
        root.addView(counter);
        root.addView(inc);
        root.addView(input);
        root.addView(toast);
        root.addView(crash);
        setContentView(root);
    }
}
