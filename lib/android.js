// Android SDK integration: adb, emulator, screen streaming, input, logcat.
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SDK = process.env.ANDROID_HOME || path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const ADB = path.join(SDK, 'platform-tools', 'adb.exe');
const EMULATOR = path.join(SDK, 'emulator', 'emulator.exe');

// newest installed build-tools gives us aapt2 for reading APK metadata
function aapt2Path() {
  const dir = path.join(SDK, 'build-tools');
  const versions = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  return versions.length ? path.join(dir, versions[versions.length - 1], 'aapt2.exe') : null;
}

const run = (exe, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(exe, args, { maxBuffer: 32 * 1024 * 1024, timeout: 60000, ...opts },
    (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout));
});

const adb = (...args) => run(ADB, args);

async function listAvds() {
  const out = await run(EMULATOR, ['-list-avds']);
  return out.split(/\r?\n/).map(s => s.trim())
    .filter(s => s && !s.startsWith('INFO') && !s.startsWith('WARNING'));
}

async function listDevices() {
  const out = await adb('devices', '-l');
  return out.split(/\r?\n/).slice(1)
    .filter(l => l.trim() && !l.startsWith('*'))
    .map(l => {
      const [serial, state, ...rest] = l.trim().split(/\s+/);
      const model = (rest.find(r => r.startsWith('model:')) || '').replace('model:', '');
      return { serial, state, model };
    });
}

function startEmulator(avd) {
  const child = spawn(EMULATOR, ['-avd', avd, '-no-snapshot-save', '-no-boot-anim', '-gpu', 'auto'],
    { detached: true, stdio: 'ignore' });
  child.unref();
}

async function bootCompleted() {
  try {
    const out = await adb('shell', 'getprop', 'sys.boot_completed');
    return out.trim() === '1';
  } catch { return false; }
}

async function deviceInfo() {
  const props = await adb('shell', 'getprop');
  const get = k => (props.match(new RegExp(`\\[${k}\\]: \\[(.*?)\\]`)) || [])[1] || '';
  let resolution = '';
  try { resolution = ((await adb('shell', 'wm', 'size')).match(/(\d+x\d+)/) || [])[1] || ''; } catch {}
  return {
    model: get('ro.product.model'),
    android: get('ro.build.version.release'),
    sdk: get('ro.build.version.sdk'),
    resolution,
  };
}

// --- screen ---------------------------------------------------------------

function screencap() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const p = spawn(ADB, ['exec-out', 'screencap', '-p']);
    p.stdout.on('data', c => chunks.push(c));
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`screencap exit ${code}`)));
    setTimeout(() => { p.kill(); reject(new Error('screencap timeout')); }, 8000).unref();
  });
}

async function screenSize() {
  const out = await adb('shell', 'wm', 'size');
  const m = out.match(/(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 };
}

// --- input ----------------------------------------------------------------

const KEYCODES = { back: 4, home: 3, recents: 187, power: 26, volup: 24, voldown: 25, enter: 66, del: 67 };

async function inputTap(x, y) { await adb('shell', 'input', 'tap', String(x), String(y)); }
async function inputSwipe(x1, y1, x2, y2, ms) {
  await adb('shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms));
}
async function inputKey(name) {
  const code = KEYCODES[name];
  if (code) await adb('shell', 'input', 'keyevent', String(code));
}
async function inputText(text) {
  // adb input text needs spaces as %s and shell metachars escaped
  const safe = text.replace(/[^a-zA-Z0-9 .,@_\-]/g, '').replace(/ /g, '%s');
  if (safe) await adb('shell', 'input', 'text', safe);
}

// --- app install / launch -------------------------------------------------

async function apkBadging(apkPath) {
  const aapt2 = aapt2Path();
  if (!aapt2) throw new Error('No build-tools/aapt2 found in Android SDK');
  const out = await run(aapt2, ['dump', 'badging', apkPath]);
  return {
    package: (out.match(/package: name='([^']+)'/) || [])[1],
    label: (out.match(/application-label:'([^']+)'/) || [])[1],
    versionName: (out.match(/versionName='([^']+)'/) || [])[1],
    launchable: (out.match(/launchable-activity: name='([^']+)'/) || [])[1],
  };
}

async function installApk(apkPath) {
  const out = await run(ADB, ['install', '-r', '-t', apkPath], { timeout: 180000 });
  if (!/Success/i.test(out)) throw new Error(out);
}

async function launchApp(pkg, activity) {
  if (activity) await adb('shell', 'am', 'start', '-n', `${pkg}/${activity}`);
  else await adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
}

async function stopApp(pkg) { await adb('shell', 'am', 'force-stop', pkg); }

// --- logcat ---------------------------------------------------------------

function streamLogcat(onLine) {
  const p = spawn(ADB, ['logcat', '-v', 'threadtime', '-T', '1']);
  let buf = '';
  p.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) if (line.trim()) onLine(line);
  });
  return () => p.kill();
}

module.exports = {
  SDK, ADB, listAvds, listDevices, startEmulator, bootCompleted, deviceInfo,
  screencap, screenSize, inputTap, inputSwipe, inputKey, inputText,
  apkBadging, installApk, launchApp, stopApp, streamLogcat, adb,
};
