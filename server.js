const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'services.json');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

// Vom Browser (Chrome/Firefox) gesperrte unsichere Ports
const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}
function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreePort(min = 3000, max = 65535) {
  for (let i = 0; i < 200; i++) {
    const candidate = Math.floor(Math.random() * (max - min + 1)) + min;
    if (BLOCKED_PORTS.has(candidate)) continue;
    if (await isPortFree(candidate)) return candidate;
  }
  for (let p = min; p <= max; p++) {
    if (BLOCKED_PORTS.has(p)) continue;
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
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
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

app.get('/api/services', (req, res) => res.json(readDb()));

app.post('/api/services', upload.single('image'), (req, res) => {
  const name = (req.body.name || '').trim();
  const address = (req.body.address || '').trim();
  const port = parseInt(req.body.port, 10);

  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  if (!address) return res.status(400).json({ error: 'Adresse fehlt' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen' });
  }
  if (BLOCKED_PORTS.has(port)) {
    return res.status(400).json({ error: `Port ${port} ist vom Browser gesperrt` });
  }

  const services = readDb();
  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    address,
    port,
    image: req.file ? `/uploads/${req.file.filename}` : null,
    createdAt: new Date().toISOString(),
  };
  services.push(entry);
  writeDb(services);
  res.status(201).json(entry);
});

app.delete('/api/services/:id', (req, res) => {
  const services = readDb();
  const idx = services.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  const [removed] = services.splice(idx, 1);
  if (removed.image) {
    const f = path.join(__dirname, removed.image);
    if (f.startsWith(UPLOAD_DIR) && fs.existsSync(f)) fs.unlinkSync(f);
  }
  writeDb(services);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Coolify-Dashboard läuft auf http://0.0.0.0:${PORT}`);
});
