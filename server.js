const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function defaultData() {
  return { users: {}, messages: [], banned: [], lastMine: Date.now() };
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const d = JSON.parse(raw);
      if (!d.users) d.users = {};
      if (!d.messages) d.messages = [];
      if (!d.banned) d.banned = [];
      if (!d.lastMine) d.lastMine = Date.now();
      return d;
    }
  } catch (e) { console.error('load error', e); }
  return defaultData();
}

// Offline mining catch-up (FREE tier: server sleeps, so pay earnings for time away, capped 12h)
function catchUpMining() {
  const now = Date.now();
  const elapsed = Math.min(12 * 3600 * 1000, Math.max(0, now - (db.lastMine || now)));
  if (elapsed < 10000) return 0;
  const cycles = Math.floor(elapsed / 10000);
  for (const u of Object.values(db.users)) {
    u.balance = Math.min(999999999, u.balance + incomeFor(u.hacks || 0) * cycles);
  }
  db.lastMine = now;
  return cycles;
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error('save error', e); }
  scheduleMongoSave();
}

let db = loadData();

// ---- Optional MongoDB Atlas (zero code changes needed; just set MONGODB_URI) ----
// If MONGODB_URI is set (free Atlas M0), state lives there permanently and
// survives Render free sleep/redeploys. Otherwise file + device-backup fallback.
let mongoCol = null, mongoReady = false, mongoTimer = null;
async function initMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    mongoCol = client.db('hackchat').collection('state');
    const doc = await mongoCol.findOne({ _id: 'main' });
    if (doc) {
      if (doc.users) db.users = doc.users;
      if (doc.messages) db.messages = doc.messages;
      if (doc.banned) db.banned = doc.banned;
      if (doc.lastMine) db.lastMine = doc.lastMine;
      console.log(`MongoDB: loaded ${Object.keys(db.users).length} users, ${db.messages.length} msgs`);
    } else {
      console.log('MongoDB: connected, fresh state');
    }
    mongoReady = true;
  } catch (e) { console.error('MongoDB init failed, using file fallback:', e.message); }
}
function scheduleMongoSave() {
  if (!mongoReady || !mongoCol) return;
  clearTimeout(mongoTimer);
  mongoTimer = setTimeout(async () => {
    try {
      await mongoCol.updateOne({ _id: 'main' },
        { $set: { users: db.users, messages: db.messages.slice(-300), banned: db.banned, lastMine: db.lastMine } },
        { upsert: true });
    } catch (e) { console.error('MongoDB save failed:', e.message); }
  }, 1500);
}
initMongo().then(() => { catchUpMining(); saveData(); });

function genId() {
  return crypto.randomBytes(12).toString('hex');
}

function genHost() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  let host;
  do { host = `HC-${part(4)}-${part(4)}`; }
  while (Object.values(db.users).some(u => u.host === host));
  return host;
}

function genPort() {
  const used = new Set(Object.values(db.users).map(u => String(u.openPort)));
  let p;
  do { p = String(Math.floor(1000 + Math.random() * 9000)); }
  while (used.has(p));
  return p;
}

function getRank(hacks) {
  if (hacks >= 10) return 'legend';
  if (hacks >= 7) return 'elite';
  if (hacks >= 5) return 'gold';
  if (hacks >= 3) return 'silver';
  if (hacks >= 1) return 'bronze';
  return 'rookie';
}

function incomeFor(hacks) {
  const r = getRank(hacks);
  if (r === 'legend') return 50;
  if (r === 'elite') return 38;
  if (r === 'gold') return 28;
  if (r === 'silver') return 18;
  if (r === 'bronze') return 10;
  return 5;
}

function publicUser(u) {
  return {
    id: u.id, name: u.name, avatar: u.avatar, host: u.host,
    balance: u.balance, hacks: u.hacks, rank: getRank(u.hacks),
    createdAt: u.createdAt, online: !!u.online
  };
}

function hackDuration(pw) {
  let d = 10;
  const hasSymbol = /[^A-Za-z0-9]/.test(pw || '');
  const hasDigit = /\d/.test(pw || '');
  if (hasSymbol) d = 30;
  if (hasDigit) d += 30;
  return d;
}

// ---------- REST ----------

app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/account', (req, res) => {
  let { id, name, avatar, serverPassword, host, openPort, balance, hacks, createdAt } = req.body || {};
  if (id && db.banned.includes(id)) {
    return res.status(403).json({ banned: true });
  }
  if (id && db.users[id]) {
    const u = db.users[id];
    if (name) u.name = String(name).slice(0, 24);
    if (avatar !== undefined) u.avatar = String(avatar).slice(0, 500000);
    saveData();
    return res.json({ ...publicUser(u), openPort: u.openPort, host: u.host, isNew: false });
  }
  // new account requires serverPassword
  if (!serverPassword || String(serverPassword).length < 3) {
    return res.status(400).json({ error: 'PASSWORD_REQUIRED' });
  }
  const newId = id || genId();
  if (db.banned.includes(newId)) return res.status(403).json({ banned: true });
  // FREE-tier self-heal: accept client's backup (host/port/balance/hacks) if still free
  const hostsTaken = new Set(Object.values(db.users).map(u => u.host));
  const portsTaken = new Set(Object.values(db.users).map(u => String(u.openPort)));
  let useHost = genHost();
  if (host && /^HC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(String(host)) && !hostsTaken.has(String(host))) useHost = String(host);
  let usePort = genPort();
  if (openPort && /^\d{4}$/.test(String(openPort)) && !portsTaken.has(String(openPort))) usePort = String(openPort);
  const user = {
    id: newId,
    name: String(name || 'anon' + Math.floor(Math.random() * 9999)).slice(0, 24),
    avatar: avatar ? String(avatar).slice(0, 500000) : '',
    host: useHost,
    openPort: usePort,
    serverPassword: String(serverPassword).slice(0, 64),
    balance: Math.max(0, Math.min(999999999, Number(balance) || 20)),
    hacks: Math.max(0, Math.min(999, Math.floor(Number(hacks) || 0))),
    createdAt: Number(createdAt) || Date.now(),
    online: false
  };
  db.users[newId] = user;
  saveData();
  io.emit('users:list', Object.values(db.users).map(publicUser));
  res.json({ ...publicUser(user), openPort: user.openPort, isNew: true });
});

app.get('/api/check/:id', (req, res) => {
  const id = req.params.id;
  if (db.banned.includes(id)) return res.json({ banned: true });
  const u = db.users[id];
  if (!u) return res.json({ exists: false });
  res.json({ banned: false, exists: true });
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(db.users).map(publicUser));
});

app.get('/api/me/:id', (req, res) => {
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  if (db.banned.includes(u.id)) return res.status(403).json({ banned: true });
  res.json({ ...publicUser(u), openPort: u.openPort });
});

app.put('/api/me/:id', (req, res) => {
  const u = db.users[req.params.id];
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  const { name, avatar } = req.body || {};
  if (name) u.name = String(name).slice(0, 24);
  if (avatar !== undefined) u.avatar = String(avatar).slice(0, 500000);
  saveData();
  io.emit('users:list', Object.values(db.users).map(publicUser));
  res.json(publicUser(u));
});

app.get('/api/messages', (req, res) => {
  res.json(db.messages.slice(-200));
});

app.post('/api/scan', (req, res) => {
  const { host } = req.body || {};
  if (!host) return res.status(400).json({ error: 'HOST_REQUIRED' });
  const target = Object.values(db.users).find(u => u.host.toLowerCase() === String(host).trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'HOST_NOT_FOUND' });
  const total = 4 + Math.floor(Math.random() * 3); // 4-6
  const ports = [];
  const used = new Set([String(target.openPort)]);
  ports.push({ port: String(target.openPort), status: 'open' });
  while (ports.length < total) {
    const p = String(Math.floor(1000 + Math.random() * 9000));
    if (used.has(p)) continue;
    used.add(p);
    ports.push({ port: p, status: 'closed' });
  }
  // shuffle
  for (let i = ports.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ports[i], ports[j]] = [ports[j], ports[i]];
  }
  res.json({ host: target.host, username: target.name, ports });
});

app.post('/api/bruce-init', (req, res) => {
  const { port } = req.body || {};
  if (!port) return res.status(400).json({ error: 'PORT_REQUIRED' });
  const target = Object.values(db.users).find(u => String(u.openPort) === String(port).trim());
  if (!target) return res.status(404).json({ error: 'PORT_NOT_FOUND' });
  const duration = hackDuration(target.serverPassword);
  res.json({ host: target.host, username: target.name, duration });
});

app.post('/api/bruce-reveal', (req, res) => {
  const { port } = req.body || {};
  const target = Object.values(db.users).find(u => String(u.openPort) === String(port).trim());
  if (!target) return res.status(404).json({ error: 'PORT_NOT_FOUND' });
  res.json({ host: target.host, username: target.name, password: target.serverPassword });
});

function parsePath(p) {
  // HOST/PORT/core/USERNAME  (username may contain spaces? use last segment as name)
  if (!p) return null;
  const parts = String(p).trim().split('/');
  if (parts.length < 4) return null;
  // find 'core' index
  const ci = parts.findIndex(s => s.toLowerCase() === 'core');
  if (ci < 2) return null;
  const port = parts[ci - 1];
  const host = parts.slice(0, ci - 1).join('/');
  const username = parts.slice(ci + 1).join('/');
  return { host, port, username };
}

app.post('/api/server-auth', (req, res) => {
  const { path: p, password } = req.body || {};
  const parsed = parsePath(p);
  if (!parsed) return res.status(400).json({ error: 'BAD_PATH' });
  const target = Object.values(db.users).find(u => u.host.toLowerCase() === parsed.host.trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'HOST_NOT_FOUND' });
  if (String(target.openPort) !== String(parsed.port).trim()) return res.status(404).json({ error: 'PORT_NOT_FOUND' });
  if (String(target.serverPassword) !== String(password)) return res.status(401).json({ error: 'WRONG_PASSWORD' });
  res.json({ host: target.host, username: target.name, balance: target.balance });
});

app.post('/api/transfer', (req, res) => {
  const { fromHost, toHost, byId } = req.body || {};
  const from = Object.values(db.users).find(u => u.host.toLowerCase() === String(fromHost || '').trim().toLowerCase());
  const to = Object.values(db.users).find(u => u.host.toLowerCase() === String(toHost || '').trim().toLowerCase());
  if (!from) return res.status(404).json({ error: 'FROM_NOT_FOUND' });
  if (!to) return res.status(404).json({ error: 'TO_NOT_FOUND' });
  const amount = from.balance;
  to.balance += amount;
  from.balance = 0;
  if (byId && db.users[byId]) db.users[byId].hacks += 1;
  saveData();
  io.emit('users:list', Object.values(db.users).map(publicUser));
  res.json({ moved: amount, from: publicUser(from), to: publicUser(to) });
});

app.post('/api/leak', (req, res) => {
  const { fromHost, byId } = req.body || {};
  const from = Object.values(db.users).find(u => u.host.toLowerCase() === String(fromHost || '').trim().toLowerCase());
  if (!from) return res.status(404).json({ error: 'FROM_NOT_FOUND' });
  from.balance = 0;
  if (byId && db.users[byId]) db.users[byId].hacks += 1;
  saveData();
  io.emit('users:list', Object.values(db.users).map(publicUser));
  res.json({ ok: true, from: publicUser(from) });
});

// ---- admin (password verified server-side, never shipped to client) ----
const ADMIN_PASSWORD = 'adminsonly';
const ADMIN_TOKEN = 'hc-admin-' + crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 16);

app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body || {};
  if (String(password) === ADMIN_PASSWORD) return res.json({ token: ADMIN_TOKEN });
  res.status(401).json({ error: 'WRONG_PASSWORD' });
});

function needAdmin(req, res, next) {
  const t = req.headers['x-admin-token'] || (req.body && req.body.token) || req.query.token;
  if (t !== ADMIN_TOKEN) return res.status(403).json({ error: 'FORBIDDEN' });
  next();
}

app.get('/api/admin/users', needAdmin, (req, res) => {
  res.json(Object.values(db.users).map(u => ({ ...publicUser(u), openPort: u.openPort })));
});

app.post('/api/admin/set-balance', needAdmin, (req, res) => {
  const { userId, balance } = req.body || {};
  const u = db.users[userId];
  if (!u) return res.status(404).json({ error: 'NOT_FOUND' });
  u.balance = Math.max(0, Math.min(999999999, Number(balance) || 0));
  saveData();
  io.emit('users:list', Object.values(db.users).map(publicUser));
  res.json(publicUser(u));
});

app.post('/api/admin/ban', needAdmin, (req, res) => {
  const { userId } = req.body || {};
  const u = db.users[userId];
  if (u) {
    delete db.users[userId];
    io.emit('user:banned', { id: userId });
  }
  if (!db.banned.includes(userId)) db.banned.push(userId);
  saveData();
  io.emit('users:list', Object.values(db.users).map(publicUser));
  res.json({ ok: true });
});

// ---------- sockets ----------
io.on('connection', (socket) => {
  socket.emit('chat:history', db.messages.slice(-200));
  socket.emit('users:list', Object.values(db.users).map(publicUser));

  socket.on('presence:online', ({ userId }) => {
    const u = db.users[userId];
    if (u) {
      u.online = true;
      socket.data.userId = userId;
      io.emit('users:list', Object.values(db.users).map(publicUser));
    }
  });

  socket.on('chat:message', (payload, ack) => {
    try {
      const { userId, text, image } = payload || {};
      const u = db.users[userId];
      if (!u) { if (ack) ack({ error: 'NO_USER' }); return; }
      if (db.banned.includes(userId)) { if (ack) ack({ error: 'BANNED' }); return; }
      const msg = {
        id: genId(),
        userId: u.id,
        name: u.name,
        avatar: u.avatar,
        text: String(text || '').slice(0, 1000),
        image: image ? String(image).slice(0, 4000000) : '',
        ts: Date.now()
      };
      if (!msg.text && !msg.image) { if (ack) ack({ error: 'EMPTY' }); return; }
      db.messages.push(msg);
      if (db.messages.length > 300) db.messages = db.messages.slice(-300);
      saveData();
      io.emit('chat:message', msg);
      if (ack) ack({ ok: true, msg });
    } catch (e) { if (ack) ack({ error: 'FAILED' }); }
  });

  socket.on('disconnect', () => {
    const id = socket.data.userId;
    if (id && db.users[id]) {
      // keep online true briefly — mark offline after 30s unless reconnected
      setTimeout(() => { /* simple: leave online */ }, 1000);
    }
  });
});

// mining tick every 10s (with catch-up timestamp so FREE sleep doesn't eat earnings)
db.lastMine = db.lastMine || Date.now();
catchUpMining();
saveData();
setInterval(() => {
  let changed = false;
  const now = Date.now();
  const cycles = Math.max(1, Math.floor((now - (db.lastMine || now)) / 10000));
  const pay = Math.min(cycles, 6); // cap per tick to avoid spikes after long sleep
  for (const u of Object.values(db.users)) {
    u.balance += incomeFor(u.hacks || 0) * pay;
    if (u.balance > 999999999) u.balance = 999999999;
    changed = true;
  }
  db.lastMine = now;
  if (changed) {
    saveData();
    io.emit('users:list', Object.values(db.users).map(publicUser));
    // personal pings
    for (const u of Object.values(db.users)) {
      io.emit(`balance:${u.id}`, { balance: u.balance, income: incomeFor(u.hacks || 0) });
    }
  }
}, 10000);

setInterval(saveData, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`HackChat on :${PORT}`));
