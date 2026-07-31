// Project intake and build pipeline.
// Sources: local folder path, GitHub URL (shallow clone), or uploaded APK.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE = path.join(__dirname, '..', 'workspace');
const DB = path.join(__dirname, '..', 'data', 'projects.json');
const JAVA_HOME = process.env.JAVA_HOME || path.join(os.homedir(), '.codex', 'toolchains', 'temurin-17');

function load() { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } }
function save(list) { fs.writeFileSync(DB, JSON.stringify(list, null, 2)); }

// Classify what kind of mobile project a directory contains.
function detectKind(dir) {
  const has = p => fs.existsSync(path.join(dir, p));
  if (has('pubspec.yaml') && has('android')) return 'flutter';
  // Expo managed workflow: no android/ folder in the repo — `expo prebuild`
  // generates it. Detect via the expo dependency in package.json.
  if (has('package.json') && !has('android')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.expo) return 'expo';
    } catch { /* unreadable package.json — fall through */ }
  }
  if (has('package.json') && has('android') && (has('index.js') || has('App.tsx') || has('app.json'))) return 'react-native';
  if (has('gradlew.bat') || has('gradlew') || has('settings.gradle') || has('settings.gradle.kts')) return 'android-gradle';
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (entries.some(e => e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace'))) return 'ios-only';
  if (entries.some(e => e.endsWith('.apk'))) return 'apk-folder';
  return 'unknown';
}

const KIND_INFO = {
  'android-gradle': { buildable: true, note: 'Native Android (Gradle)' },
  'react-native':   { buildable: true, note: 'React Native — builds the android/ app' },
  'expo':           { buildable: true, note: 'Expo (managed) — Build runs expo prebuild, then Gradle. First build downloads a lot; debug builds need Metro (npx expo start) running' },
  'flutter':        { buildable: false, note: 'Flutter project — Flutter SDK not installed on this PC' },
  'ios-only':       { buildable: false, note: 'iOS-only (Xcode) — cannot build on Windows; use the iOS cloud lane' },
  'apk-folder':     { buildable: false, note: 'Contains prebuilt APK(s) — install directly' },
  'apk':            { buildable: false, note: 'Prebuilt APK — install directly' },
  'unknown':        { buildable: false, note: 'Not recognized as a mobile project' },
};

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'out', '.git', '.gradle', 'Pods', 'vendor']);

// BFS for buildable app projects nested inside a bigger repo (returns
// shallowest matches first, so apps/mobile beats apps/mobile/example).
function findBuildableSubprojects(root, maxDepth) {
  const found = [];
  let level = [''];
  for (let depth = 1; depth <= maxDepth && level.length; depth++) {
    const next = [];
    for (const rel of level) {
      const abs = path.join(root, rel);
      let entries;
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const subRel = rel ? path.join(rel, e.name) : e.name;
        const kind = detectKind(path.join(root, subRel));
        if (KIND_INFO[kind].buildable) found.push({ rel: subRel, kind });
        else next.push(subRel);   // only descend into non-project dirs
      }
    }
    level = next;
  }
  return found;
}

function findApks(dir) {
  const results = [];
  const walk = (d, depth) => {
    if (depth > 6 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.apk')) results.push({ path: full, mtime: fs.statSync(full).mtimeMs });
    }
  };
  walk(dir, 0);
  return results.sort((a, b) => b.mtime - a.mtime).map(r => r.path);
}

async function addProject({ source, location }) {
  const projects = load();
  let dir, name;

  if (source === 'github') {
    const m = location.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/);
    if (!m) throw new Error('Not a valid GitHub repo URL');
    name = `${m[1]}-${m[2]}`;
    dir = path.join(WORKSPACE, name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve, reject) => {
      execFile('git', ['clone', '--depth', '1', location, dir], { timeout: 300000 },
        (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
    });
  } else if (source === 'local') {
    if (!fs.existsSync(location)) throw new Error(`Path not found: ${location}`);
    dir = location;
    name = path.basename(location);
  } else if (source === 'apk') {
    dir = path.dirname(location);
    name = path.basename(location);
  } else {
    throw new Error(`Unknown source: ${source}`);
  }

  let kind = source === 'apk' ? 'apk' : detectKind(dir);
  let subNote = '';
  if (kind === 'unknown' && source !== 'apk') {
    // monorepo (e.g. a web app with a mobile client at apps/mobile/):
    // breadth-first search up to 3 levels down for buildable app projects
    const subs = findBuildableSubprojects(dir, 3);
    if (subs.length) {
      kind = subs[0].kind;
      dir = path.join(dir, subs[0].rel);
      subNote = subs.length > 1
        ? ` — using sub-project "${subs[0].rel}" (also found: ${subs.slice(1, 4).map(s => s.rel).join(', ')}${subs.length > 4 ? '…' : ''})`
        : ` — using sub-project "${subs[0].rel}"`;
    }
  }
  const project = {
    id: Date.now().toString(36),
    name, dir, source, location, kind,
    ...KIND_INFO[kind],
    note: KIND_INFO[kind].note + subNote,
    apk: source === 'apk' ? location : null,
    addedAt: new Date().toISOString(),
  };
  // re-adding the same location replaces the old entry (e.g. after a
  // Device Lab update improves detection) instead of duplicating it
  const norm = p => path.resolve(p).toLowerCase();
  const filtered = projects.filter(x => norm(x.location) !== norm(location) && norm(x.dir) !== norm(dir));
  filtered.unshift(project);
  save(filtered);
  return project;
}

function removeProject(id) {
  const projects = load();
  const p = projects.find(x => x.id === id);
  // only delete directories we created (clones inside our workspace)
  if (p && p.source === 'github' && p.dir.startsWith(WORKSPACE) && fs.existsSync(p.dir)) {
    fs.rmSync(p.dir, { recursive: true, force: true });
  }
  save(projects.filter(x => x.id !== id));
}

const ANDROID_HOME = process.env.ANDROID_HOME || path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const BUILD_ENV = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME };

function streamCommand(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: BUILD_ENV, shell: true });
    const feed = chunk => chunk.toString().split(/\r?\n/).forEach(l => l.trim() && onLine(l));
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
  });
}

// Build an android project by streaming build output line-by-line.
async function buildProject(project, onLine) {
  let gradleDir = project.dir;
  if (project.kind === 'react-native') gradleDir = path.join(project.dir, 'android');

  if (project.kind === 'expo') {
    gradleDir = path.join(project.dir, 'android');
    if (!fs.existsSync(gradleDir)) {
      onLine('> npx expo prebuild --platform android (generates the native android/ project)…');
      await streamCommand('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], project.dir, onLine);
    }
  }

  const gradlew = path.join(gradleDir, 'gradlew.bat');
  if (!fs.existsSync(gradlew)) throw new Error(`No gradlew.bat in ${gradleDir}`);

  onLine(`> Building ${project.name} (assembleDebug) — first build downloads Gradle + deps, be patient…`);
  await streamCommand(`"${gradlew}"`, ['assembleDebug', '--no-daemon'], gradleDir, onLine);

  const apks = findApks(gradleDir).filter(p => p.includes('debug'));
  if (!apks.length) throw new Error('Build succeeded but no debug APK found');
  return apks[0];
}

module.exports = { load, addProject, removeProject, buildProject, findApks, detectKind, WORKSPACE };
