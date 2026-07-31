// Bug store: JSON-file persistence + evidence capture + export.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const DB = path.join(DATA, 'bugs.json');
const SHOTS = path.join(DATA, 'screenshots');

function load() { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } }
function save(list) { fs.writeFileSync(DB, JSON.stringify(list, null, 2)); }

function createBug(fields, screenshotPng, logcatTail, device, app) {
  const bugs = load();
  const id = 'BUG-' + String(bugs.length + 1).padStart(3, '0') + '-' + Date.now().toString(36).slice(-4);
  let screenshot = null;
  if (screenshotPng) {
    screenshot = `${id}.png`;
    fs.writeFileSync(path.join(SHOTS, screenshot), screenshotPng);
  }
  const bug = {
    id,
    title: fields.title || '(untitled)',
    severity: fields.severity || 'minor',      // blocker | major | minor | cosmetic
    area: fields.area || '',                   // UI, UX, functionality, performance, crash…
    steps: fields.steps || '',
    expected: fields.expected || '',
    actual: fields.actual || '',
    status: 'open',
    platform: fields.platform || 'android',
    device: device || {},
    app: app || {},
    logcatTail: logcatTail || [],
    screenshot,
    createdAt: new Date().toISOString(),
  };
  bugs.unshift(bug);
  save(bugs);
  return bug;
}

function updateBug(id, patch) {
  const bugs = load();
  const b = bugs.find(x => x.id === id);
  if (!b) throw new Error(`No bug ${id}`);
  const allowed = ['title', 'severity', 'area', 'steps', 'expected', 'actual', 'status'];
  for (const k of allowed) if (k in patch) b[k] = patch[k];
  save(bugs);
  return b;
}

function deleteBug(id) {
  const bugs = load();
  const b = bugs.find(x => x.id === id);
  if (b && b.screenshot) fs.rmSync(path.join(SHOTS, b.screenshot), { force: true });
  save(bugs.filter(x => x.id !== id));
}

// --- export ---------------------------------------------------------------

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportBugs(format) {
  const bugs = load();
  if (format === 'json') {
    return { mime: 'application/json', filename: 'bug-report.json', body: JSON.stringify(bugs, null, 2) };
  }
  if (format === 'csv') {
    const cols = ['id', 'title', 'severity', 'area', 'status', 'platform', 'steps', 'expected', 'actual', 'createdAt'];
    const rows = [cols.join(','), ...bugs.map(b => cols.map(c => csvCell(b[c])).join(','))];
    return { mime: 'text/csv', filename: 'bug-report.csv', body: rows.join('\n') };
  }
  // markdown (default)
  const counts = { blocker: 0, major: 0, minor: 0, cosmetic: 0 };
  bugs.forEach(b => { counts[b.severity] = (counts[b.severity] || 0) + 1; });
  const lines = [
    '# Bug Report — Device Lab',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total: ${bugs.length} (open: ${bugs.filter(b => b.status === 'open').length})` +
      ` — 🟥 ${counts.blocker} blocker · 🟧 ${counts.major} major · 🟨 ${counts.minor} minor · ⬜ ${counts.cosmetic} cosmetic`,
    '',
  ];
  for (const b of bugs) {
    lines.push(
      `## ${b.id} — ${b.title}`,
      '',
      `| | |`, `|---|---|`,
      `| Severity | ${b.severity} |`,
      `| Area | ${b.area || '—'} |`,
      `| Status | ${b.status} |`,
      `| Platform | ${b.platform} |`,
      `| Device | ${b.device.model || '?'} (Android ${b.device.android || '?'}, ${b.device.resolution || '?'}) |`,
      `| App | ${b.app.label || b.app.package || '—'} ${b.app.versionName || ''} |`,
      `| Filed | ${b.createdAt} |`,
      '',
      `**Steps to reproduce**`, '', b.steps || '_none recorded_', '',
      `**Expected:** ${b.expected || '—'}`, '',
      `**Actual:** ${b.actual || '—'}`, '',
    );
    if (b.screenshot) lines.push(`**Screenshot:** \`screenshots/${b.screenshot}\``, '');
    if (b.logcatTail && b.logcatTail.length) {
      lines.push('<details><summary>Logcat tail</summary>', '', '```', ...b.logcatTail.slice(-60), '```', '</details>', '');
    }
    lines.push('---', '');
  }
  return { mime: 'text/markdown', filename: 'bug-report.md', body: lines.join('\n') };
}

module.exports = { load, createBug, updateBug, deleteBug, exportBugs, SHOTS };
