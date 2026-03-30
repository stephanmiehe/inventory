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
    const { readFileSync, unlinkSync } = await import('fs');
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

    // Clean up temp file
    unlinkSync(req.file.path);

    res.json({
      name: sanitizeString(result.name) || '',
      name_de: sanitizeString(result.name_de) || null,
      brand: sanitizeString(result.brand) || '',
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
const MONGO_DB = process.env.MONGO_DB || 'off';
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || 'products';

const mongoClient = new MongoClient(MONGO_URI);
let mongoProducts;

async function connectMongo() {
  await mongoClient.connect();
  mongoProducts = mongoClient.db(MONGO_DB).collection(MONGO_COLLECTION);
  console.log('Connected to MongoDB');
}

connectMongo().catch(err => {
  console.error('MongoDB connection failed:', err.message);
  process.exit(1);
});

async function lookupProduct(barcode) {
  try {
    const doc = await mongoProducts.findOne({ code: barcode });
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
    INSERT INTO products (barcode, name, name_de, brand, image_url, ideal_stock)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  updateProduct: db.prepare(`
    UPDATE products SET name = ?, name_de = ?, brand = ?, image_url = ?, ideal_stock = ?, last_updated = datetime('now')
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
      p.id, p.barcode, p.name, p.name_de, p.brand, p.image_url, p.ideal_stock,
      COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as quantity,
      MIN(i.scanned_in) as first_added,
      MAX(i.scanned_in) as last_added
    FROM products p
    INNER JOIN inventory i ON p.barcode = i.barcode
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
      p.id, p.barcode, p.name, p.name_de, p.brand, p.image_url, p.ideal_stock,
      COUNT(CASE WHEN i.scanned_out IS NULL THEN 1 END) as current_stock
    FROM products p
    LEFT JOIN inventory i ON p.barcode = i.barcode
    WHERE p.ideal_stock > 0
    GROUP BY p.barcode
    HAVING current_stock < p.ideal_stock
    ORDER BY COALESCE(p.name_de, p.name) COLLATE NOCASE
  `),
};

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
        productData.brand, productData.image_url, 0
      );
      product = stmts.getProduct.get(barcode);
    } else if (!product.name_de && product.name) {
      const translated = await translateToGerman(product.name);
      if (translated) {
        stmts.updateProduct.run(product.name, translated, product.brand, product.image_url, product.ideal_stock, barcode);
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

    if (!product) {
      stmts.insertProduct.run(barcode, name, name_de, brand, image_url, idealStock);
    } else {
      stmts.updateProduct.run(name, name_de, brand, image_url, idealStock, barcode);
    }
    
    product = stmts.getProduct.get(barcode);
    res.json(product);
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

  try {
    let product = stmts.getProduct.get(barcode);
    
    if (!product) {
      const productData = await lookupProduct(barcode);
      if (!productData) {
        return res.status(404).json({ error: 'Produkt nicht gefunden' });
      }
      stmts.insertProduct.run(
        productData.barcode, productData.name, productData.name_de,
        productData.brand, productData.image_url, 0
      );
      product = stmts.getProduct.get(barcode);
    }
    
    const insertMany = db.transaction((count) => {
      for (let i = 0; i < count; i++) {
        stmts.insertInventory.run(product.id, barcode);
      }
    });
    insertMany(count);
    
    res.json({ message: `${count} Artikel eingebucht`, product, quantity: count });
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

    const newIdeal = Math.max(0, Math.floor(Number(ideal_stock)));
    stmts.setIdealStock.run(newIdeal, barcode);

    res.json({ message: 'Soll-Bestand aktualisiert', product: stmts.getProduct.get(barcode) });
  } catch (error) {
    console.error('Error setting ideal stock:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

// Shopping list
app.get('/api/shopping-list', (req, res) => {
  try {
    const items = stmts.getShoppingList.all().map(item => ({
      ...item,
      needed: item.ideal_stock - item.current_stock
    }));
    res.json(items);
  } catch (error) {
    console.error('Error getting shopping list:', error);
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
