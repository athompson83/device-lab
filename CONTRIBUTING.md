# Contributing to Device Lab

Thanks for your interest! Device Lab aims to stay **small, readable, and
dependency-light** — the entire frontend is vanilla JS on purpose, and the
backend is four files. Please keep contributions in that spirit.

## Getting set up

1. Prerequisites: Node ≥ 18, Android SDK (platform-tools + emulator + build-tools
   + one AVD), JDK 17, git. See the [README](README.md#quick-start).
2. `npm install && npm start`, open http://localhost:4830.
3. Smoke test: add `testapp/probe.apk` via the **APK** tab → *Install APK* →
   tap around → hit 💥 → confirm the crash toast fires → file a bug → export.

## Making changes

- **No new runtime dependencies** without discussion in an issue first.
- **No frontend framework/build step** — vanilla JS, one CSS file.
- Match the existing style: small modules, plain functions, comments only where
  the code can't speak for itself.
- If you touch the adb/emulator layer (`lib/android.js`), test against a real
  AVD — the probe app exercises tap, swipe, text, keys, logcat, and crash paths.
- Rebuild the probe app with `bash testapp/build.sh` if you change it
  (no Gradle needed, just SDK build-tools).

## Pull requests

- One focused change per PR.
- Describe what you tested and on which host OS / AVD.
- Screenshots for UI changes, please.

## Reporting bugs

Use the bug report template. The most useful thing you can include is the
server console output plus what `GET /api/device` returns.

## Roadmap / good first issues

Check the [open issues](https://github.com/athompson83/device-lab/issues) —
roadmap items are filed there. Cross-platform host support (macOS/Linux paths
in `lib/android.js` and `lib/projects.js`) is a great first contribution.
