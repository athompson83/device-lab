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
  'flutter':        { buildable: false, note: 'Flutter project — Flutter SDK not installed on this PC' },
  'ios-only':       { buildable: false, note: 'iOS-only (Xcode) — cannot build on Windows; use the iOS cloud lane' },
  'apk-folder':     { buildable: false, note: 'Contains prebuilt APK(s) — install directly' },
  'apk':            { buildable: false, note: 'Prebuilt APK — install directly' },
  'unknown':        { buildable: false, note: 'Not recognized as a mobile project' },
};

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
    // monorepo / samples repo: look one level down for a buildable app
    const subs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, kind: detectKind(path.join(dir, e.name)) }))
      .filter(s => KIND_INFO[s.kind].buildable);
    if (subs.length) {
      kind = subs[0].kind;
      dir = path.join(dir, subs[0].name);
      subNote = subs.length > 1
        ? ` — using sub-project "${subs[0].name}" (also found: ${subs.slice(1, 4).map(s => s.name).join(', ')}${subs.length > 4 ? '…' : ''})`
        : ` — using sub-project "${subs[0].name}"`;
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
  projects.unshift(project);
  save(projects);
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

// Build an android project by streaming gradle output line-by-line.
function buildProject(project, onLine) {
  return new Promise((resolve, reject) => {
    const gradleDir = project.kind === 'react-native' ? path.join(project.dir, 'android') : project.dir;
    const gradlew = path.join(gradleDir, 'gradlew.bat');
    if (!fs.existsSync(gradlew)) return reject(new Error(`No gradlew.bat in ${gradleDir}`));

    onLine(`> Building ${project.name} (assembleDebug) — first build downloads Gradle + deps, be patient…`);
    const child = spawn(gradlew, ['assembleDebug', '--no-daemon'], {
      cwd: gradleDir,
      env: { ...process.env, JAVA_HOME },
      shell: true,
    });
    const feed = chunk => chunk.toString().split(/\r?\n/).forEach(l => l.trim() && onLine(l));
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Gradle exited with code ${code}`));
      const apks = findApks(gradleDir).filter(p => p.includes('debug'));
      if (!apks.length) return reject(new Error('Build succeeded but no debug APK found'));
      resolve(apks[0]);
    });
  });
}

module.exports = { load, addProject, removeProject, buildProject, findApks, detectKind, WORKSPACE };
