import Database from 'better-sqlite3';
import fs from 'fs';

// Migrate from JSON to SQLite
const JSON_FILE = 'grocery-db.json';
const DB_FILE = 'grocery.db';

if (!fs.existsSync(JSON_FILE)) {
  console.log('No JSON database found, nothing to migrate.');
  process.exit(0);
}

if (fs.existsSync(DB_FILE)) {
  console.log('SQLite database already exists. Skipping migration.');
  process.exit(0);
}

const jsonData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');

// Create tables
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

// Migrate products
const insertProduct = db.prepare(`
  INSERT INTO products (id, barcode, name, name_de, brand, image_url, ideal_stock, last_updated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let productCount = 0;
for (const [barcode, product] of Object.entries(jsonData.products)) {
  insertProduct.run(
    product.id,
    barcode,
    product.name,
    product.name_de || null,
    product.brand || '',
    product.image_url || '',
    product.ideal_stock || 0,
    product.last_updated || new Date().toISOString()
  );
  productCount++;
}

// Migrate inventory
const insertInventory = db.prepare(`
  INSERT INTO inventory (id, product_id, barcode, scanned_in, scanned_out)
  VALUES (?, ?, ?, ?, ?)
`);

let inventoryCount = 0;
for (const item of jsonData.inventory) {
  insertInventory.run(
    item.id,
    item.product_id,
    item.barcode,
    item.scanned_in,
    item.scanned_out || null
  );
  inventoryCount++;
}

db.close();
console.log(`Migration complete: ${productCount} products, ${inventoryCount} inventory entries.`);
