import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import multer from 'multer';
import path from 'path';
import Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_NAME_LENGTH = 500;
const MAX_URL_LENGTH = 2000;

// --- Database Setup ---
const db = new Database('grocery.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    name_de TEXT,
    brand TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    ideal_stock INTEGER DEFAULT 0,
    last_updated TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    barcode TEXT NOT NULL,
    scanned_in TEXT DEFAULT (datetime('now')),
    scanned_out TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory(barcode);
  CREATE INDEX IF NOT EXISTS idx_inventory_active ON inventory(barcode, scanned_out);
`);

// Add store column if missing
try {
  db.prepare("SELECT store FROM products LIMIT 0").get();
} catch {
  db.exec("ALTER TABLE products ADD COLUMN store TEXT DEFAULT ''");
}

// --- Product Groups ---
db.exec(`
  CREATE TABLE IF NOT EXISTS product_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_de TEXT,
    image_url TEXT DEFAULT '',
    ideal_stock INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// --- Audit Log ---
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    product_name TEXT,
    barcode TEXT,
    product_id INTEGER,
    quantity INTEGER,
    old_quantity INTEGER,
    store TEXT,
    device TEXT,
    browser TEXT,
    os TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_barcode ON audit_log(barcode);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
`);

// Add columns if missing (migrations)
try { db.prepare("SELECT browser FROM audit_log LIMIT 0").get(); } catch {
  db.exec("ALTER TABLE audit_log ADD COLUMN browser TEXT");
  db.exec("ALTER TABLE audit_log ADD COLUMN os TEXT");
}
try { db.prepare("SELECT quantity FROM audit_log LIMIT 0").get(); } catch {
  db.exec("ALTER TABLE audit_log ADD COLUMN quantity INTEGER");
  db.exec("ALTER TABLE audit_log ADD COLUMN store TEXT");
}
try { db.prepare("SELECT product_id FROM audit_log LIMIT 0").get(); } catch {
  db.exec("ALTER TABLE audit_log ADD COLUMN product_id INTEGER");
  db.exec("ALTER TABLE audit_log ADD COLUMN old_quantity INTEGER");
}

// --- Manual Shopping List Items ---
db.exec(`
  CREATE TABLE IF NOT EXISTS shopping_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    store TEXT DEFAULT '',
    checked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// --- Alexa Widget Config ---
db.exec(`
  CREATE TABLE IF NOT EXISTS alexa_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Add group_id column if missing
try {
  db.prepare("SELECT group_id FROM products LIMIT 0").get();
} catch {
  db.exec("ALTER TABLE products ADD COLUMN group_id INTEGER REFERENCES product_groups(id)");
}

// --- Middleware ---
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || 'http://localhost:3000',
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen, bitte später erneut versuchen' }
});
app.use('/api/', apiLimiter);

// --- Authentication ---
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || '';
const LOCAL_SUBNETS = (process.env.LOCAL_SUBNETS || '192.168.,10.').split(',');
const authTokens = new Set();

// Number of trusted proxy hops (Caddy -> nginx = 2)
const trustProxy = Number(process.env.TRUST_PROXY) || 2;
app.set('trust proxy', trustProxy);

function isLocalNetwork(ip) {
  const normalized = ip.replace(/^::ffff:/, '');
  if (normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost') return true;
  return LOCAL_SUBNETS.some(subnet => normalized.startsWith(subnet));
}

function isRequestLocal(req) {
  // Check all IPs in the proxy chain — if any hop is external, treat as external
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    if (ips.some(ip => !isLocalNetwork(ip))) return false;
  }
  return isLocalNetwork(req.ip);
}

function authMiddleware(req, res, next) {
  if (!AUTH_PASSWORD) return next();

  const local = isRequestLocal(req);
  console.log(`Auth: ip=${req.ip}, x-forwarded-for=${req.headers['x-forwarded-for']}, local=${local}`);

  if (local) return next();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && authTokens.has(token)) return next();

  // Allow external API key auth
  const apiKey = req.headers['x-api-key'];
  if (apiKey && EXTERNAL_API_KEY && apiKey === EXTERNAL_API_KEY) return next();

  return res.status(401).json({ error: 'Nicht autorisiert' });
}

// Login endpoint (no auth required)
app.post('/api/auth/login', (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.json({ token: 'none', message: 'Keine Authentifizierung erforderlich' });
  }

  const { password } = req.body;
  if (!password || password !== AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  authTokens.add(token);
  res.json({ token });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
  if (!AUTH_PASSWORD) return res.json({ authenticated: true, local: true });
  if (isRequestLocal(req)) return res.json({ authenticated: true, local: true });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && authTokens.has(token)) return res.json({ authenticated: true, local: false });

  return res.json({ authenticated: false, local: false });
});

// Apply auth to all API routes except login/status
app.use('/api/', authMiddleware);
app.use('/uploads', authMiddleware);

// --- Audit Logging ---
const insertAuditLog = db.prepare(
  'INSERT INTO audit_log (action, details, product_name, barcode, product_id, quantity, old_quantity, store, device, browser, os, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

function parseUA(req) {
  const ua = req.headers['user-agent'] || '';

  // Device
  let device = req.headers['x-device-name'] || '';
  if (!device) {
    if (/iPhone/.test(ua)) device = 'iPhone';
    else if (/iPad/.test(ua)) device = 'iPad';
    else if (/Android/.test(ua)) {
      const m = ua.match(/Android[^;]*;\s*([^)]+)\)/);
      device = m ? m[1].trim() : 'Android';
    }
    else if (/Macintosh/.test(ua)) device = 'Mac';
    else if (/Windows/.test(ua)) device = 'Windows PC';
    else if (/Linux/.test(ua)) device = 'Linux';
    else device = 'Unbekannt';
  }

  // Browser
  let browser = '';
  if (/EdgA?\/(\d+[\d.]*)/.test(ua)) browser = 'Edge ' + ua.match(/EdgA?\/(\d+[\d.]*)/)[1];
  else if (/SamsungBrowser\/(\d+[\d.]*)/.test(ua)) browser = 'Samsung ' + ua.match(/SamsungBrowser\/(\d+[\d.]*)/)[1];
  else if (/OPR\/(\d+[\d.]*)/.test(ua)) browser = 'Opera ' + ua.match(/OPR\/(\d+[\d.]*)/)[1];
  else if (/CriOS\/(\d+[\d.]*)/.test(ua)) browser = 'Chrome ' + ua.match(/CriOS\/(\d+[\d.]*)/)[1];
  else if (/FxiOS\/(\d+[\d.]*)/.test(ua)) browser = 'Firefox ' + ua.match(/FxiOS\/(\d+[\d.]*)/)[1];
  else if (/Chrome\/(\d+[\d.]*)/.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome ' + ua.match(/Chrome\/(\d+[\d.]*)/)[1];
  else if (/Version\/(\d+[\d.]*).*Safari/.test(ua)) browser = 'Safari ' + ua.match(/Version\/(\d+[\d.]*)/)[1];
  else if (/Firefox\/(\d+[\d.]*)/.test(ua)) browser = 'Firefox ' + ua.match(/Firefox\/(\d+[\d.]*)/)[1];

  // OS
  let os = '';
  if (/iPhone OS (\d+[_\d]*)/.test(ua)) os = 'iOS ' + ua.match(/iPhone OS (\d+[_\d]*)/)[1].replace(/_/g, '.');
  else if (/iPad.*OS (\d+[_\d]*)/.test(ua)) os = 'iPadOS ' + ua.match(/OS (\d+[_\d]*)/)[1].replace(/_/g, '.');
  else if (/Android (\d+[\d.]*)/.test(ua)) os = 'Android ' + ua.match(/Android (\d+[\d.]*)/)[1];
  else if (/Mac OS X (\d+[_\d.]*)/.test(ua)) os = 'macOS ' + ua.match(/Mac OS X (\d+[_\d.]*)/)[1].replace(/_/g, '.');
  else if (/Windows NT (\d+\.\d+)/.test(ua)) {
    const nt = ua.match(/Windows NT (\d+\.\d+)/)[1];
    const winMap = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    os = 'Windows ' + (winMap[nt] || nt);
  }
  else if (/Linux/.test(ua)) os = 'Linux';

  return { device, browser, os };
}

function logAction(req, action, details, { productName, barcode, productId, quantity, oldQuantity, store } = {}) {
  try {
    const { device, browser, os } = parseUA(req);
    const ip = (req.headers['x-real-ip'] || req.ip || '').replace(/^::ffff:/, '');
    insertAuditLog.run(
      action, details || null, productName || null, barcode || null,
      productId || null, quantity ?? null, oldQuantity ?? null, store || null,
      device, browser || null, os || null, ip
    );
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

// Serve uploaded images
const UPLOADS_DIR = 'uploads';
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR);
}
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Validation Helpers ---
function isValidBarcode(barcode) {
  return typeof barcode === 'string' && /^[\d]{4,14}$/.test(barcode.trim());
}

function sanitizeString(str, maxLength = MAX_NAME_LENGTH) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

function isValidImageUrl(url) {
  if (!url) return true; // optional field
  if (url.startsWith('/uploads/')) return true; // local upload
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// --- Multer Setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilddateien erlaubt'));
    }
  }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  }
  res.json({ image_url: `/uploads/${req.file.filename}` });
});

// --- Image Recognition ---
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || '';
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || '';
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';

app.post('/api/recognize', upload.single('image'), async (req, res) => {
  if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT) {
    return res.status(501).json({ error: 'Bilderkennung nicht konfiguriert' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Kein Bild hochgeladen' });
  }

  try {
    const { readFileSync } = await import('fs');
    const imageBuffer = readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const url = `${AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': AZURE_OPENAI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Identify this grocery/household product from the image. Return ONLY a JSON object with these fields: {"name": "product name in original language", "name_de": "German name or null", "brand": "brand name or empty string"}. No markdown, no explanation, just the JSON.'
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` }
              }
            ]
          }
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Azure OpenAI API error:', err);
      return res.status(502).json({ error: 'Bilderkennung fehlgeschlagen' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    // Parse JSON from response, stripping markdown fences if present
    const jsonStr = content.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
    const result = JSON.parse(jsonStr);

    res.json({
      name: sanitizeString(result.name) || '',
      name_de: sanitizeString(result.name_de) || null,
      brand: sanitizeString(result.brand) || '',
      image_url: `/uploads/${req.file.filename}`,
    });
  } catch (error) {
    console.error('Recognition error:', error);
    res.status(500).json({ error: 'Bilderkennung fehlgeschlagen' });
  }
});

// --- Translation ---
async function translateToGerman(text) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|de`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      const translated = data.responseData.translatedText;
      if (translated.toLowerCase().trim() === text.toLowerCase().trim()) {
        return null;
      }
      return translated;
    }
    return null;
  } catch (error) {
    console.error('Translation failed:', error);
    return null;
  }
}

// --- MongoDB Product Lookup ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DBS = (process.env.MONGO_DBS || 'off,opf,opff').split(',').map(s => s.trim());
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || 'products';

const mongoClient = new MongoClient(MONGO_URI);
let mongoCollections = [];

async function connectMongo() {
  await mongoClient.connect();
  mongoCollections = MONGO_DBS.map(dbName => mongoClient.db(dbName).collection(MONGO_COLLECTION));
  console.log(`Connected to MongoDB (databases: ${MONGO_DBS.join(', ')})`);
}

connectMongo().catch(err => {
  console.error('MongoDB connection failed:', err.message);
  process.exit(1);
});

async function lookupProduct(barcode) {
  try {
    let doc = null;
    for (const collection of mongoCollections) {
      doc = await collection.findOne({ code: barcode });
      if (doc) break;
    }
    if (!doc) {
      console.log(`MongoDB: no document found for code "${barcode}"`);
      return null;
    }

    console.log(`MongoDB: found document for code "${barcode}", product_name="${doc.product_name}", brands="${doc.brands}"`);

    const name = sanitizeString(doc.product_name)
      || sanitizeString(doc.product_name_es)
      || sanitizeString(doc.product_name_en)
      || sanitizeString(doc.product_name_de)
      || sanitizeString(doc.product_name_xx)
      || '';
    if (!name) {
      console.log(`MongoDB: document for "${barcode}" has no product_name in any language, skipping`);
      return null;
    }

    let name_de = null;
    if (doc.product_name_de && doc.product_name_de !== name) {
      name_de = sanitizeString(doc.product_name_de);
    } else {
      name_de = await translateToGerman(name);
    }

    const imageUrl = getImageUrl(doc);

    return {
      barcode,
      name,
      name_de: name_de || null,
      brand: sanitizeString(doc.brands) || '',
      image_url: isValidImageUrl(imageUrl) ? sanitizeString(imageUrl, MAX_URL_LENGTH) : ''
    };
  } catch (err) {
    console.error('MongoDB lookup error:', err.message);
    return null;
  }
}

function getImageUrl(doc) {
  const front = doc.images?.selected?.front;
  if (!front) return '';

  // Pick the first available language variant
  const lang = Object.keys(front)[0];
  if (!lang) return '';

  const entry = front[lang];
  if (!entry?.imgid || !entry?.rev) return '';

  // Build the barcode path: 13-digit codes split as 000/010/120/9159
  const code = doc.code || '';
  let barcodePath;
  if (code.length > 8) {
    barcodePath = `${code.slice(0, 3)}/${code.slice(3, 6)}/${code.slice(6, 9)}/${code.slice(9)}`;
  } else {
    barcodePath = code;
  }

  return `https://images.openfoodfacts.org/images/products/${barcodePath}/front_${lang}.${entry.rev}.400.jpg`;
}

// --- Prepared Statements ---
const stmts = {
  getProduct: db.prepare('SELECT * FROM products WHERE barcode = ?'),
  insertProduct: db.prepare(`
    INSERT INTO products (barcode, name, name_de, brand, image_url, ideal_stock, store)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  updateProduct: db.prepare(`
    UPDATE products SET name = ?, name_de = ?, brand = ?, image_url = ?, ideal_stock = ?, store = ?, last_updated = datetime('now')
    WHERE barcode = ?
  `),
  insertInventory: db.prepare(`
    INSERT INTO inventory (product_id, barcode) VALUES (?, ?)
  `),
  getActiveItems: db.prepare(`
    SELECT id FROM inventory WHERE barcode = ? AND scanned_out IS NULL ORDER BY scanned_in ASC
  `),
  scanOut: db.prepare(`
    UPDATE inventory SET scanned_out = datetime('now') WHERE id = ?
  `),
  getInventory: db.prepare(`
    SELECT 
      p.id, p.barcode, p.name, p.name_de, p.brand, p.image_url, p.ideal_stock, p.store, p.group_id,
      g.name as group_name, g.name_de as group_name_de, g.image_url as group_image_url, g.ideal_stock as group_ideal_stock,
      COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as quantity,
      MIN(i.scanned_in) as first_added,
      MAX(i.scanned_in) as last_added
    FROM products p
    INNER JOIN inventory i ON p.barcode = i.barcode
    LEFT JOIN product_groups g ON p.group_id = g.id
    GROUP BY p.barcode
    ORDER BY last_added DESC
  `),
  scanOutAll: db.prepare(`
    UPDATE inventory SET scanned_out = datetime('now')
    WHERE barcode = ? AND scanned_out IS NULL
  `),
  deleteProduct: db.prepare(`
    DELETE FROM products WHERE barcode = ?
  `),
  deleteInventory: db.prepare(`
    DELETE FROM inventory WHERE barcode = ?
  `),
  countActive: db.prepare(`
    SELECT COUNT(*) as count FROM inventory WHERE barcode = ? AND scanned_out IS NULL
  `),
  setIdealStock: db.prepare(`
    UPDATE products SET ideal_stock = ?, last_updated = datetime('now') WHERE barcode = ?
  `),
  getShoppingList: db.prepare(`
    SELECT 
      p.id, p.barcode, p.name, p.name_de, p.brand, p.image_url, p.ideal_stock, p.store, p.group_id,
      g.name as group_name, g.name_de as group_name_de, g.image_url as group_image_url, g.ideal_stock as group_ideal_stock,
      COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as current_stock
    FROM products p
    LEFT JOIN inventory i ON p.barcode = i.barcode
    LEFT JOIN product_groups g ON p.group_id = g.id
    WHERE p.ideal_stock > 0
    GROUP BY p.barcode
    HAVING current_stock < p.ideal_stock
    ORDER BY COALESCE(p.name_de, p.name) COLLATE NOCASE
  `),
};

// --- SSE for real-time multi-user sync ---
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastChange() {
  const data = `data: ${JSON.stringify({ type: 'inventory-changed', ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
  debouncedAlexaPush();
}

// --- Alexa Widget DataStore Push ---
const ALEXA_CLIENT_ID = process.env.ALEXA_CLIENT_ID || '';
const ALEXA_CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET || '';
const MAX_WIDGET_ITEMS = 12;

let alexaPushTimer = null;
function debouncedAlexaPush() {
  if (!ALEXA_CLIENT_ID || !ALEXA_CLIENT_SECRET) return;
  if (alexaPushTimer) clearTimeout(alexaPushTimer);
  alexaPushTimer = setTimeout(() => pushAlexaWidget().catch(() => {}), 2000);
}

function getAlexaConfig(key) {
  const row = db.prepare('SELECT value FROM alexa_config WHERE key = ?').get(key);
  return row?.value || '';
}

function setAlexaConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO alexa_config (key, value) VALUES (?, ?)').run(key, value);
}

async function getDataStoreToken() {
  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(ALEXA_CLIENT_ID)}&client_secret=${encodeURIComponent(ALEXA_CLIENT_SECRET)}&scope=alexa::datastore`;
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token error: ${res.status}`);
  const data = await res.json();
  return `${data.token_type} ${data.access_token}`;
}

function buildWidgetData(manual, auto, total) {
  const lines = [];
  for (const i of manual) {
    const icon = i.checked ? '[x] ' : '[ ] ';
    const qty = (i.quantity || 1) > 1 ? `${i.quantity}x ` : '';
    lines.push(icon + qty + i.name);
  }
  for (const i of auto) {
    const qty = (i.needed || 1) > 1 ? `${i.needed}x ` : '';
    lines.push('- ' + qty + i.name);
  }
  const moreCount = Math.max(0, lines.length - MAX_WIDGET_ITEMS);
  const result = { total, lineCount: Math.min(lines.length, MAX_WIDGET_ITEMS), moreCount };
  for (let idx = 0; idx < MAX_WIDGET_ITEMS; idx++) {
    result[`line${idx}`] = idx < lines.length ? lines[idx] : '';
  }
  return result;
}

async function pushAlexaWidget() {
  const userId = getAlexaConfig('alexa_user_id');
  const apiEndpoint = getAlexaConfig('alexa_api_endpoint') || 'https://api.eu.amazonalexa.com';
  if (!userId) return;

  // Fetch shopping list using same logic as /api/external/shopping-list
  const manual = db.prepare(
    'SELECT id, name, quantity, checked, store FROM shopping_list_items WHERE checked = 0 ORDER BY created_at DESC'
  ).all().map(i => ({ ...i, source: 'manual' }));

  const allProducts = db.prepare(`
    SELECT 
      p.name, p.name_de, p.ideal_stock, p.group_id,
      g.name_de as group_name_de, g.ideal_stock as group_ideal_stock,
      COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as current_stock
    FROM products p
    LEFT JOIN inventory i ON p.barcode = i.barcode
    LEFT JOIN product_groups g ON p.group_id = g.id
    GROUP BY p.barcode
  `).all();

  const autoItems = [];
  const processedGroups = new Set();
  for (const item of allProducts) {
    if (item.group_id) {
      if (processedGroups.has(item.group_id)) continue;
      processedGroups.add(item.group_id);
      const members = allProducts.filter(p => p.group_id === item.group_id);
      const totalStock = members.reduce((sum, m) => sum + m.current_stock, 0);
      const ideal = item.group_ideal_stock || 0;
      if (ideal > 0 && totalStock < ideal) {
        autoItems.push({ name: item.group_name_de || item.name_de || item.name, needed: ideal - totalStock });
      }
    } else if (item.ideal_stock > 0 && item.current_stock < item.ideal_stock) {
      autoItems.push({ name: item.name_de || item.name, needed: item.ideal_stock - item.current_stock });
    }
  }

  const total = manual.length + autoItems.length;
  const widgetData = buildWidgetData(manual, autoItems, total);
  const authHeader = await getDataStoreToken();

  const dsHost = new URL(apiEndpoint).hostname;
  const payload = JSON.stringify({
    commands: [
      { type: 'PUT_OBJECT', namespace: 'SHOPPING_LIST', key: 'listData', content: widgetData },
    ],
    target: { type: 'USER', id: userId },
  });

  const res = await fetch(`https://${dsHost}/v1/datastore/commands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    },
    body: payload,
  });
  if (!res.ok) console.error('Alexa DataStore push error:', res.status, await res.text());
}

// --- API Routes ---

// Product lookup
app.post('/api/products/lookup', async (req, res) => {
  const barcode = req.body.barcode?.trim();
  
  if (!barcode) {
    return res.status(400).json({ error: 'Barcode ist erforderlich' });
  }
  if (!isValidBarcode(barcode)) {
    return res.status(400).json({ error: 'Ungültiges Barcode-Format' });
  }

  try {
    let product = stmts.getProduct.get(barcode);
    
    if (!product) {
      const productData = await lookupProduct(barcode);
      if (!productData) {
        return res.status(404).json({ error: 'Produkt nicht gefunden' });
      }
      
      const result = stmts.insertProduct.run(
        productData.barcode, productData.name, productData.name_de,
        productData.brand, productData.image_url, 0, ''
      );
      product = stmts.getProduct.get(barcode);
    } else if (!product.name_de && product.name) {
      const translated = await translateToGerman(product.name);
      if (translated) {
        stmts.updateProduct.run(product.name, translated, product.brand, product.image_url, product.ideal_stock, product.store || '', barcode);
        product = stmts.getProduct.get(barcode);
      }
    }
    
    res.json(product);
  } catch (error) {
    console.error('Error in product lookup:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Update product
app.post('/api/products/update', async (req, res) => {
  const barcode = req.body.barcode?.trim();
  const name = sanitizeString(req.body.name);
  const brand = sanitizeString(req.body.brand);
  const image_url = sanitizeString(req.body.image_url, MAX_URL_LENGTH);
  
  if (!barcode || !name) {
    return res.status(400).json({ error: 'Barcode und Name sind erforderlich' });
  }
  if (!isValidImageUrl(image_url)) {
    return res.status(400).json({ error: 'Ungültige Bild-URL' });
  }

  try {
    let product = stmts.getProduct.get(barcode);
    let name_de = sanitizeString(req.body.name_de) || null;
    
    if (!name_de) {
      name_de = await translateToGerman(name);
    }

    const idealStock = req.body.ideal_stock !== undefined
      ? Math.max(0, Math.floor(Number(req.body.ideal_stock) || 0))
      : (product?.ideal_stock || 0);

    const store = req.body.store !== undefined ? (req.body.store || '').trim() : (product?.store || '');

    if (!product) {
      stmts.insertProduct.run(barcode, name, name_de, brand, image_url, idealStock, store);
    } else {
      stmts.updateProduct.run(name, name_de, brand, image_url, idealStock, store, barcode);
    }
    
    product = stmts.getProduct.get(barcode);
    res.json(product);
    logAction(req, 'Produkt bearbeitet', `Name: ${name}`, { productName: product.name_de || name, barcode, productId: product.id });
    broadcastChange();
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Scan in
app.post('/api/inventory/scan-in', async (req, res) => {
  const barcode = req.body.barcode?.trim();
  
  if (!barcode) {
    return res.status(400).json({ error: 'Barcode ist erforderlich' });
  }
  if (!isValidBarcode(barcode)) {
    return res.status(400).json({ error: 'Ungültiges Barcode-Format' });
  }

  const count = Math.max(1, Math.min(100, Math.floor(Number(req.body.quantity) || 1)));
  const store = (req.body.store || '').trim();

  try {
    let product = stmts.getProduct.get(barcode);
    
    if (!product) {
      const productData = await lookupProduct(barcode);
      if (!productData) {
        return res.status(404).json({ error: 'Produkt nicht gefunden' });
      }
      stmts.insertProduct.run(
        productData.barcode, productData.name, productData.name_de,
        productData.brand, productData.image_url, 0, store
      );
      product = stmts.getProduct.get(barcode);
    } else if (store) {
      // Merge store into existing comma-separated list
      const existing = new Set((product.store || '').split(',').map(s => s.trim()).filter(Boolean));
      existing.add(store);
      db.prepare('UPDATE products SET store = ? WHERE barcode = ?').run([...existing].join(','), barcode);
    }
    
    const insertMany = db.transaction((count) => {
      for (let i = 0; i < count; i++) {
        stmts.insertInventory.run(product.id, barcode);
      }
    });
    insertMany(count);
    
    res.json({ message: `${count} Artikel eingebucht`, product, quantity: count });
    logAction(req, 'Eingebucht', `${count}× eingebucht`, { productName: product.name_de || product.name, barcode, productId: product.id, quantity: count, store });
    broadcastChange();
  } catch (error) {
    console.error('Error scanning in item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Scan out
app.post('/api/inventory/scan-out', async (req, res) => {
  const barcode = req.body.barcode?.trim();
  
  if (!barcode) {
    return res.status(400).json({ error: 'Barcode ist erforderlich' });
  }
  if (!isValidBarcode(barcode)) {
    return res.status(400).json({ error: 'Ungültiges Barcode-Format' });
  }

  const count = Math.max(1, Math.min(100, Math.floor(Number(req.body.quantity) || 1)));

  try {
    const product = stmts.getProduct.get(barcode);
    if (!product) {
      return res.status(404).json({ error: 'Produkt nicht in der Datenbank' });
    }
    
    const activeItems = stmts.getActiveItems.all(barcode);
    if (activeItems.length === 0) {
      return res.status(404).json({ error: 'Kein Bestand dieses Produkts vorhanden' });
    }

    const toRemove = Math.min(count, activeItems.length);
    
    const removeMany = db.transaction((items) => {
      for (let i = 0; i < toRemove; i++) {
        stmts.scanOut.run(items[i].id);
      }
    });
    removeMany(activeItems);
    
    res.json({ message: `${toRemove} Artikel ausgebucht`, product, quantity: toRemove });
    logAction(req, 'Ausgebucht', `${toRemove}× ausgebucht`, { productName: product.name_de || product.name, barcode, productId: product.id, quantity: toRemove, store: product.store });
    broadcastChange();
  } catch (error) {
    console.error('Error scanning out item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Get inventory
app.get('/api/inventory', (req, res) => {
  try {
    const inventory = stmts.getInventory.all();
    res.json(inventory);
  } catch (error) {
    console.error('Error getting inventory:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Delete product from inventory
app.delete('/api/inventory/:barcode', (req, res) => {
  const barcode = req.params.barcode?.trim();
  if (!barcode) {
    return res.status(400).json({ error: 'Barcode ist erforderlich' });
  }

  try {
    const product = stmts.getProduct.get(barcode);
    if (!product) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }

    const deleteAll = db.transaction(() => {
      stmts.scanOutAll.run(barcode);
      stmts.deleteInventory.run(barcode);
      stmts.deleteProduct.run(barcode);
    });
    deleteAll();

    res.json({ message: `${product.name} entfernt` });
    logAction(req, 'Produkt gelöscht', `${product.name_de || product.name} komplett entfernt`, { productName: product.name_de || product.name, barcode, productId: product.id });
    broadcastChange();
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Set quantity
app.post('/api/inventory/set-quantity', (req, res) => {
  const barcode = req.body.barcode?.trim();
  const quantity = req.body.quantity;

  if (!barcode || quantity == null) {
    return res.status(400).json({ error: 'Barcode und Menge sind erforderlich' });
  }

  const newQty = Math.max(0, Math.min(1000, Math.floor(Number(quantity))));

  try {
    const product = stmts.getProduct.get(barcode);
    if (!product) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }

    const activeItems = stmts.getActiveItems.all(barcode);
    const currentQty = activeItems.length;

    const adjustQty = db.transaction(() => {
      if (newQty > currentQty) {
        for (let i = 0; i < newQty - currentQty; i++) {
          stmts.insertInventory.run(product.id, barcode);
        }
      } else if (newQty < currentQty) {
        const toRemove = currentQty - newQty;
        for (let i = 0; i < toRemove; i++) {
          stmts.scanOut.run(activeItems[i].id);
        }
      }
    });
    adjustQty();

    res.json({ message: `Menge auf ${newQty} gesetzt`, product, quantity: newQty });
    logAction(req, 'Menge geändert', `${currentQty} → ${newQty}`, { productName: product.name_de || product.name, barcode, productId: product.id, quantity: newQty, oldQuantity: currentQty });
    broadcastChange();
  } catch (error) {
    console.error('Error setting quantity:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Set ideal stock
app.post('/api/products/set-ideal-stock', (req, res) => {
  const barcode = req.body.barcode?.trim();
  const ideal_stock = req.body.ideal_stock;

  if (!barcode || ideal_stock == null) {
    return res.status(400).json({ error: 'Barcode und Soll-Bestand sind erforderlich' });
  }

  try {
    const product = stmts.getProduct.get(barcode);
    if (!product) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }

    const oldIdeal = product.ideal_stock || 0;
    const newIdeal = Math.max(0, Math.floor(Number(ideal_stock)));
    stmts.setIdealStock.run(newIdeal, barcode);

    res.json({ message: 'Soll-Bestand aktualisiert', product: stmts.getProduct.get(barcode) });
    logAction(req, 'Soll geändert', `${oldIdeal} → ${newIdeal}`, { productName: product.name_de || product.name, barcode, productId: product.id, quantity: newIdeal, oldQuantity: oldIdeal });
    broadcastChange();
  } catch (error) {
    console.error('Error setting ideal stock:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Shopping list
app.get('/api/shopping-list', (req, res) => {
  try {
    // Get all products that have ideal_stock set (individual or group)
    const allProducts = db.prepare(`
      SELECT 
        p.id, p.barcode, p.name, p.name_de, p.brand, p.image_url, p.ideal_stock, p.store, p.group_id,
        g.name as group_name, g.name_de as group_name_de, g.image_url as group_image_url, g.ideal_stock as group_ideal_stock,
        COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as current_stock
      FROM products p
      LEFT JOIN inventory i ON p.barcode = i.barcode
      LEFT JOIN product_groups g ON p.group_id = g.id
      GROUP BY p.barcode
    `).all();

    const result = [];
    const processedGroups = new Set();

    for (const item of allProducts) {
      if (item.group_id) {
        if (processedGroups.has(item.group_id)) continue;
        processedGroups.add(item.group_id);

        // Aggregate all products in this group
        const groupMembers = allProducts.filter(p => p.group_id === item.group_id);
        const totalStock = groupMembers.reduce((sum, m) => sum + m.current_stock, 0);
        const groupIdeal = item.group_ideal_stock || 0;
        if (groupIdeal <= 0 || totalStock >= groupIdeal) continue;

        // Merge stores from all members
        const allStores = [...new Set(groupMembers.flatMap(m => (m.store || '').split(',').map(s => s.trim()).filter(Boolean)))];

        result.push({
          id: `group-${item.group_id}`,
          group_id: item.group_id,
          is_group: true,
          name: item.group_name,
          name_de: item.group_name_de,
          image_url: item.group_image_url || groupMembers.find(m => m.image_url)?.image_url || '',
          ideal_stock: groupIdeal,
          current_stock: totalStock,
          needed: groupIdeal - totalStock,
          store: allStores.join(','),
          members: groupMembers.map(m => ({ barcode: m.barcode, name: m.name_de || m.name, brand: m.brand, quantity: m.current_stock }))
        });
      } else {
        // Ungrouped product — same logic as before
        if (item.ideal_stock <= 0 || item.current_stock >= item.ideal_stock) continue;
        result.push({
          ...item,
          is_group: false,
          needed: item.ideal_stock - item.current_stock
        });
      }
    }

    result.sort((a, b) => ((a.name_de || a.name) || '').localeCompare((b.name_de || b.name) || '', 'de'));
    res.json(result);
  } catch (error) {
    console.error('Error getting shopping list:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// --- Manual Shopping List Items ---

// Get manual items
app.get('/api/shopping-list/manual', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM shopping_list_items ORDER BY checked ASC, created_at DESC').all();
    res.json(items);
  } catch (error) {
    console.error('Error getting manual shopping list:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Add manual item
app.post('/api/shopping-list/manual', (req, res) => {
  const name = sanitizeString(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });

  const quantity = Math.max(1, Math.min(100, Math.floor(Number(req.body.quantity) || 1)));
  const store = (req.body.store || '').trim();

  try {
    const existing = db.prepare(
      'SELECT * FROM shopping_list_items WHERE LOWER(name) = LOWER(?) AND checked = 0'
    ).get(name);

    if (existing) {
      const newQty = existing.quantity + quantity;
      db.prepare('UPDATE shopping_list_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
      const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(existing.id);
      res.json(item);
      logAction(req, 'Einkauf erhöht', `"${name}" ${existing.quantity}→${newQty}`, { productName: name, store, quantity: newQty, oldQuantity: existing.quantity });
    } else {
      const result = db.prepare(
        'INSERT INTO shopping_list_items (name, quantity, store) VALUES (?, ?, ?)'
      ).run(name, quantity, store);
      const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(result.lastInsertRowid);
      res.json(item);
      logAction(req, 'Einkauf hinzugefügt', `"${name}" (${quantity}×)`, { productName: name, store, quantity });
    }
    broadcastChange();
  } catch (error) {
    console.error('Error adding manual item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Toggle checked
app.post('/api/shopping-list/manual/toggle', (req, res) => {
  const id = Number(req.body.id);
  if (!id) return res.status(400).json({ error: 'ID ist erforderlich' });

  try {
    const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    const newChecked = item.checked ? 0 : 1;
    db.prepare('UPDATE shopping_list_items SET checked = ? WHERE id = ?').run(newChecked, id);

    res.json({ ...item, checked: newChecked });
    logAction(req, newChecked ? 'Einkauf erledigt' : 'Einkauf offen', `"${item.name}"`, { productName: item.name });
    broadcastChange();
  } catch (error) {
    console.error('Error toggling item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Update manual item
app.post('/api/shopping-list/manual/update', (req, res) => {
  const id = Number(req.body.id);
  if (!id) return res.status(400).json({ error: 'ID ist erforderlich' });

  try {
    const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    const name = sanitizeString(req.body.name) || item.name;
    const quantity = req.body.quantity !== undefined
      ? Math.max(1, Math.min(100, Math.floor(Number(req.body.quantity) || 1)))
      : item.quantity;
    const store = req.body.store !== undefined ? (req.body.store || '').trim() : item.store;

    db.prepare('UPDATE shopping_list_items SET name = ?, quantity = ?, store = ? WHERE id = ?')
      .run(name, quantity, store, id);

    res.json(db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(id));
    logAction(req, 'Einkauf bearbeitet', `"${name}"`, { productName: name, quantity });
    broadcastChange();
  } catch (error) {
    console.error('Error updating manual item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Delete manual item
app.delete('/api/shopping-list/manual/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Ungültige ID' });

  try {
    const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    db.prepare('DELETE FROM shopping_list_items WHERE id = ?').run(id);
    res.json({ message: 'Eintrag gelöscht' });
    logAction(req, 'Einkauf entfernt', `"${item.name}"`, { productName: item.name });
    broadcastChange();
  } catch (error) {
    console.error('Error deleting manual item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Clear checked manual items
app.post('/api/shopping-list/manual/clear-checked', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM shopping_list_items WHERE checked = 1').get().c;
    db.prepare('DELETE FROM shopping_list_items WHERE checked = 1').run();
    res.json({ message: `${count} Einträge entfernt`, count });
    if (count > 0) {
      logAction(req, 'Erledigte entfernt', `${count} Einträge`, {});
      broadcastChange();
    }
  } catch (error) {
    console.error('Error clearing checked items:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// --- External API (for Alexa / integrations) ---

// Add item to shopping list
app.post('/api/external/shopping-list/add', (req, res) => {
  const name = sanitizeString(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });

  const quantity = Math.max(1, Math.min(100, Math.floor(Number(req.body.quantity) || 1)));
  const store = (req.body.store || '').trim();

  try {
    const existing = db.prepare(
      'SELECT * FROM shopping_list_items WHERE LOWER(name) = LOWER(?) AND checked = 0'
    ).get(name);

    if (existing) {
      const newQty = existing.quantity + quantity;
      db.prepare('UPDATE shopping_list_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
      const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(existing.id);
      res.json({ success: true, item, merged: true, oldQuantity: existing.quantity, newQuantity: newQty });
      logAction(req, 'Einkauf erhöht (Alexa)', `"${name}" ${existing.quantity}→${newQty}`, { productName: name, store, quantity: newQty, oldQuantity: existing.quantity });
    } else {
      const result = db.prepare(
        'INSERT INTO shopping_list_items (name, quantity, store) VALUES (?, ?, ?)'
      ).run(name, quantity, store);
      const item = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(result.lastInsertRowid);
      res.json({ success: true, item, merged: false });
      logAction(req, 'Einkauf hinzugefügt (Alexa)', `"${name}" (${quantity}×)`, { productName: name, store, quantity });
    }
    broadcastChange();
  } catch (error) {
    console.error('Error adding external item:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Add multiple items at once
app.post('/api/external/shopping-list/add-multiple', (req, res) => {
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (rawItems.length === 0) return res.status(400).json({ error: 'Keine Artikel angegeben' });

  try {
    const results = [];
    const findExisting = db.prepare('SELECT * FROM shopping_list_items WHERE LOWER(name) = LOWER(?) AND checked = 0');
    const updateQty = db.prepare('UPDATE shopping_list_items SET quantity = ? WHERE id = ?');
    const insertItem = db.prepare('INSERT INTO shopping_list_items (name, quantity, store) VALUES (?, ?, ?)');
    const getItem = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?');

    const processAll = db.transaction((items) => {
      for (const raw of items) {
        const name = sanitizeString(typeof raw === 'string' ? raw : raw.name);
        if (!name) continue;
        const quantity = typeof raw === 'object' ? Math.max(1, Math.min(100, Math.floor(Number(raw.quantity) || 1))) : 1;
        const store = (typeof raw === 'object' ? (raw.store || '') : '').trim();

        const existing = findExisting.get(name);
        if (existing) {
          const newQty = existing.quantity + quantity;
          updateQty.run(newQty, existing.id);
          results.push({ name: existing.name, merged: true, oldQuantity: existing.quantity, newQuantity: newQty });
          logAction(req, 'Einkauf erhöht (Alexa)', `"${name}" ${existing.quantity}→${newQty}`, { productName: name, store, quantity: newQty, oldQuantity: existing.quantity });
        } else {
          const result = insertItem.run(name, quantity, store);
          results.push({ name, merged: false, newQuantity: quantity });
          logAction(req, 'Einkauf hinzugefügt (Alexa)', `"${name}" (${quantity}×)`, { productName: name, store, quantity });
        }
      }
    });
    processAll(rawItems);

    res.json({ success: true, items: results, count: results.length });
    if (results.length > 0) broadcastChange();
  } catch (error) {
    console.error('Error adding multiple items:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Get shopping list (combined auto + manual)
app.get('/api/external/shopping-list', (req, res) => {
  try {
    // Manual items
    const manual = db.prepare(
      'SELECT id, name, quantity, checked, store FROM shopping_list_items WHERE checked = 0 ORDER BY created_at DESC'
    ).all().map(i => ({ ...i, source: 'manual' }));

    // Auto items (simplified — just names and quantities needed)
    const allProducts = db.prepare(`
      SELECT 
        p.name, p.name_de, p.ideal_stock, p.group_id,
        g.name_de as group_name_de, g.ideal_stock as group_ideal_stock,
        COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as current_stock
      FROM products p
      LEFT JOIN inventory i ON p.barcode = i.barcode
      LEFT JOIN product_groups g ON p.group_id = g.id
      GROUP BY p.barcode
    `).all();

    const autoItems = [];
    const processedGroups = new Set();
    for (const item of allProducts) {
      if (item.group_id) {
        if (processedGroups.has(item.group_id)) continue;
        processedGroups.add(item.group_id);
        const members = allProducts.filter(p => p.group_id === item.group_id);
        const totalStock = members.reduce((sum, m) => sum + m.current_stock, 0);
        const ideal = item.group_ideal_stock || 0;
        if (ideal > 0 && totalStock < ideal) {
          autoItems.push({ name: item.group_name_de || item.name_de || item.name, needed: ideal - totalStock, source: 'inventory' });
        }
      } else {
        if (item.ideal_stock > 0 && item.current_stock < item.ideal_stock) {
          autoItems.push({ name: item.name_de || item.name, needed: item.ideal_stock - item.current_stock, source: 'inventory' });
        }
      }
    }

    res.json({ manual, auto: autoItems, total: manual.length + autoItems.length });
  } catch (error) {
    console.error('Error getting external shopping list:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Alexa widget registration — Lambda calls this to store userId for backend-initiated pushes
app.post('/api/external/alexa-register', (req, res) => {
  try {
    const { userId, apiEndpoint } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    setAlexaConfig('alexa_user_id', userId);
    if (apiEndpoint) setAlexaConfig('alexa_api_endpoint', apiEndpoint);
    res.json({ success: true });
  } catch (error) {
    console.error('Error registering Alexa:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// --- Product Group API ---

// List all groups
app.get('/api/groups', (req, res) => {
  try {
    const groups = db.prepare(`
      SELECT g.*, COUNT(p.id) as member_count
      FROM product_groups g
      LEFT JOIN products p ON p.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name COLLATE NOCASE
    `).all();
    res.json(groups);
  } catch (error) {
    console.error('Error listing groups:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Create a new group (optionally with initial product barcodes)
app.post('/api/groups/create', (req, res) => {
  const name = sanitizeString(req.body.name);
  const name_de = sanitizeString(req.body.name_de) || null;
  const image_url = sanitizeString(req.body.image_url, MAX_URL_LENGTH) || '';
  const ideal_stock = Math.max(0, Math.floor(Number(req.body.ideal_stock) || 0));
  const barcodes = Array.isArray(req.body.barcodes) ? req.body.barcodes : [];

  if (!name) {
    return res.status(400).json({ error: 'Gruppenname ist erforderlich' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO product_groups (name, name_de, image_url, ideal_stock) VALUES (?, ?, ?, ?)'
    ).run(name, name_de, image_url, ideal_stock);

    const groupId = result.lastInsertRowid;

    if (barcodes.length > 0) {
      const assignStmt = db.prepare('UPDATE products SET group_id = ? WHERE barcode = ?');
      const assignAll = db.transaction((codes) => {
        for (const bc of codes) assignStmt.run(groupId, bc.trim());
      });
      assignAll(barcodes);
    }

    const group = db.prepare('SELECT * FROM product_groups WHERE id = ?').get(groupId);
    res.json(group);
    logAction(req, 'Gruppe erstellt', `Gruppe "${name_de || name}"`, {});
    broadcastChange();
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Add product to group
app.post('/api/groups/add-product', (req, res) => {
  const groupId = Number(req.body.group_id);
  const barcode = req.body.barcode?.trim();

  if (!groupId || !barcode) {
    return res.status(400).json({ error: 'group_id und barcode sind erforderlich' });
  }

  try {
    const group = db.prepare('SELECT * FROM product_groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

    const product = stmts.getProduct.get(barcode);
    if (!product) return res.status(404).json({ error: 'Produkt nicht gefunden' });

    db.prepare('UPDATE products SET group_id = ? WHERE barcode = ?').run(groupId, barcode);
    res.json({ message: 'Produkt zur Gruppe hinzugefügt' });
    logAction(req, 'Zu Gruppe hinzugefügt', `"${product.name_de || product.name}" → Gruppe "${group.name_de || group.name}"`, { productName: product.name_de || product.name, barcode, productId: product.id });
    broadcastChange();
  } catch (error) {
    console.error('Error adding product to group:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Remove product from group
app.post('/api/groups/remove-product', (req, res) => {
  const barcode = req.body.barcode?.trim();

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode ist erforderlich' });
  }

  try {
    const product = stmts.getProduct.get(barcode);
    db.prepare('UPDATE products SET group_id = NULL WHERE barcode = ?').run(barcode);
    res.json({ message: 'Produkt aus Gruppe entfernt' });
    logAction(req, 'Aus Gruppe entfernt', `"${product?.name_de || product?.name || barcode}"`, { productName: product?.name_de || product?.name, barcode, productId: product?.id });
    broadcastChange();
  } catch (error) {
    console.error('Error removing product from group:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Update group (name, ideal_stock, image)
app.post('/api/groups/update', (req, res) => {
  const groupId = Number(req.body.group_id);
  if (!groupId) return res.status(400).json({ error: 'group_id ist erforderlich' });

  try {
    const group = db.prepare('SELECT * FROM product_groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

    const name = sanitizeString(req.body.name) || group.name;
    const name_de = req.body.name_de !== undefined ? (sanitizeString(req.body.name_de) || null) : group.name_de;
    const image_url = req.body.image_url !== undefined ? (sanitizeString(req.body.image_url, MAX_URL_LENGTH) || '') : group.image_url;
    const ideal_stock = req.body.ideal_stock !== undefined
      ? Math.max(0, Math.floor(Number(req.body.ideal_stock) || 0))
      : group.ideal_stock;

    db.prepare('UPDATE product_groups SET name = ?, name_de = ?, image_url = ?, ideal_stock = ? WHERE id = ?')
      .run(name, name_de, image_url, ideal_stock, groupId);

    res.json(db.prepare('SELECT * FROM product_groups WHERE id = ?').get(groupId));
    logAction(req, 'Gruppe bearbeitet', `Gruppe "${name_de || name}"`, {});
    broadcastChange();
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Delete group (unlinks products, doesn't delete them)
app.delete('/api/groups/:id', (req, res) => {
  const groupId = Number(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'Ungültige Gruppen-ID' });

  try {
    const group = db.prepare('SELECT * FROM product_groups WHERE id = ?').get(groupId);
    const deleteGroup = db.transaction(() => {
      db.prepare('UPDATE products SET group_id = NULL WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM product_groups WHERE id = ?').run(groupId);
    });
    deleteGroup();
    res.json({ message: 'Gruppe gelöscht' });
    logAction(req, 'Gruppe gelöscht', `Gruppe "${group?.name_de || group?.name || groupId}"`, {});
    broadcastChange();
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Simple German stemmer for grocery product matching
function stemDE(word) {
  let w = word.toLowerCase().replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/ß/g, 'ss');
  // Strip common German suffixes (longest first)
  const suffixes = ['ischen', 'ische', 'ungen', 'liche', 'ieren', 'eten', 'enen', 'chen', 'lein', 'isch', 'lich', 'ung', 'ien', 'ten', 'ern', 'eln', 'nen', 'ter', 'tes', 'tem', 'en', 'em', 'er', 'es', 'te', 'el', 'ig', 'nd', 'se', 'en', 'et', 'st', 'e', 's', 'n'];
  for (const s of suffixes) {
    if (w.length > s.length + 2 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

function tokenize(text) {
  return text.toLowerCase().split(/[\s,\-\/]+/).filter(w => w.length >= 3);
}

function stemTokens(tokens) {
  return tokens.map(stemDE);
}

// Fuzzy match: find similar products for grouping suggestion
app.get('/api/products/similar', (req, res) => {
  const barcode = req.query.barcode?.trim();
  if (!barcode) return res.status(400).json({ error: 'Barcode ist erforderlich' });

  try {
    const product = stmts.getProduct.get(barcode);
    if (!product) return res.json([]);

    const name = (product.name_de || product.name || '').toLowerCase();
    const brand = (product.brand || '').toLowerCase();
    if (!name) return res.json([]);

    // Build stemmed keyword set from name + brand
    const nameTokens = tokenize(name);
    const brandTokens = tokenize(brand);
    const allStems = stemTokens([...nameTokens, ...brandTokens]);
    const nameStems = stemTokens(nameTokens);
    if (nameStems.length === 0) return res.json([]);

    const allProducts = db.prepare(`
      SELECT p.*, COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as quantity
      FROM products p
      LEFT JOIN inventory i ON p.barcode = i.barcode
      WHERE p.barcode != ?
      GROUP BY p.barcode
    `).all(barcode);

    const matches = allProducts
      .map(p => {
        const pName = (p.name_de || p.name || '').toLowerCase();
        const pBrand = (p.brand || '').toLowerCase();
        const pStems = stemTokens([...tokenize(pName), ...tokenize(pBrand)]);

        // Score: how many of our name stems appear in the candidate's stems
        const matchCount = nameStems.filter(stem =>
          pStems.some(ps => ps === stem || (Math.abs(ps.length - stem.length) <= 2 && (ps.startsWith(stem) || stem.startsWith(ps))))
        ).length;
        return { ...p, matchScore: matchCount / nameStems.length };
      })
      .filter(p => p.matchScore >= 0.5)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5);

    res.json(matches);
  } catch (error) {
    console.error('Error finding similar products:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// --- Admin: Audit Log ---
app.get('/api/admin/audit-log', (req, res) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(100, Math.max(10, Math.floor(Number(req.query.limit) || 50)));
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM audit_log').get().count;
    const logs = db.prepare(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);

    res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  mongoClient.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  db.close();
  mongoClient.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
