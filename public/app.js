// Device Lab frontend
const $ = id => document.getElementById(id);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

// ---------------- WebSocket: frames + events ----------------
let ws, lastFrameUrl = null, paused = false, crashTail = [];
function connectWs() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.binaryType = 'blob';
  ws.onmessage = ev => {
    if (ev.data instanceof Blob) return showFrame(ev.data);
    const m = JSON.parse(ev.data);
    if (m.t === 'logcat') addLogLine(m.line);
    else if (m.t === 'crash') { crashTail = m.tail; $('toast').classList.add('show'); }
    else if (m.t === 'build') addBuild(m.line);
    else if (m.t === 'buildDone') { addBuild(`✅ Installed & launched ${m.app.label || m.app.package}`, 'ok'); refreshDevice(); }
    else if (m.t === 'buildError') addBuild(`❌ ${m.msg}`, 'err');
    else if (m.t === 'error') addBuild(`⚠ ${m.msg}`, 'err');
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
}
function showFrame(blob) {
  const img = $('screen');
  const url = URL.createObjectURL(blob);
  img.onload = () => { if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl); lastFrameUrl = url; };
  img.src = url;
  img.style.display = 'block';
  $('screenOff').style.display = 'none';
}
connectWs();

// ---------------- device screen interaction ----------------
let downPos = null, downTime = 0;
const relPos = e => {
  const r = $('screen').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
};
$('screen').addEventListener('mousedown', e => { downPos = relPos(e); downTime = Date.now(); });
$('screen').addEventListener('mouseup', e => {
  if (!downPos) return;
  const up = relPos(e);
  const dist = Math.hypot(up.x - downPos.x, up.y - downPos.y);
  const dur = Date.now() - downTime;
  if (dist < 0.02) ws.send(JSON.stringify({ t: 'tap', x: up.x, y: up.y }));
  else ws.send(JSON.stringify({ t: 'swipe', x1: downPos.x, y1: downPos.y, x2: up.x, y2: up.y, ms: Math.max(80, Math.min(dur, 800)) }));
  downPos = null;
});
function sendKey(name) { ws.send(JSON.stringify({ t: 'key', name })); }
function sendText() {
  const v = $('textSend').value;
  if (v) { ws.send(JSON.stringify({ t: 'text', value: v })); $('textSend').value = ''; }
}
$('textSend').addEventListener('keydown', e => { if (e.key === 'Enter') { sendText(); sendKey('enter'); } });
function downloadScreenshot() {
  if (!$('screen').src) return;
  const a = document.createElement('a');
  a.href = $('screen').src; a.download = `screenshot-${Date.now()}.png`; a.click();
}
async function relaunch() { try { await api('/api/app/relaunch', { method: 'POST' }); } catch (e) { alert(e.message); } }

// ---------------- device status ----------------
async function refreshDevice() {
  try {
    const d = await api('/api/device');
    const dot = $('devDot'), st = $('devStatus');
    if (d.booted) {
      dot.className = 'dot online';
      st.textContent = `${d.info.model} · Android ${d.info.android}`;
    } else if (d.online) {
      dot.className = 'dot booting'; st.textContent = 'booting…';
      $('screenOffMsg').textContent = 'Device booting…';
    } else {
      dot.className = 'dot'; st.textContent = 'emulator offline';
      $('screen').style.display = 'none'; $('screenOff').style.display = 'flex';
    }
    const sel = $('avdSelect');
    if (sel.options.length !== d.avds.length) {
      sel.innerHTML = d.avds.map(a => `<option>${a}</option>`).join('');
    }
    if (d.currentApp) {
      $('appPill').style.display = '';
      $('appName').textContent = `${d.currentApp.label || d.currentApp.package} ${d.currentApp.versionName || ''}`;
    }
  } catch { $('devStatus').textContent = 'server unreachable'; }
}
$('startEmuBtn').onclick = async () => {
  await api('/api/device/start', { method: 'POST', body: JSON.stringify({ avd: $('avdSelect').value }) });
  $('devStatus').textContent = 'starting emulator…';
};
setInterval(refreshDevice, 3000); refreshDevice();

// ---------------- projects ----------------
document.querySelectorAll('.src-tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.src-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  ['Local', 'Github', 'Apk'].forEach(n => $('form' + n).style.display = 'none');
  $('form' + t.dataset.src[0].toUpperCase() + t.dataset.src.slice(1)).style.display = 'flex';
});

async function loadProjects() {
  const list = await api('/api/projects');
  $('projectList').innerHTML = list.map(p => `
    <div class="project">
      <div class="name">${esc(p.name)}</div>
      <span class="chip ${p.buildable ? '' : 'warn'}">${p.kind}</span>
      <div class="note">${esc(p.note || '')}</div>
      <div class="row">
        ${p.buildable ? `<button class="btn small primary" onclick="buildProject('${p.id}')">🔨 Build + run</button>` : ''}
        ${(p.kind === 'apk' || p.kind === 'apk-folder' || p.buildable) ? `<button class="btn small" onclick="installProject('${p.id}')">▶ Install APK</button>` : ''}
        <div class="spacer"></div>
        <button class="btn small" onclick="removeProject('${p.id}')">✕</button>
      </div>
    </div>`).join('') || '<div style="color:var(--dim); font-size:12px; padding:6px">No projects yet — add a local path, GitHub repo, or APK above.</div>';
}
async function addProject(source) {
  const location = source === 'local' ? $('localPath').value.trim() : $('githubUrl').value.trim();
  if (!location) return;
  try {
    addBuild(`Adding ${location}…`);
    await api('/api/projects', { method: 'POST', body: JSON.stringify({ source, location }) });
    $('localPath').value = ''; $('githubUrl').value = '';
    loadProjects();
  } catch (e) { addBuild(`❌ ${e.message}`, 'err'); }
}
async function uploadApk() {
  const f = $('apkFile').files[0];
  if (!f) return;
  const fd = new FormData(); fd.append('apk', f);
  const r = await fetch('/api/projects/upload-apk', { method: 'POST', body: fd });
  if (r.ok) loadProjects(); else addBuild('❌ APK upload failed', 'err');
}
async function buildProject(id) {
  try { await api(`/api/projects/${id}/build`, { method: 'POST' }); }
  catch (e) { addBuild(`❌ ${e.message}`, 'err'); }
}
async function installProject(id) {
  try { addBuild('Installing APK…'); await api(`/api/projects/${id}/install`, { method: 'POST' }); addBuild('✅ Installed & launched', 'ok'); refreshDevice(); }
  catch (e) { addBuild(`❌ ${e.message}`, 'err'); }
}
async function removeProject(id) { await api(`/api/projects/${id}`, { method: 'DELETE' }); loadProjects(); }
function addBuild(line, cls) {
  const el = $('buildLog');
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = line + '\n';
  el.appendChild(span);
  while (el.childNodes.length > 500) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
loadProjects();

// ---------------- logcat ----------------
const logEl = $('logcat');
function addLogLine(line) {
  if (paused) return;
  const f = $('logcatFilter').value.toLowerCase();
  if (f && !line.toLowerCase().includes(f)) return;
  const level = (line.match(/\s([VDIWEF])\s/) || [])[1] || 'I';
  const div = document.createElement('div');
  div.className = 'lc-' + level;
  div.textContent = line;
  logEl.appendChild(div);
  while (logEl.childNodes.length > 600) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
function togglePause() { paused = !paused; $('pauseLog').textContent = paused ? '▶' : '⏸'; }
function clearLog() { logEl.innerHTML = ''; }

// ---------------- tabs / platform ----------------
function setTab(name) {
  document.querySelectorAll('.right-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $('tabLogcat').style.display = name === 'logcat' ? 'flex' : 'none';
  $('tabBugs').style.display = name === 'bugs' ? 'flex' : 'none';
}
function setPlatform(p) {
  document.querySelectorAll('.platform-tab').forEach(t => t.classList.toggle('active', t.dataset.plat === p));
  $('androidPanel').style.display = p === 'android' ? '' : 'none';
  $('iosPanel').style.display = p === 'ios' ? '' : 'none';
  if (p === 'ios') loadIos();
}

// ---------------- bugs ----------------
async function loadBugs() {
  const list = await api('/api/bugs');
  $('bugCount').textContent = list.filter(b => b.status === 'open').length || '';
  $('bugList').innerHTML = list.map(b => `
    <div class="bug" id="bug-${b.id}">
      <div class="head" onclick="this.parentElement.classList.toggle('open')">
        <span class="sev ${b.severity}">${b.severity}</span>
        <span class="title ${b.status === 'closed' ? 'closed' : ''}">${esc(b.title)}</span>
        <span style="font-size:10px;color:var(--dim)">${b.id}</span>
      </div>
      <div class="detail">
        <div><b>Platform:</b> ${b.platform} · <b>Area:</b> ${esc(b.area || '—')} · <b>Device:</b> ${esc(b.device.model || '?')} Android ${esc(b.device.android || '?')}</div>
        <div><b>App:</b> ${esc(b.app.label || b.app.package || '—')} ${esc(b.app.versionName || '')}</div>
        ${b.steps ? `<div style="margin-top:6px"><b>Steps:</b><br>${esc(b.steps).replace(/\n/g, '<br>')}</div>` : ''}
        ${b.expected ? `<div><b>Expected:</b> ${esc(b.expected)}</div>` : ''}
        ${b.actual ? `<div><b>Actual:</b> ${esc(b.actual)}</div>` : ''}
        ${b.screenshot ? `<a href="/screenshots/${b.screenshot}" target="_blank"><img src="/screenshots/${b.screenshot}"></a>` : ''}
        <div class="row">
          <button class="btn small" onclick="toggleBug('${b.id}', '${b.status === 'open' ? 'closed' : 'open'}')">${b.status === 'open' ? '✓ Close' : '↺ Reopen'}</button>
          <button class="btn small" onclick="deleteBug('${b.id}')">🗑 Delete</button>
        </div>
      </div>
    </div>`).join('') || '<div style="color:var(--dim); font-size:12px; padding:6px">No bugs filed yet. 🎉</div>';
}
function openBugModal(prefill = {}) {
  $('bTitle').value = prefill.title || '';
  $('bActual').value = prefill.actual || '';
  $('bSeverity').value = prefill.severity || 'minor';
  $('bArea').value = prefill.area || '';
  $('bSteps').value = ''; $('bExpected').value = '';
  $('modalWrap').classList.add('show');
  $('bTitle').focus();
}
function closeBugModal() { $('modalWrap').classList.remove('show'); }
async function submitBug() {
  try {
    await api('/api/bugs', { method: 'POST', body: JSON.stringify({
      title: $('bTitle').value, severity: $('bSeverity').value, area: $('bArea').value,
      steps: $('bSteps').value, expected: $('bExpected').value, actual: $('bActual').value,
      platform: $('bPlatform').value,
    }) });
    closeBugModal(); loadBugs(); setTab('bugs');
  } catch (e) { alert(e.message); }
}
async function toggleBug(id, status) { await api(`/api/bugs/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); loadBugs(); }
async function deleteBug(id) { await api(`/api/bugs/${id}`, { method: 'DELETE' }); loadBugs(); }
function exportBugs() { location.href = `/api/bugs/export?format=${$('exportFmt').value}`; }
function fileCrashBug() {
  hideToast();
  openBugModal({ title: 'Crash detected', severity: 'blocker', area: 'crash',
    actual: crashTail.slice(-12).join('\n') });
}
function hideToast() { $('toast').classList.remove('show'); }
loadBugs();

// ---------------- iOS lane ----------------
async function loadIos() {
  const cfg = await api('/api/ios/config');
  $('iosTokenCard').style.display = cfg.hasToken ? 'none' : '';
  $('iosApps').innerHTML = (cfg.apps || []).map(a => `
    <div class="ios-app-row">📱 ${esc(a.name)}
      <div class="spacer"></div>
      <button class="btn small primary" onclick="playIos('${a.publicKey}', '${esc(a.name)}')">▶ Run</button>
    </div>`).join('') || '<div style="font-size:12px;color:var(--dim)">No iOS builds uploaded yet.</div>';
}
async function saveIosToken() {
  await api('/api/ios/token', { method: 'POST', body: JSON.stringify({ token: $('iosToken').value.trim() }) });
  loadIos();
}
async function uploadIos() {
  const f = $('iosBundle').files[0];
  if (!f) return;
  const fd = new FormData(); fd.append('bundle', f);
  const r = await fetch('/api/ios/upload', { method: 'POST', body: fd });
  const d = await r.json();
  if (!r.ok) return alert(d.error || 'upload failed');
  loadIos(); playIos(d.publicKey, d.name);
}
function playIos(publicKey, name) {
  $('iosPlayerCard').style.display = '';
  $('iosPlayerTitle').textContent = `Simulator — ${name}`;
  $('iosFrame').src = `https://appetize.io/embed/${publicKey}?device=iphone15pro&scale=auto&autoplay=true`;
}
function downloadWorkflow() {
  location.href = `/api/ios/workflow?scheme=${encodeURIComponent($('iosScheme').value || 'YourScheme')}`;
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
