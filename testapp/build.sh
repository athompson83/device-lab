#!/usr/bin/env bash
# Build probe.apk directly with Android SDK build-tools — no Gradle needed.
# Usage: bash build.sh   (from the testapp/ directory)
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort | tail -1)"
AJAR="$SDK/platforms/android-34/android.jar"
JBIN="${JAVA_HOME:+$JAVA_HOME/bin}"; JBIN="${JBIN:-$(dirname "$(command -v javac)")}"

# d8/apksigner are .bat wrappers on Windows
BAT=""; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) BAT=".bat";; esac

rm -rf classes dexout base.apk aligned.apk probe.apk
mkdir -p classes dexout

"$BT/aapt2" link -o base.apk --manifest AndroidManifest.xml -I "$AJAR"
"$JBIN/javac" --release 8 -encoding UTF-8 -Xlint:-options -cp "$AJAR" -d classes MainActivity.java
"$BT/d8$BAT" --lib "$AJAR" --release --output dexout classes/com/devicelab/probe/*.class
(cd dexout && "$JBIN/jar" -uf ../base.apk classes.dex)
"$BT/zipalign" -f 4 base.apk aligned.apk

[ -f debug.keystore ] || "$JBIN/keytool" -genkeypair -keystore debug.keystore -alias debug \
  -storepass android -keypass android -dname "CN=DeviceLab Debug" -keyalg RSA -keysize 2048 -validity 10000
"$BT/apksigner$BAT" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android \
  --out probe.apk aligned.apk

echo "Built $(du -h probe.apk | cut -f1) probe.apk"
