import { useState, useEffect } from 'react';
import BarcodeScanner from './components/BarcodeScanner';
import Inventory from './components/Inventory';
import ShoppingList from './components/ShoppingList';
import { ProductModal, ProductEditForm, ScanOutModal } from './components/ProductModal';
import './App.css';

function App() {
  const [inventory, setInventory] = useState([]);
  const [activeTab, setActiveTab] = useState('scan-in');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showScanOutModal, setShowScanOutModal] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [scannedBarcode, setScannedBarcode] = useState(null);
  const [scanOutMaxQty, setScanOutMaxQty] = useState(1);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  const loadInventory = async () => {
    try {
      setInventoryError(null);
      const response = await fetch('/api/inventory');
      if (!response.ok) throw new Error('Laden fehlgeschlagen');
      const data = await response.json();
      setInventory(data);
    } catch (error) {
      console.error('Error loading inventory:', error);
      setInventoryError('Bestand konnte nicht geladen werden');
    }
  };

  useEffect(() => {
    loadInventory();
    // Auto-refresh every 30 seconds for multi-user support
    const interval = setInterval(loadInventory, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleScan = async (barcode, action) => {
    setLoading(true);
    setMessage(null);

    try {
      if (action === 'in') {
        // Lookup the product first and show confirmation
        const response = await fetch('/api/products/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode }),
        });

        const data = await response.json();

        if (response.ok) {
          setScannedProduct(data);
          setScannedBarcode(barcode);
          setShowModal(true);
        } else if (response.status === 404) {
          // Product not found — let user enter details manually
          setScannedProduct({ name: '', name_de: '', brand: '', image_url: '', ideal_stock: 0 });
          setScannedBarcode(barcode);
          setShowEditForm(true);
        } else {
          setMessage({ type: 'error', text: data.error || 'Produkt nicht gefunden' });
        }
      } else {
        // For scan-out, look up product and show quantity modal
        const response = await fetch('/api/products/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode }),
        });

        const data = await response.json();

        if (response.ok) {
          // Find current stock for this item
          const invItem = inventory.find(item => item.barcode === barcode);
          const maxQty = invItem ? invItem.quantity : 0;

          if (maxQty === 0) {
            setMessage({ type: 'error', text: 'Kein Bestand dieses Produkts vorhanden' });
          } else {
            setScannedProduct(data);
            setScannedBarcode(barcode);
            setScanOutMaxQty(maxQty);
            setShowScanOutModal(true);
          }
        } else {
          setMessage({ type: 'error', text: data.error || 'Produkt nicht gefunden' });
        }
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Verbindung zum Server fehlgeschlagen' });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmProduct = async (quantity) => {
    setLoading(true);
    setShowModal(false);

    try {
      const response = await fetch('/api/inventory/scan-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: scannedBarcode, quantity }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: `${quantity > 1 ? quantity + '× ' : ''}${data.product.name} zum Bestand hinzugefügt`,
        });
        loadInventory();
      } else {
        setMessage({ type: 'error', text: data.error || 'Ein Fehler ist aufgetreten' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Verbindung zum Server fehlgeschlagen' });
    } finally {
      setLoading(false);
      resetModalState();
    }
  };

  const handleConfirmScanOut = async (quantity) => {
    setLoading(true);
    setShowScanOutModal(false);

    try {
      const response = await fetch('/api/inventory/scan-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: scannedBarcode, quantity }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: `${quantity > 1 ? quantity + '× ' : ''}${data.product.name} aus dem Bestand entfernt`,
        });
        loadInventory();
      } else {
        setMessage({ type: 'error', text: data.error || 'Ein Fehler ist aufgetreten' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Verbindung zum Server fehlgeschlagen' });
    } finally {
      setLoading(false);
      resetModalState();
    }
  };

  const handleEditProduct = () => {
    setShowModal(false);
    setShowEditForm(true);
  };

  const handleSaveEditedProduct = async (editedData) => {
    setLoading(true);
    setShowEditForm(false);

    try {
      const updateResponse = await fetch('/api/products/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: scannedBarcode, ...editedData }),
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to update product');
      }

      const response = await fetch('/api/inventory/scan-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: scannedBarcode }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `${data.product.name} zum Bestand hinzugefügt` });
        loadInventory();
      } else {
        setMessage({ type: 'error', text: data.error || 'Ein Fehler ist aufgetreten' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Produkt konnte nicht gespeichert werden' });
    } finally {
      setLoading(false);
      resetModalState();
    }
  };

  const resetModalState = () => {
    setShowModal(false);
    setShowEditForm(false);
    setShowScanOutModal(false);
    setScannedProduct(null);
    setScannedBarcode(null);
    setScanOutMaxQty(1);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1>🛒 Vorratsverwaltung</h1>
          <button className="dark-mode-toggle" onClick={() => setDarkMode(d => !d)} title={darkMode ? 'Hellmodus' : 'Dunkelmodus'}>
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
        <p>Artikel beim Einkauf einscannen, beim Verbrauch ausscannen</p>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'scan-in' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan-in')}
        >
          Einscannen
        </button>
        <button
          className={`tab ${activeTab === 'scan-out' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan-out')}
        >
          Ausscannen
        </button>
        <button
          className={`tab ${activeTab === 'inventory' ? 'active' : ''}`}
          onClick={() => { setActiveTab('inventory'); loadInventory(); }}
        >
          Bestand ({inventory.reduce((sum, item) => sum + item.quantity, 0)})
        </button>
        <button
          className={`tab ${activeTab === 'shopping' ? 'active' : ''}`}
          onClick={() => setActiveTab('shopping')}
        >
          Einkaufsliste ({inventory.filter(item => item.ideal_stock > 0 && item.quantity < item.ideal_stock).length})
        </button>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="content">
        {activeTab === 'scan-in' && (
          <div className="scanner-container">
            <h2>Artikel einscannen</h2>
            <p className="instruction">Scannen Sie den Barcode eines gekauften Artikels</p>
            {loading && <div className="loading-indicator">Produkt wird gesucht…</div>}
            <BarcodeScanner
              onScan={(barcode) => handleScan(barcode, 'in')}
              disabled={loading}
            />
          </div>
        )}

        {activeTab === 'scan-out' && (
          <div className="scanner-container">
            <h2>Artikel ausscannen</h2>
            <p className="instruction">Scannen Sie den Barcode eines verbrauchten Artikels</p>
            {loading && <div className="loading-indicator">Produkt wird gesucht…</div>}
            <BarcodeScanner
              onScan={(barcode) => handleScan(barcode, 'out')}
              disabled={loading}
            />
          </div>
        )}

        {activeTab === 'inventory' && (
          inventoryError
            ? <div className="error-state">
                <p>⚠️ {inventoryError}</p>
                <button onClick={loadInventory} className="refresh-btn" style={{marginTop: '10px'}}>🔄 Erneut versuchen</button>
              </div>
            : <Inventory inventory={inventory} onRefresh={loadInventory} setInventory={setInventory} />
        )}

        {activeTab === 'shopping' && (
          <ShoppingList refreshKey={activeTab === 'shopping' ? Date.now() : 0} />
        )}
      </div>

      {showModal && scannedProduct && (
        <ProductModal
          product={scannedProduct}
          barcode={scannedBarcode}
          onConfirm={handleConfirmProduct}
          onEdit={handleEditProduct}
          onCancel={resetModalState}
        />
      )}

      {showEditForm && (
        <ProductEditForm
          barcode={scannedBarcode}
          initialProduct={scannedProduct}
          onSave={handleSaveEditedProduct}
          onCancel={resetModalState}
        />
      )}

      {showScanOutModal && scannedProduct && (
        <ScanOutModal
          product={scannedProduct}
          barcode={scannedBarcode}
          maxQuantity={scanOutMaxQty}
          onConfirm={handleConfirmScanOut}
          onCancel={resetModalState}
        />
      )}
    </div>
  );
}

export default App;
