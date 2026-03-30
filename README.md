# 🛒 Grocery Tracker

A modern web application for tracking your grocery inventory using barcode scanning. Scan items in when you go shopping and scan them out when you use them.

## Features

- 📷 **Barcode Scanning**: Use your device camera or manually enter barcodes
- 🌍 **European Product Database**: Integrates with Open Food Facts API for excellent European product coverage
- 📊 **Inventory Management**: Track what you have in stock with quantities
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 💾 **Local Database**: SQLite database for reliable data storage
- ⚡ **Real-time Updates**: Instant inventory updates when scanning items

## Technology Stack

### Backend
- **Node.js** with **Express**: RESTful API server
- **SQLite** with **better-sqlite3**: Lightweight, fast database
- **Open Food Facts API**: Product information lookup
- **CORS** enabled for development

### Frontend
- **React 18**: Modern UI library
- **Vite**: Fast build tool and dev server
- **html5-qrcode**: Barcode scanning library
- **CSS3**: Custom styling with animations

## Project Structure

```
grocery-tracker/
├── backend/
│   ├── server.js          # Express API server
│   ├── package.json       # Backend dependencies
│   └── .env              # Environment variables
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # Main application component
│   │   ├── App.css       # Main styles
│   │   ├── main.jsx      # React entry point
│   │   ├── index.css     # Global styles
│   │   └── components/
│   │       ├── BarcodeScanner.jsx    # Camera/manual barcode input
│   │       ├── BarcodeScanner.css
│   │       ├── Inventory.jsx         # Inventory display
│   │       └── Inventory.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── package.json          # Root workspace config
└── README.md
```

## Installation

### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager

### Setup Steps

1. **Install all dependencies**:
   ```bash
   npm install
   npm run install:all
   ```

   Or install manually:
   ```bash
   # Install root dependencies
   npm install

   # Install backend dependencies
   cd backend
   npm install

   # Install frontend dependencies
   cd ../frontend
   npm install
   cd ..
   ```

2. **Start the application**:
   ```bash
   npm run dev
   ```

   This will start both backend (port 3001) and frontend (port 3000) servers.

   Or run them separately:
   ```bash
   # Terminal 1 - Backend
   npm run dev:backend

   # Terminal 2 - Frontend
   npm run dev:frontend
   ```

3. **Open the application**:
   - Navigate to `http://localhost:3000` in your browser

## Usage

### Scanning Items In (After Shopping)

1. Click the **"Scan In"** tab
2. Click **"Start Camera"** to use your device camera
   - Point the camera at the product barcode
   - The app will automatically detect and scan the barcode
3. Or manually enter the barcode number and click **"Submit"**
4. The app will:
   - Look up the product information online
   - Save it to your database
   - Add it to your inventory

### Scanning Items Out (When Using)

1. Click the **"Scan Out"** tab
2. Scan or enter the barcode of the item you're using
3. The app will remove one unit from your inventory

### Viewing Inventory

1. Click the **"Inventory"** tab
2. View all items currently in stock with:
   - Product name and brand
   - Product image
   - Barcode
   - Quantity available
   - Date last added
3. See summary statistics at the bottom

## API Endpoints

### Backend API (http://localhost:3001/api)

- **POST /api/products/lookup**
  - Body: `{ "barcode": "1234567890" }`
  - Looks up product by barcode

- **POST /api/inventory/scan-in**
  - Body: `{ "barcode": "1234567890" }`
  - Adds item to inventory

- **POST /api/inventory/scan-out**
  - Body: `{ "barcode": "1234567890" }`
  - Removes item from inventory

- **GET /api/inventory**
  - Returns current inventory with quantities

- **GET /api/inventory/history**
  - Returns recent inventory transactions

## Database Schema

### Products Table
```sql
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    brand TEXT,
    image_url TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Inventory Table
```sql
CREATE TABLE inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    scanned_in DATETIME DEFAULT CURRENT_TIMESTAMP,
    scanned_out DATETIME,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

## Features Explained

### Barcode Scanning
- Uses HTML5 camera API through `html5-qrcode` library
- Supports EAN-13, UPC-A, and other common barcode formats
- Automatically detects and decodes barcodes in real-time
- Manual entry fallback for devices without cameras

### Product Lookup
- Integrates with Open Food Facts API
- Excellent coverage for European products
- Automatically fetches:
  - Product name
  - Brand
  - Product image
  - Nutritional information (available in API)

### Inventory Tracking
- Each item is tracked as a whole unit
- FIFO (First In, First Out) - oldest items are removed first
- Real-time quantity updates
- Historical tracking of all scans

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers with camera access

**Note**: Camera access requires HTTPS in production (or localhost for development).

## Camera Permissions

On first use, the browser will request camera permissions:
- Click **"Allow"** to enable barcode scanning
- If denied, you can still use manual barcode entry

## Troubleshooting

### Camera not working
1. Check browser permissions (usually a camera icon in the address bar)
2. Ensure you're using HTTPS (or localhost)
3. Try a different browser
4. Use manual barcode entry as an alternative

### Product not found
- Some products may not be in the Open Food Facts database
- Try entering the barcode manually
- The product will be saved with basic information
- You can add products to Open Food Facts at https://world.openfoodfacts.org

### Port already in use
```bash
# Change the port in backend/.env
PORT=3002

# Change the port in frontend/vite.config.js
server: {
  port: 3001
}
```

## Development

### Backend Development
```bash
cd backend
npm run dev  # Uses nodemon for auto-reload
```

### Frontend Development
```bash
cd frontend
npm run dev  # Uses Vite HMR
```

### Production Build
```bash
cd frontend
npm run build  # Creates optimized production build in dist/
```

## Future Enhancements

- User authentication and multi-user support
- Expiration date tracking
- Shopping list generation
- Low stock alerts
- Product categories and filtering
- Export data to CSV/Excel
- Mobile app (React Native)
- Recipe suggestions based on inventory

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues or questions:
- Check the troubleshooting section
- Review browser console for errors
- Ensure all dependencies are installed correctly

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
