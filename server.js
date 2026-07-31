// Device Lab — run and test native mobile apps on a PC.
//   Android: local emulator via Android SDK (build, install, interact, logcat)
//   iOS:     Appetize.io cloud simulators (real iOS on Apple hardware, streamed)
// Bug tracker with evidence capture (screenshot + logcat + device info) and
// export to Markdown / JSON / CSV / ZIP.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const archiver = require('archiver');

const android = require('./lib/android');
const projects = require('./lib/projects');
const bugs = require('./lib/bugs');

const PORT = 4830;
const DATA = path.join(__dirname, 'data');
const SETTINGS = path.join(DATA, 'settings.json');
const UPLOADS = path.join(DATA, 'uploads');
// fresh clones have no data/ or workspace/ — create everything we write into
for (const d of [UPLOADS, path.join(DATA, 'screenshots'), path.join(__dirname, 'workspace')]) {
  fs.mkdirSync(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(path.join(DATA, 'screenshots')));
const upload = multer({ dest: UPLOADS, limits: { fileSize: 500 * 1024 * 1024 } });

const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const saveSettings = s => fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------
const state = {
  currentApp: null,          // { package, label, versionName, launchable, apk }
  currentProject: null,
  building: false,
  logcatRing: [],            // last 400 logcat lines for bug evidence
  lastCrashAt: 0,
};

// ---------------------------------------------------------------------------
// WebSocket: screen frames (binary) + events (JSON)
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const broadcast = obj => {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
};

let screenTimer = null;
let deviceSize = null;

async function screenLoop() {
  if (!wss.clients.size) return;                    // nobody watching
  try {
    const png = await android.screencap();
    for (const c of wss.clients) if (c.readyState === 1) c.send(png, { binary: true });
  } catch { /* device offline — status loop reports it */ }
}

function ensureScreenLoop() {
  if (!screenTimer) screenTimer = setInterval(screenLoop, 700);
}

wss.on('connection', ws => {
  ensureScreenLoop();
  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try {
      if (!deviceSize) deviceSize = await android.screenSize().catch(() => null);
      const px = v => Math.round(v * (deviceSize?.w || 1080));
      const py = v => Math.round(v * (deviceSize?.h || 2400));
      if (m.t === 'tap') await android.inputTap(px(m.x), py(m.y));
      else if (m.t === 'swipe') await android.inputSwipe(px(m.x1), py(m.y1), px(m.x2), py(m.y2), m.ms || 300);
      else if (m.t === 'key') await android.inputKey(m.name);
      else if (m.t === 'text') await android.inputText(m.value || '');
    } catch (e) {
      ws.send(JSON.stringify({ t: 'error', msg: String(e.message || e) }));
    }
  });
});

// Logcat: stream continuously, keep a ring buffer, detect crashes.
const CRASH_RE = /FATAL EXCEPTION|ANR in |Force finishing activity|beginning of crash/;
android.streamLogcat(line => {
  state.logcatRing.push(line);
  if (state.logcatRing.length > 400) state.logcatRing.shift();
  broadcast({ t: 'logcat', line });
  if (CRASH_RE.test(line) && Date.now() - state.lastCrashAt > 5000) {
    state.lastCrashAt = Date.now();
    broadcast({ t: 'crash', line, tail: state.logcatRing.slice(-40) });
  }
});

// ---------------------------------------------------------------------------
// Emulator / device
// ---------------------------------------------------------------------------
app.get('/api/device', async (req, res) => {
  try {
    const [avds, devices] = await Promise.all([android.listAvds(), android.listDevices()]);
    const online = devices.some(d => d.state === 'device');
    const booted = online && await android.bootCompleted();
    const info = booted ? await android.deviceInfo() : null;
    if (booted && !deviceSize) deviceSize = await android.screenSize().catch(() => null);
    res.json({ avds, devices, online, booted, info, currentApp: state.currentApp, building: state.building });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/device/start', (req, res) => {
  const { avd } = req.body || {};
  if (!avd) return res.status(400).json({ error: 'avd required' });
  android.startEmulator(avd);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Projects & builds
// ---------------------------------------------------------------------------
app.get('/api/projects', (req, res) => res.json(projects.load()));

app.post('/api/projects', async (req, res) => {
  try { res.json(await projects.addProject(req.body)); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.post('/api/projects/upload-apk', upload.single('apk'), (req, res) => {
  try {
    const dest = path.join(UPLOADS, req.file.originalname.replace(/[^\w.-]/g, '_'));
    fs.renameSync(req.file.path, dest);
    projects.addProject({ source: 'apk', location: dest }).then(p => res.json(p));
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.delete('/api/projects/:id', (req, res) => { projects.removeProject(req.params.id); res.json({ ok: true }); });

app.post('/api/projects/:id/build', async (req, res) => {
  const project = projects.load().find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  if (state.building) return res.status(409).json({ error: 'a build is already running' });
  state.building = true;
  res.json({ ok: true, streaming: true });          // progress arrives over WS
  try {
    const apk = await projects.buildProject(project, line => broadcast({ t: 'build', line }));
    broadcast({ t: 'build', line: `APK: ${apk}` });
    await deployApk(apk, project);
    broadcast({ t: 'buildDone', apk, app: state.currentApp });
  } catch (e) {
    broadcast({ t: 'buildError', msg: String(e.message || e) });
  } finally { state.building = false; }
});

async function deployApk(apkPath, project) {
  broadcast({ t: 'build', line: 'Reading APK metadata…' });
  const badging = await android.apkBadging(apkPath);
  broadcast({ t: 'build', line: `Installing ${badging.package} to device…` });
  await android.installApk(apkPath);
  if (project && (project.kind === 'expo' || project.kind === 'react-native')) {
    // debug builds load JS from Metro on the host — bridge the port
    await android.adb('reverse', 'tcp:8081', 'tcp:8081').catch(() => {});
    broadcast({ t: 'build', line: 'Bridged port 8081 (adb reverse) — run "npx expo start" / Metro in the project for debug builds.' });
  }
  broadcast({ t: 'build', line: 'Launching…' });
  await android.launchApp(badging.package, badging.launchable);
  state.currentApp = { ...badging, apk: apkPath };
  state.currentProject = project ? { id: project.id, name: project.name } : null;
}

app.post('/api/projects/:id/install', async (req, res) => {
  // direct install for apk projects or already-built projects
  const project = projects.load().find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  try {
    const apk = project.apk || projects.findApks(project.dir).filter(p => p.includes('debug'))[0]
      || projects.findApks(project.dir)[0];
    if (!apk) return res.status(400).json({ error: 'No APK found — build first' });
    await deployApk(apk, project);
    res.json({ ok: true, app: state.currentApp });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/app/relaunch', async (req, res) => {
  if (!state.currentApp) return res.status(400).json({ error: 'no app deployed' });
  await android.stopApp(state.currentApp.package);
  await android.launchApp(state.currentApp.package, state.currentApp.launchable);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Bugs
// ---------------------------------------------------------------------------
app.get('/api/bugs', (req, res) => res.json(bugs.load()));

app.post('/api/bugs', async (req, res) => {
  try {
    const fields = req.body || {};
    let shot = null, device = {}, appMeta = state.currentApp || {};
    if (fields.platform !== 'ios') {
      shot = await android.screencap().catch(() => null);
      device = await android.deviceInfo().catch(() => ({}));
    }
    const bug = bugs.createBug(fields, shot, state.logcatRing.slice(-200), device, appMeta);
    res.json(bug);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.patch('/api/bugs/:id', (req, res) => {
  try { res.json(bugs.updateBug(req.params.id, req.body || {})); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.delete('/api/bugs/:id', (req, res) => { bugs.deleteBug(req.params.id); res.json({ ok: true }); });

app.get('/api/bugs/export', (req, res) => {
  const format = req.query.format || 'md';
  if (format === 'zip') {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="bug-report.zip"');
    const zip = archiver('zip');
    zip.pipe(res);
    zip.append(bugs.exportBugs('md').body, { name: 'bug-report.md' });
    zip.append(bugs.exportBugs('json').body, { name: 'bug-report.json' });
    zip.append(bugs.exportBugs('csv').body, { name: 'bug-report.csv' });
    zip.directory(bugs.SHOTS, 'screenshots');
    zip.finalize();
    return;
  }
  const out = bugs.exportBugs(format);
  res.setHeader('Content-Type', out.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
  res.send(out.body);
});

// ---------------------------------------------------------------------------
// iOS lane — Appetize.io cloud simulators
// ---------------------------------------------------------------------------
app.get('/api/ios/config', (req, res) => {
  const s = loadSettings();
  res.json({ hasToken: !!s.appetizeToken, apps: s.iosApps || [] });
});

app.post('/api/ios/token', (req, res) => {
  const s = loadSettings();
  s.appetizeToken = (req.body || {}).token || '';
  saveSettings(s);
  res.json({ ok: true });
});

app.post('/api/ios/upload', upload.single('bundle'), async (req, res) => {
  const s = loadSettings();
  if (!s.appetizeToken) return res.status(400).json({ error: 'Set your Appetize API token first' });
  try {
    const form = new FormData();
    const buf = fs.readFileSync(req.file.path);
    form.append('file', new Blob([buf]), req.file.originalname);
    form.append('platform', 'ios');
    const r = await fetch('https://api.appetize.io/v1/apps', {
      method: 'POST',
      headers: { 'X-API-KEY': s.appetizeToken },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || `Appetize HTTP ${r.status}`);
    const entry = { publicKey: data.publicKey, name: req.file.originalname, uploadedAt: new Date().toISOString() };
    s.iosApps = [entry, ...(s.iosApps || []).filter(a => a.publicKey !== entry.publicKey)];
    saveSettings(s);
    res.json(entry);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  finally { fs.rmSync(req.file.path, { force: true }); }
});

// GitHub Actions workflow that builds an iOS simulator .app on a macOS runner.
app.get('/api/ios/workflow', (req, res) => {
  const scheme = (req.query.scheme || 'YourScheme').replace(/[^\w.-]/g, '');
  res.setHeader('Content-Type', 'text/yaml');
  res.setHeader('Content-Disposition', 'attachment; filename="ios-simulator-build.yml"');
  res.send(`# Builds an iOS simulator .app from this repo on a free macOS runner.
# Put this at .github/workflows/ios-simulator-build.yml
# Download the artifact zip, then upload it to Device Lab's iOS tab.
name: iOS simulator build
on: [push, workflow_dispatch]
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build for iOS Simulator
        run: |
          xcodebuild -scheme "${scheme}" \\
            -sdk iphonesimulator \\
            -configuration Debug \\
            -derivedDataPath build \\
            CODE_SIGNING_ALLOWED=NO build
      - name: Zip .app bundle
        run: |
          cd build/Build/Products/Debug-iphonesimulator
          zip -r "\${GITHUB_WORKSPACE}/app-simulator.zip" *.app
      - uses: actions/upload-artifact@v4
        with:
          name: ios-simulator-app
          path: app-simulator.zip
`);
});

server.listen(PORT, () => console.log(`Device Lab running at http://localhost:${PORT}`));
