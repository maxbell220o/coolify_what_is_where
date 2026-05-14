const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const LEGACY_SERVICES = path.join(DATA_DIR, 'services.json');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Migration: alte Formate -> flache services-Liste
if (!fs.existsSync(DB_FILE)) {
  let services = [];
  if (fs.existsSync(LEGACY_SERVICES)) {
    try { services = JSON.parse(fs.readFileSync(LEGACY_SERVICES, 'utf8')); } catch {}
  }
  fs.writeFileSync(DB_FILE, JSON.stringify({
    services: services.map((s, i) => ({
      id: s.id || crypto.randomBytes(6).toString('hex'),
      name: s.name || '',
      address: s.address || '',
      port: s.port || 0,
      image: s.image || null,
      description: s.description || '',
      category: s.category || '',
      ownerTokens: [],
      order: i,
      createdAt: s.createdAt || new Date().toISOString(),
    })),
  }, null, 2));
} else {
  // best-effort: vom alten hosts/services-Schema auf flach migrieren
  try {
    const cur = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (cur && Array.isArray(cur.hosts)) {
      const flat = (cur.services || []).map((s, i) => ({
        id: s.id || crypto.randomBytes(6).toString('hex'),
        name: s.name || '',
        address: s.address || '',
        port: s.port || 0,
        image: s.image || null,
        description: s.description || '',
        category: (cur.hosts.find(h => h.id === s.hostId) || {}).name || '',
        ownerTokens: [],
        order: i,
        createdAt: s.createdAt || new Date().toISOString(),
      }));
      fs.writeFileSync(DB_FILE, JSON.stringify({ services: flat }, null, 2));
    }
  } catch {}
}

const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function readDb() {
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { services: d.services || [], manualBlocked: d.manualBlocked || [] };
  } catch { return { services: [], manualBlocked: [] }; }
}
function writeDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// Default-Gateway aus /proc/net/route lesen (= Host-IP in Docker-Bridge).
function detectDefaultGateway() {
  try {
    const txt = fs.readFileSync('/proc/net/route', 'utf8');
    for (const line of txt.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [, dest, gw, flags] = parts;
      if (dest === '00000000' && (parseInt(flags, 16) & 2)) {
        const bytes = gw.match(/../g).reverse().map(h => parseInt(h, 16));
        return bytes.join('.');
      }
    }
  } catch {}
  return null;
}
const AUTO_GW = detectDefaultGateway();
const PROBE_HOSTS = (process.env.PROBE_HOSTS
  || [AUTO_GW, 'host.docker.internal', '172.17.0.1'].filter(Boolean).join(','))
  .split(',').map(s => s.trim()).filter(Boolean);
const PROBE_TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || '700', 10);
console.log('[port-probe] hosts:', PROBE_HOSTS.join(', '));

// "frei" = niemand antwortet UND wir können lokal binden.
function probeConnect(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (result) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(result); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish('in_use'));
    sock.once('timeout', () => finish('unknown'));
    sock.once('error', (e) => {
      // ECONNREFUSED = nichts hört -> frei für diesen Host
      if (e && e.code === 'ECONNREFUSED') return finish('free');
      // EHOSTUNREACH / ENOTFOUND -> Host nicht erreichbar, kein Signal
      finish('unknown');
    });
    sock.connect(port, host);
  });
}

function probeLocalBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve('in_use'));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve('free')));
  });
}

async function isPortFree(port) {
  // Alle Probe-Hosts parallel anpieken
  const results = await Promise.all(PROBE_HOSTS.map(h => probeConnect(h, port, PROBE_TIMEOUT_MS)));
  if (results.some(r => r === 'in_use')) return false;
  // Lokaler Bind-Test als Fallback / zusätzliche Sicherheit
  const local = await probeLocalBind(port);
  if (local === 'in_use') return false;
  // Wenn lokal frei und kein externer Host belegt meldete, gilt frei.
  // "unknown" allein heißt: wir wissen es nicht sicher, also als frei werten.
  return true;
}

function buildPortPriority() {
  const preferred = [
    9000, 8000, 7000, 5000, 4000, 3000,
    8080, 8081, 8443, 8888, 9090, 9999, 5050, 5500, 7777, 6060,
    3001, 3030, 3333, 4040, 4444, 4200, 4321, 5555, 6666, 7070,
    8008, 8800, 9001, 9100, 9200, 9300, 9400, 9500, 9600, 9700, 9800, 9900,
    1234, 2000, 2222, 2500, 2580,
  ].filter((p) => !BLOCKED_PORTS.has(p));
  const seen = new Set(preferred);
  const fourDigit = [];
  const buckets = [
    (p) => p % 1000 === 0,
    (p) => p % 100 === 0,
    (p) => p % 50 === 0,
    (p) => p % 10 === 0,
    () => true,
  ];
  for (const test of buckets) {
    for (let p = 1024; p <= 9999; p++) {
      if (seen.has(p) || BLOCKED_PORTS.has(p)) continue;
      if (!test(p)) continue;
      fourDigit.push(p); seen.add(p);
    }
  }
  const fiveDigit = [];
  for (let p = 10000; p <= 65535; p++) {
    if (!BLOCKED_PORTS.has(p)) fiveDigit.push(p);
  }
  return [...preferred, ...fourDigit, ...fiveDigit];
}
const PORT_PRIORITY = buildPortPriority();

async function findFreePort() {
  const used = new Set(readDb().services.map((s) => s.port));
  for (const p of PORT_PRIORITY) {
    if (used.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
      cb(null, crypto.randomBytes(8).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function getToken(req) {
  return (req.get('X-Owner-Token') || '').trim() || null;
}
function isOwner(service, token) {
  if (!token) return false;
  return Array.isArray(service.ownerTokens) && service.ownerTokens.includes(token);
}
function publicService(s, token) {
  return { ...s, mine: isOwner(s, token), ownerTokens: undefined };
}
function visibleTo(s, token) {
  return !s.hidden || isOwner(s, token);
}

app.get('/api/blocked-ports', (req, res) => {
  res.json([...BLOCKED_PORTS].sort((a, b) => a - b));
});

app.get('/api/check-port', async (req, res) => {
  const port = parseInt(req.query.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Port 1–65535' });
  }
  if (BLOCKED_PORTS.has(port)) return res.json({ ok: false, reason: 'blocked' });
  const used = readDb().services.some((s) => s.port === port);
  if (used) return res.json({ ok: false, reason: 'already_assigned' });
  const free = await isPortFree(port);
  res.json({ ok: free, reason: free ? null : 'in_use' });
});

app.get('/api/free-port', async (req, res) => {
  const port = await findFreePort();
  if (port == null) return res.status(503).json({ error: 'Kein freier Port gefunden' });
  res.json({ port });
});

app.get('/api/services', (req, res) => {
  const token = getToken(req);
  const list = readDb().services
    .slice()
    .filter((s) => visibleTo(s, token))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => publicService(s, token));
  res.json(list);
});

app.get('/api/categories', (req, res) => {
  const cats = [...new Set(readDb().services.map((s) => s.category).filter(Boolean))].sort();
  res.json(cats);
});

app.post('/api/services', upload.single('image'), async (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Owner-Token erforderlich' });

  const name = (req.body.name || '').trim();
  const address = (req.body.address || '').trim();
  const port = parseInt(req.body.port, 10);
  const description = (req.body.description || '').trim();
  const category = (req.body.category || '').trim();
  const hidden = req.body.hidden === '1' || req.body.hidden === 'true';
  const skipFree = req.body.skipFreeCheck === '1';

  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  if (!address) return res.status(400).json({ error: 'Adresse fehlt' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Port muss 1–65535 sein' });
  }
  if (BLOCKED_PORTS.has(port)) {
    return res.status(400).json({ error: `Port ${port} ist gesperrt` });
  }

  const db = readDb();
  if (db.services.some((s) => s.port === port)) {
    return res.status(409).json({ error: `Port ${port} ist schon einem Dienst zugewiesen` });
  }
  if (!skipFree && !(await isPortFree(port))) {
    return res.status(409).json({ error: `Port ${port} ist bereits belegt` });
  }

  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    name, address, port,
    image: req.file ? `/uploads/${req.file.filename}` : null,
    description, category, hidden,
    ownerTokens: [token],
    order: db.services.length,
    createdAt: new Date().toISOString(),
  };
  db.services.push(entry);
  writeDb(db);
  res.status(201).json(publicService(entry, token));
});

app.put('/api/services/:id', upload.single('image'), async (req, res) => {
  const token = getToken(req);
  const db = readDb();
  const s = db.services.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!isOwner(s, token)) return res.status(403).json({ error: 'Nicht dein Dienst' });

  if (req.body.name != null) {
    const v = String(req.body.name).trim();
    if (!v) return res.status(400).json({ error: 'Name fehlt' });
    s.name = v;
  }
  if (req.body.address != null) {
    const v = String(req.body.address).trim();
    if (!v) return res.status(400).json({ error: 'Adresse fehlt' });
    s.address = v;
  }
  if (req.body.description != null) s.description = String(req.body.description).trim();
  if (req.body.category != null) s.category = String(req.body.category).trim();
  if (req.body.hidden != null) s.hidden = (req.body.hidden === '1' || req.body.hidden === 'true');
  if (req.body.port != null) {
    const port = parseInt(req.body.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Port muss 1–65535 sein' });
    }
    if (BLOCKED_PORTS.has(port)) return res.status(400).json({ error: `Port ${port} ist gesperrt` });
    if (port !== s.port) {
      if (db.services.some((x) => x.id !== s.id && x.port === port)) {
        return res.status(409).json({ error: `Port ${port} ist schon zugewiesen` });
      }
      if (req.body.skipFreeCheck !== '1' && !(await isPortFree(port))) {
        return res.status(409).json({ error: `Port ${port} ist bereits belegt` });
      }
    }
    s.port = port;
  }
  if (req.file) {
    if (s.image) {
      const old = path.join(__dirname, s.image);
      if (old.startsWith(UPLOAD_DIR) && fs.existsSync(old)) fs.unlinkSync(old);
    }
    s.image = `/uploads/${req.file.filename}`;
  }
  writeDb(db);
  res.json(publicService(s, token));
});

app.delete('/api/services/:id', (req, res) => {
  const token = getToken(req);
  const db = readDb();
  const idx = db.services.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!isOwner(db.services[idx], token)) return res.status(403).json({ error: 'Nicht dein Dienst' });
  const [removed] = db.services.splice(idx, 1);
  if (removed.image) {
    const f = path.join(__dirname, removed.image);
    if (f.startsWith(UPLOAD_DIR) && fs.existsSync(f)) fs.unlinkSync(f);
  }
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/services/reorder', (req, res) => {
  const token = getToken(req);
  const order = req.body.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order[] erwartet' });
  const db = readDb();
  order.forEach((id, i) => {
    const s = db.services.find((x) => x.id === id);
    if (s && isOwner(s, token)) s.order = i;
  });
  writeDb(db);
  res.json({ ok: true });
});

// Token an einen weiteren Dienst hängen (z.B. wenn man Token von einem anderen
// Gerät kennt und dort auch editieren möchte). Token im Body, Auth über Header.
app.post('/api/services/:id/claim', (req, res) => {
  const myToken = getToken(req);
  const otherToken = (req.body.token || '').trim();
  if (!myToken || !otherToken) return res.status(400).json({ error: 'Tokens fehlen' });
  const db = readDb();
  const s = db.services.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!Array.isArray(s.ownerTokens) || !s.ownerTokens.includes(otherToken)) {
    return res.status(403).json({ error: 'Token passt nicht' });
  }
  if (!s.ownerTokens.includes(myToken)) s.ownerTokens.push(myToken);
  writeDb(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Coolify-Dashboard läuft auf http://0.0.0.0:${PORT}`);
});
