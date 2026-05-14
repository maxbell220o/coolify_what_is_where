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
const LEGACY_FILE = path.join(DATA_DIR, 'services.json');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Migration: alte services.json -> db.json mit Default-Host
if (!fs.existsSync(DB_FILE)) {
  let services = [];
  if (fs.existsSync(LEGACY_FILE)) {
    try { services = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')); } catch {}
  }
  const defaultHost = services.length
    ? [{ id: crypto.randomBytes(6).toString('hex'), name: 'Default', order: 0, createdAt: new Date().toISOString() }]
    : [];
  const hostId = defaultHost[0]?.id;
  fs.writeFileSync(DB_FILE, JSON.stringify({
    hosts: defaultHost,
    services: services.map((s, i) => ({ ...s, hostId, order: i })),
  }, null, 2));
}

// Vom Browser gesperrte unsichere Ports
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
    return { hosts: d.hosts || [], services: d.services || [] };
  } catch { return { hosts: [], services: [] }; }
}
function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
}

// Hübsche, merkbare Ports zuerst. Dann der Rest der 4-stelligen Ports
// (gemischt – beginnend bei "schönen" Zehnerstellen). Erst danach 5-stellige.
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
  // Zuerst Vielfache von 100, 50, 10 – dann der Rest 1024–9999
  const buckets = [
    (p) => p % 100 === 0,
    (p) => p % 50 === 0,
    (p) => p % 10 === 0,
    () => true,
  ];
  for (const test of buckets) {
    for (let p = 1024; p <= 9999; p++) {
      if (seen.has(p) || BLOCKED_PORTS.has(p)) continue;
      if (!test(p)) continue;
      fourDigit.push(p);
      seen.add(p);
    }
  }
  const fiveDigit = [];
  for (let p = 10000; p <= 65535; p++) {
    if (BLOCKED_PORTS.has(p)) continue;
    fiveDigit.push(p);
  }
  return [...preferred, ...fourDigit, ...fiveDigit];
}

const PORT_PRIORITY = buildPortPriority();

async function findFreePort() {
  for (const p of PORT_PRIORITY) {
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

app.get('/api/blocked-ports', (req, res) => {
  res.json([...BLOCKED_PORTS].sort((a, b) => a - b));
});

app.get('/api/free-port', async (req, res) => {
  const port = await findFreePort();
  if (port == null) return res.status(503).json({ error: 'Kein freier Port gefunden' });
  res.json({ port });
});

// === Hosts ===
app.get('/api/hosts', (req, res) => {
  const { hosts } = readDb();
  res.json(hosts.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
});

app.post('/api/hosts', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  const db = readDb();
  const order = db.hosts.length;
  const host = { id: crypto.randomBytes(6).toString('hex'), name, order, createdAt: new Date().toISOString() };
  db.hosts.push(host);
  writeDb(db);
  res.status(201).json(host);
});

app.put('/api/hosts/:id', (req, res) => {
  const db = readDb();
  const h = db.hosts.find((x) => x.id === req.params.id);
  if (!h) return res.status(404).json({ error: 'Nicht gefunden' });
  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name fehlt' });
    h.name = name;
  }
  writeDb(db);
  res.json(h);
});

app.delete('/api/hosts/:id', (req, res) => {
  const db = readDb();
  const idx = db.hosts.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  // alle zugehörigen Dienste mitlöschen (inkl. Bilder)
  const remaining = [];
  for (const s of db.services) {
    if (s.hostId === req.params.id) {
      if (s.image) {
        const f = path.join(__dirname, s.image);
        if (f.startsWith(UPLOAD_DIR) && fs.existsSync(f)) fs.unlinkSync(f);
      }
    } else remaining.push(s);
  }
  db.services = remaining;
  db.hosts.splice(idx, 1);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/hosts/reorder', (req, res) => {
  const order = req.body.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order[] erwartet' });
  const db = readDb();
  order.forEach((id, i) => {
    const h = db.hosts.find((x) => x.id === id);
    if (h) h.order = i;
  });
  writeDb(db);
  res.json({ ok: true });
});

// === Services ===
app.get('/api/services', (req, res) => {
  const { services } = readDb();
  res.json(services.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
});

app.post('/api/services', upload.single('image'), (req, res) => {
  const name = (req.body.name || '').trim();
  const address = (req.body.address || '').trim();
  const port = parseInt(req.body.port, 10);
  const hostId = (req.body.hostId || '').trim();

  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  if (!address) return res.status(400).json({ error: 'Adresse fehlt' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen' });
  }
  if (BLOCKED_PORTS.has(port)) {
    return res.status(400).json({ error: `Port ${port} ist vom Browser gesperrt` });
  }

  const db = readDb();
  if (!hostId || !db.hosts.some((h) => h.id === hostId)) {
    return res.status(400).json({ error: 'Gültiger Host erforderlich' });
  }
  const order = db.services.filter((s) => s.hostId === hostId).length;
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    hostId,
    name, address, port,
    image: req.file ? `/uploads/${req.file.filename}` : null,
    order,
    createdAt: new Date().toISOString(),
  };
  db.services.push(entry);
  writeDb(db);
  res.status(201).json(entry);
});

app.put('/api/services/:id', upload.single('image'), (req, res) => {
  const db = readDb();
  const s = db.services.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Nicht gefunden' });

  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name fehlt' });
    s.name = name;
  }
  if (req.body.address != null) {
    const address = String(req.body.address).trim();
    if (!address) return res.status(400).json({ error: 'Adresse fehlt' });
    s.address = address;
  }
  if (req.body.port != null) {
    const port = parseInt(req.body.port, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen' });
    }
    if (BLOCKED_PORTS.has(port)) {
      return res.status(400).json({ error: `Port ${port} ist vom Browser gesperrt` });
    }
    s.port = port;
  }
  if (req.body.hostId != null) {
    const hostId = String(req.body.hostId).trim();
    if (!db.hosts.some((h) => h.id === hostId)) {
      return res.status(400).json({ error: 'Host unbekannt' });
    }
    s.hostId = hostId;
  }
  if (req.file) {
    if (s.image) {
      const old = path.join(__dirname, s.image);
      if (old.startsWith(UPLOAD_DIR) && fs.existsSync(old)) fs.unlinkSync(old);
    }
    s.image = `/uploads/${req.file.filename}`;
  }
  writeDb(db);
  res.json(s);
});

app.delete('/api/services/:id', (req, res) => {
  const db = readDb();
  const idx = db.services.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  const [removed] = db.services.splice(idx, 1);
  if (removed.image) {
    const f = path.join(__dirname, removed.image);
    if (f.startsWith(UPLOAD_DIR) && fs.existsSync(f)) fs.unlinkSync(f);
  }
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/services/reorder', (req, res) => {
  const order = req.body.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order[] erwartet' });
  const db = readDb();
  order.forEach((id, i) => {
    const s = db.services.find((x) => x.id === id);
    if (s) s.order = i;
  });
  writeDb(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Coolify-Dashboard läuft auf http://0.0.0.0:${PORT}`);
});
