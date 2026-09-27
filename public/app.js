const $ = (id) => document.getElementById(id);
const socket = io();

let ME = null;             // full me incl host, openPort
let usersById = {}, usersByHost = {};
let installed = JSON.parse(localStorage.getItem('hc_installed') || '{}');
let termColor = localStorage.getItem('hc_term_color') || '0';
let TSTATE = { mode: 'idle', data: {} };
let adminToken = null;
let lastCopiedPath = '';

const COLORS = {
  '0': '#00ff9c', '1': '#ffffff', '2': '#39d0ff', '3': '#ff5cf1',
  '4': '#ffe600', '5': '#ff5f57', '6': '#5f8bff', '7': '#ff9f43',
  '8': '#a78bff', '9': '#9aa3b2'
};

function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}
function defaultAvatar(name) {
  const c = encodeURIComponent((name || '?')[0].toUpperCase());
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#222"/><text x="48" y="62" font-size="44" text-anchor="middle" fill="#fff" font-family="monospace">${c}</text></svg>`);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function rankOf(h) { if (h >= 10) return 'legend'; if (h >= 7) return 'elite'; if (h >= 5) return 'gold'; if (h >= 3) return 'silver'; if (h >= 1) return 'bronze'; return 'rookie'; }
function incomeOf(h) { const r = rankOf(h); if (r === 'legend') return 50; if (r === 'elite') return 38; if (r === 'gold') return 28; if (r === 'silver') return 18; if (r === 'bronze') return 10; return 5; }

/* ---------- TERM ---------- */
const term = $('term'), termInput = $('termInput');
function applyColor() { term.style.setProperty('--tc', COLORS[termColor] || COLORS['0']); }
applyColor();
function print(t = '', cls = '') {
  const div = document.createElement('div');
  div.className = 'l ' + cls;
  div.textContent = t;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
}
function printHTML(html) {
  const div = document.createElement('div');
  div.className = 'l';
  div.innerHTML = html;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
}
function bootTerm() {
  print('HACKCHAT ROOT TERMINAL v2.1 — type "help"', 'info');
  print('----------------------------------------', 'dim');
}
function progressBar(label, ms, done) {
  const line = document.createElement('div');
  line.className = 'l bar';
  term.appendChild(line);
  const start = Date.now();
  const iv = setInterval(() => {
    const p = Math.min(1, (Date.now() - start) / ms);
    const n = Math.floor(p * 24);
    line.textContent = `${label} [${'█'.repeat(n)}${'░'.repeat(24 - n)}] ${Math.floor(p * 100)}%`;
    term.scrollTop = term.scrollHeight;
    if (p >= 1) { clearInterval(iv); done && done(); }
  }, 90);
}

termInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const raw = termInput.value;
  termInput.value = '';
  print('➜ ' + raw, 'info');
  handleCommand(raw.trim());
});

async function handleCommand(raw) {
  // state machines first
  if (TSTATE.mode !== 'idle') { await handleState(raw); return; }
  if (!raw) return;
  const [cmd, ...rest] = raw.split(/\s+/);
  const c = cmd.toLowerCase();
  const arg = rest.join(' ');

  if (c === 'help') {
    print('commands:', 'info');
    print('  color [0-9]        change terminal color');
    print('  install [pkg]      packages: bruce, nos');
    print('  bruce              open password engine');
    print('  nos                open port scanner');
    print('  open [path]        open remote core  e.g. open HC-AB12-CD34/5678/core/zero');
    print('  db open            open database control deck');
    print('  whoami / users / clear');
    return;
  }
  if (c === 'clear') { term.innerHTML = ''; return; }
  if (c === 'whoami') { print(ME ? `${ME.name} :: ${ME.host} :: ${ME.balance}$ :: ${rankOf(ME.hacks)}` : 'ghost', 'ok'); return; }
  if (c === 'users') {
    const list = Object.values(usersById);
    print(`-- ${list.length} nodes on the grid --`, 'info');
    list.forEach(u => print(`  ${u.host}  ::  ${u.name}  ::  ${u.balance}$  ::  ${u.rank}`));
    return;
  }
  if (c === 'color') {
    if (!(arg in COLORS)) { print('usage: color [0-9]  (0 green,1 white,2 cyan,3 magenta,4 yellow,5 red,6 blue,7 orange,8 purple,9 gray)', 'err'); return; }
    termColor = arg; localStorage.setItem('hc_term_color', arg); applyColor();
    print(`terminal color set to ${arg}`, 'ok'); return;
  }
  if (c === 'install') {
    const pkg = arg.toLowerCase();
    if (!['bruce', 'nos'].includes(pkg)) { print('packages: bruce, nos', 'err'); return; }
    if (installed[pkg]) { print(`${pkg} already installed. type ${pkg} to run.`, 'ok'); return; }
    print(`fetching ${pkg} from grid mirror...`, 'dim');
    progressBar(`installing ${pkg}`, 2600, () => {
      installed[pkg] = true;
      localStorage.setItem('hc_installed', JSON.stringify(installed));
      print(`${pkg} installed. type ${pkg} to launch.`, 'ok');
    });
    return;
  }
  if (c === 'bruce') {
    if (!installed.bruce) { print('bruce not installed. type: install bruce', 'err'); return; }
    print('== BRUCE v4.2 // db password engine ==', 'info');
    print('  1 - start');
    print('  2 - quit');
    TSTATE = { mode: 'bruce_menu', data: {} };
    return;
  }
  if (c === 'nos') {
    if (!installed.nos) { print('nos not installed. type: install nos', 'err'); return; }
    print('== NOS v1.9 // network port scanner ==', 'info');
    print('  1 - scan for ports');
    print('  2 - quit');
    TSTATE = { mode: 'nos_menu', data: {} };
    return;
  }
  if (c === 'open') {
    if (!arg) { print('usage: open [host]/[port]/core/[username]', 'err'); return; }
    TSTATE = { mode: 'open_password', data: { path: arg } };
    print('target locked: ' + arg, 'dim');
    print('enter server password:', 'info');
    return;
  }
  if (c === 'db' && arg.toLowerCase() === 'open') {
    TSTATE = { mode: 'db_password', data: {} };
    print('DATABASE deck requires password:', 'info');
    return;
  }
  print(`unknown command: ${c}  (try help)`, 'err');
}

async function handleState(raw) {
  const m = TSTATE.mode, d = TSTATE.data;
  // BRUCE
  if (m === 'bruce_menu') {
    if (raw === '1') { TSTATE = { mode: 'bruce_port', data: {} }; print('target db port (4 digits):', 'info'); }
    else if (raw === '2') { TSTATE = { mode: 'idle', data: {} }; print('bruce closed.', 'dim'); }
    else print('type 1 or 2', 'err');
    return;
  }
  if (m === 'bruce_port') {
    print('resolving port...', 'dim');
    try {
      const r = await fetch('/api/bruce-init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: raw }) });
      const j = await r.json();
      if (!r.ok) { print("port doesn't exist.", 'err'); TSTATE = { mode: 'idle', data: {} }; return; }
      d.port = raw; d.host = j.host; d.username = j.username; d.duration = j.duration;
      TSTATE = { mode: 'bruce_running', data: d };
      print(`target: ${j.host} :: ${j.username}`, 'info');
      print(`estimated time: ~${j.duration}s (adaptive to password strength)`, 'info');
      print('cracking... do not close terminal', 'dim');
      await runBruceCrack(d);
    } catch { print('network error', 'err'); TSTATE = { mode: 'idle', data: {} }; }
    return;
  }
  if (m === 'bruce_result') {
    if (raw === '1') {
      const p = `${d.host}/${d.port}/core/${d.username}`;
      lastCopiedPath = p;
      try { await navigator.clipboard.writeText('open ' + p); print('path copied to clipboard ✓  (also shown below)', 'ok'); }
      catch { print('clipboard blocked — copy manually:', 'dim'); }
      print('open ' + p, 'ok');
      print(`now type: open ${p}`, 'info');
      TSTATE = { mode: 'idle', data: {} };
    } else if (raw === '2') { TSTATE = { mode: 'idle', data: {} }; print('bruce closed.', 'dim'); }
    else print('type 1 or 2', 'err');
    return;
  }
  // NOS
  if (m === 'nos_menu') {
    if (raw === '1') { TSTATE = { mode: 'nos_host', data: {} }; print('target host (e.g. HC-XXXX-XXXX):', 'info'); }
    else if (raw === '2') { TSTATE = { mode: 'idle', data: {} }; print('nos closed.', 'dim'); }
    else print('type 1 or 2', 'err');
    return;
  }
  if (m === 'nos_host') {
    print(`scanning ${raw} ...`, 'dim');
    progressBar('nos sweep', 2200, async () => {
      try {
        const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: raw }) });
        const j = await r.json();
        if (!r.ok) { print("host doesn't exist.", 'err'); TSTATE = { mode: 'idle', data: {} }; return; }
        print(`host ${j.host} (${j.username}) — ${j.ports.length} ports found:`, 'ok');
        j.ports.forEach(p => print(`  ${p.port}  ....  ${p.status.toUpperCase()}`, p.status === 'open' ? 'ok' : 'err'));
        print('copy the OPEN port into bruce.', 'info');
      } catch { print('network error', 'err'); }
      TSTATE = { mode: 'idle', data: {} };
    });
    TSTATE = { mode: 'nos_scanning', data: {} };
    return;
  }
  if (m === 'nos_scanning') { print('(scan in progress...)', 'dim'); return; }
  // OPEN remote
  if (m === 'open_password') {
    try {
      const r = await fetch('/api/server-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: d.path, password: raw }) });
      const j = await r.json();
      if (!r.ok) { print(j.error === 'WRONG_PASSWORD' ? 'wrong password.' : "path/port doesn't exist.", 'err'); TSTATE = { mode: 'idle', data: {} }; return; }
      d.session = j;
      TSTATE = { mode: 'server_menu', data: d };
      print(`Welcome ${j.username}`, 'ok');
      print('  1 - balance');
      print('  2 - quit');
    } catch { print('network error', 'err'); TSTATE = { mode: 'idle', data: {} }; }
    return;
  }
  if (m === 'server_menu') {
    if (raw === '1') {
      TSTATE = { mode: 'server_balance', data: d };
      print(`balance of ${d.session.username}: ${d.session.balance}$`, 'ok');
      print('  1 - transfer');
      print('  2 - leak (wipe to 0)');
      print('  3 - quit');
    } else if (raw === '2') { TSTATE = { mode: 'idle', data: {} }; print('connection closed.', 'dim'); }
    else print('type 1 or 2', 'err');
    return;
  }
  if (m === 'server_balance') {
    if (raw === '1') { TSTATE = { mode: 'transfer_host', data: d }; print('destination host (yours or anyone):', 'info'); }
    else if (raw === '2') {
      await fetch('/api/leak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromHost: d.session.host, byId: ME.id }) });
      print('balance leaked. server wiped to 0$. hacks +1.', 'ok');
      await refreshMe(); TSTATE = { mode: 'idle', data: {} };
    }
    else if (raw === '3') { TSTATE = { mode: 'idle', data: {} }; print('connection closed.', 'dim'); }
    else print('type 1, 2 or 3', 'err');
    return;
  }
  if (m === 'transfer_host') {
    try {
      const r = await fetch('/api/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromHost: d.session.host, toHost: raw, byId: ME.id }) });
      const j = await r.json();
      if (!r.ok) { print("destination host doesn't exist.", 'err'); TSTATE = { mode: 'idle', data: {} }; return; }
      print(`transferred ${j.moved}$ → ${raw}. hacks +1. rank up? check profile.`, 'ok');
      await refreshMe();
    } catch { print('network error', 'err'); }
    TSTATE = { mode: 'idle', data: {} };
    return;
  }
  // DB admin
  if (m === 'db_password') {
    try {
      const r = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: raw }) });
      const j = await r.json();
      if (!r.ok) { print('access denied.', 'err'); TSTATE = { mode: 'idle', data: {} }; return; }
      adminToken = j.token;
      print('access granted. opening deck...', 'ok');
      openAdmin();
    } catch { print('network error', 'err'); }
    TSTATE = { mode: 'idle', data: {} };
    return;
  }
}

async function runBruceCrack(d) {
  const total = d.duration;
  const line = document.createElement('div');
  line.className = 'l bar';
  term.appendChild(line);
  const guesses = ['moon', 'shadow!', 'x42q', 'admin123', 'qwerty!', 'letme1n', 'dragon#9', ' TrustNo1', '0xdead', 'sunshine!7'];
  const start = Date.now();
  let gi = 0;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const el = (Date.now() - start) / 1000;
      const p = Math.min(1, el / total);
      const left = Math.max(0, Math.ceil(total - el));
      line.textContent = `guessing [${'█'.repeat(Math.floor(p * 24))}${'░'.repeat(24 - Math.floor(p * 24))}] ${Math.floor(p * 100)}%  ~${left}s left  try: ${guesses[gi++ % guesses.length]}${Math.floor(Math.random() * 999)}`;
      term.scrollTop = term.scrollHeight;
      if (p >= 1) { clearInterval(iv); resolve(); }
    }, 200);
  });
  try {
    const r = await fetch('/api/bruce-reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: d.port }) });
    const j = await r.json();
    if (!r.ok) { print("port doesn't exist.", 'err'); TSTATE = { mode: 'idle', data: {} }; return; }
    d.password = j.password;
    print('PASSWORD CRACKED:', 'ok');
    print(`  >>> ${j.password} <<<`, 'info');
    print(`owner: ${j.username} @ ${j.host}`, 'dim');
    print('  1 - copy path');
    print('  2 - quit');
    TSTATE = { mode: 'bruce_result', data: d };
  } catch { print('network error', 'err'); TSTATE = { mode: 'idle', data: {} }; }
}

/* ---------- ADMIN ---------- */
async function openAdmin() {
  $('adminWrap').classList.remove('hidden');
  await loadAdmin();
}
$('adminClose').onclick = () => $('adminWrap').classList.add('hidden');
async function loadAdmin() {
  const box = $('adminList'); box.innerHTML = 'loading...';
  const r = await fetch('/api/admin/users?token=' + encodeURIComponent(adminToken));
  const users = await r.json();
  box.innerHTML = '';
  users.forEach(u => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `<img src="${esc(u.avatar || defaultAvatar(u.name))}"/><div class="grow"><b>${esc(u.name)}</b><div style="font-size:12px">${esc(u.host)} · ${esc(u.rank)} · ${u.hacks} hacks</div></div>`;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = u.balance;
    const set = document.createElement('button'); set.className = 'btn-set'; set.textContent = 'set $';
    set.onclick = async () => {
      await fetch('/api/admin/set-balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: adminToken, userId: u.id, balance: Number(inp.value) }) });
      toast('balance updated'); loadAdmin();
    };
    const ban = document.createElement('button'); ban.className = 'btn-ban'; ban.textContent = 'ban';
    ban.onclick = async () => {
      if (!confirm('Ban ' + u.name + '? Their device account resets on next open.')) return;
      await fetch('/api/admin/ban', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: adminToken, userId: u.id }) });
      toast('user banned'); loadAdmin();
    };
    row.append(inp, set, ban);
    box.appendChild(row);
  });
}

/* ---------- ACCOUNT (FREE-tier self-heal: full backup lives on device) ---------- */
function saveBackup() {
  try {
    if (ME) localStorage.setItem('hc_backup', JSON.stringify({
      id: ME.id, name: ME.name, avatar: ME.avatar, host: ME.host,
      openPort: ME.openPort, balance: ME.balance, hacks: ME.hacks,
      createdAt: ME.createdAt, serverPassword: localStorage.getItem('hc_pass') || ''
    }));
  } catch {}
}
function getBackup() {
  try { return JSON.parse(localStorage.getItem('hc_backup') || 'null'); } catch { return null; }
}
async function boot() {
  bootTerm();
  // instant chat from device cache (survives server sleep/wipe)
  try {
    const cached = JSON.parse(localStorage.getItem('hc_chat') || '[]');
    if (cached.length) { $('messages').innerHTML = ''; cached.forEach(addMsg); }
  } catch {}
  // keep free server awake while anyone is online
  setInterval(() => fetch('/api/ping').catch(() => {}), 5 * 60 * 1000);
  let id = localStorage.getItem('hc_id');
  if (id) {
    try {
      const chk = await (await fetch('/api/check/' + id)).json();
      if (chk.banned) {
        ['hc_id', 'hc_backup', 'hc_pass', 'hc_installed'].forEach(k => localStorage.removeItem(k));
        installed = {}; toast('account reset'); $('onboard').classList.remove('hidden'); return;
      }
      if (chk.exists) {
        ME = await (await fetch('/api/me/' + id)).json();
        enterApp(); return;
      }
      // server wiped (free sleep/redeploy) -> silently restore from device backup
      const b = getBackup();
      if (b && b.serverPassword) {
        const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
        const j = await r.json();
        if (!j.error && !j.banned) {
          localStorage.setItem('hc_id', j.id);
          ME = j; saveBackup();
          print(`session restored: ${j.name} @ ${j.host}`, 'ok');
          enterApp(); return;
        }
      }
    } catch {}
  }
  $('onboard').classList.remove('hidden');
}
$('obGo').onclick = async () => {
  const name = $('obName').value.trim() || ('anon' + Math.floor(Math.random() * 9999));
  const pass = $('obPass').value;
  if (pass.length < 3) { toast('server password min 3 chars'); return; }
  const id = localStorage.getItem('hc_id') || (Math.random().toString(16).slice(2) + Date.now().toString(16));
  const r = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, avatar: defaultAvatar(name), serverPassword: pass }) });
  const j = await r.json();
  if (j.banned) { localStorage.removeItem('hc_id'); location.reload(); return; }
  if (j.error) { toast(j.error); return; }
  localStorage.setItem('hc_id', j.id);
  localStorage.setItem('hc_pass', pass);
  ME = j; saveBackup();
  $('onboard').classList.add('hidden');
  print(`identity forged: ${j.name} @ ${j.host}`, 'ok');
  enterApp();
};

async function refreshMe() {
  if (!ME) return;
  try { ME = await (await fetch('/api/me/' + ME.id)).json(); renderMe(); } catch { }
}
function cacheChat() {
  try {
    const items = [...$('messages').children].slice(-60).map(el => el._msg).filter(Boolean);
    localStorage.setItem('hc_chat', JSON.stringify(items));
  } catch {}
}
function renderMe() {
  if (!ME) return;
  saveBackup();
  $('meName').textContent = ME.name;
  $('meHost').textContent = ME.host;
  $('meBalance').textContent = ME.balance;
  $('meAvatar').src = ME.avatar || defaultAvatar(ME.name);
  const r = $('meRank'); r.textContent = rankOf(ME.hacks); r.className = 'rank-badge ' + rankOf(ME.hacks);
  $('selfHostBox').textContent = `server: ${ME.host} · port: ${ME.openPort || '???'} · income ${incomeOf(ME.hacks)}$/10s · ${ME.hacks} hacks`;
}
function enterApp() {
  renderMe();
  socket.emit('presence:online', { userId: ME.id });
  socket.on(`balance:${ME.id}`, ({ balance }) => { ME.balance = balance; $('meBalance').textContent = balance; saveBackup(); });
}

/* ---------- CHAT ---------- */
function msgEl(m) {
  const mine = ME && m.userId === ME.id;
  const d = document.createElement('div');
  d.className = 'msg' + (mine ? ' mine' : '');
  const av = m.avatar || defaultAvatar(m.name);
  d.innerHTML = `<img class="av" src="${esc(av)}"/><div class="bubble"><div class="who">${esc(m.name)} <time>${new Date(m.ts).toLocaleTimeString()}</time></div><div class="text">${esc(m.text)}</div></div>`;
  d.querySelector('.av').onclick = () => openProfile(m.userId);
  d.querySelector('.who').onclick = () => openProfile(m.userId);
  if (m.image) {
    const im = document.createElement('img');
    im.className = 'photo'; im.src = m.image; im.loading = 'lazy';
    d.querySelector('.bubble').appendChild(im);
  }
  if (!m.text) d.querySelector('.text').remove();
  return d;
}
function addMsg(m) {
  const box = $('messages');
  const el = msgEl(m);
  el._msg = { id: m.id, userId: m.userId, name: m.name, avatar: (m.avatar || '').slice(0, 200000), text: m.text, image: (m.image || '').slice(0, 1000000), ts: m.ts };
  box.appendChild(el);
  while (box.children.length > 200) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
  cacheChat();
}
socket.on('chat:history', (arr) => { $('messages').innerHTML = ''; arr.forEach(addMsg); });
socket.on('chat:message', addMsg);
socket.on('users:list', (arr) => {
  usersById = {}; usersByHost = {};
  arr.forEach(u => { usersById[u.id] = u; usersByHost[u.host] = u; });
  $('onlineCount').textContent = arr.length + ' nodes';
  if (ME && usersById[ME.id]) { ME.balance = usersById[ME.id].balance; ME.hacks = usersById[ME.id].hacks; ME.name = usersById[ME.id].name; ME.avatar = usersById[ME.id].avatar; renderMe(); }
});
socket.on('user:banned', ({ id }) => {
  if (ME && id === ME.id) { localStorage.removeItem('hc_id'); toast('you were banned — reloading fresh'); setTimeout(() => location.reload(), 1200); }
});

async function sendText() {
  const t = $('msgInput').value.trim();
  if (!t || !ME) return;
  $('msgInput').value = '';
  socket.emit('chat:message', { userId: ME.id, text: t }, (ack) => { if (ack && ack.error) toast(ack.error); });
}
$('sendBtn').onclick = sendText;
$('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

function fileToDataUrl(file, max = 800) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = img.width * scale; cv.height = img.height * scale;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      res(cv.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = rej;
    img.src = url;
  });
}
$('imgInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f || !ME) return;
  const data = await fileToDataUrl(f);
  socket.emit('chat:message', { userId: ME.id, text: '', image: data });
  e.target.value = '';
};

/* ---------- PROFILE ---------- */
async function openProfile(userId) {
  const u = usersById[userId];
  if (!u) return;
  $('profilePane').classList.remove('hidden');
  $('pfAvatar').src = u.avatar || defaultAvatar(u.name);
  $('pfName').textContent = u.name;
  $('pfRank').textContent = u.rank;
  $('pfHost').textContent = u.host;
  $('pfBalance').textContent = u.balance + '$';
  $('pfHacks').textContent = u.hacks;
  $('pfMining').textContent = incomeOf(u.hacks) + '$/10s';
  const self = ME && userId === ME.id;
  $('pfSelf').classList.toggle('hidden', !self);
  if (self) { $('editName').value = ME.name; $('avatarUrl').value = ''; refreshMe(); }
}
$('profileBack').onclick = () => $('profilePane').classList.add('hidden');
$('myProfileBtn').onclick = () => ME && openProfile(ME.id);
$('mePill').onclick = () => ME && openProfile(ME.id);
$('saveName').onclick = async () => {
  const v = $('editName').value.trim(); if (!v) return;
  await fetch('/api/me/' + ME.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v }) });
  toast('name updated'); refreshMe(); openProfile(ME.id);
};
$('saveAvatar').onclick = async () => {
  const v = $('avatarUrl').value.trim(); if (!v) return;
  await fetch('/api/me/' + ME.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: v }) });
  toast('avatar updated'); refreshMe();
};
$('avatarFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const data = await fileToDataUrl(f, 256);
  await fetch('/api/me/' + ME.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: data }) });
  toast('avatar updated'); refreshMe(); openProfile(ME.id);
};

boot();
