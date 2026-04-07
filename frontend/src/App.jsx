import { useState, useEffect } from 'react';
import BarcodeScanner from './components/BarcodeScanner';
import Inventory from './components/Inventory';
import ShoppingList from './components/ShoppingList';
import StoreSelector from './components/StoreSelector';
import { ProductModal, ProductEditForm, ScanOutModal } from './components/ProductModal';
import Admin from './components/Admin';
import { authFetch } from './authFetch';
import './App.css';

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('authToken', data.token);
        onLogin();
      } else {
        setError(data.error || 'Anmeldung fehlgeschlagen');
      }
    } catch {
      setError('Verbindung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>🔒 Vorratsverwaltung</h1>
        <p>Bitte Passwort eingeben</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort"
            autoFocus
            disabled={loading}
          />
          <button type="submit" disabled={loading || !password}>
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [activeTab, setActiveTab] = useState('scan-in');
  const [showAdmin, setShowAdmin] = useState(() => window.location.pathname === '/admin');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showScanOutModal, setShowScanOutModal] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [scannedBarcode, setScannedBarcode] = useState(null);
  const [scanOutMaxQty, setScanOutMaxQty] = useState(1);
  const [selectedStore, setSelectedStore] = useState(() => {
    return localStorage.getItem('selectedStore') || 'lidl';
  });
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  // Listen for service worker update
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('sw-update-available', onUpdate);
    return () => window.removeEventListener('sw-update-available', onUpdate);
  }, []);

  // Handle browser back button for admin page
  useEffect(() => {
    const onPopState = () => {
      setShowAdmin(window.location.pathname === '/admin');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleUpdate = () => {
    navigator.serviceWorker?.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  };

  // Auto-dismiss messages after 4 seconds
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  // Check auth status on mount
  useEffect(() => {
    authFetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  const loadInventory = async () => {
    try {
      setInventoryError(null);
      const response = await authFetch('/api/inventory');
      if (response.status === 401) { setAuthenticated(false); return; }
      if (!response.ok) throw new Error('Laden fehlgeschlagen');
      const data = await response.json();
      setInventory(data);
    } catch (error) {
      console.error('Error loading inventory:', error);
      setInventoryError('Bestand konnte nicht geladen werden');
    }
  };

  useEffect(() => {
    if (authenticated !== true) return;
    loadInventory();

    // SSE: real-time updates from other users (with auto-reconnect)
    let evtSource;
    let reconnectTimer;

    function connectSSE() {
      evtSource = new EventSource('/api/events');
      evtSource.onmessage = () => loadInventory();
      evtSource.onerror = () => {
        evtSource.close();
        reconnectTimer = setTimeout(connectSSE, 5000);
      };
    }
    connectSSE();

    // Refresh when app returns to foreground
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadInventory();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      evtSource.close();
      clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authenticated]);

  const handleScan = async (barcode, action) => {
    setLoading(true);
    setMessage(null);

    try {
      if (action === 'in') {
        // Lookup the product first and show confirmation
        const response = await authFetch('/api/products/lookup', {
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
        const response = await authFetch('/api/products/lookup', {
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
      const response = await authFetch('/api/inventory/scan-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: scannedBarcode, quantity, store: selectedStore }),
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
      const response = await authFetch('/api/inventory/scan-out', {
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
      const updateResponse = await authFetch('/api/products/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: scannedBarcode, ...editedData }),
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to update product');
      }

      const response = await authFetch('/api/inventory/scan-in', {
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

  if (authenticated === null) {
    return <div className="login-screen"><div className="login-card"><p>Laden…</p></div></div>;
  }

  if (authenticated === false) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  }

  if (showAdmin) {
    return (
      <div className="app">
        <Admin onBack={() => { setShowAdmin(false); window.history.pushState({}, '', '/'); }} />
      </div>
    );
  }

  const inventoryCount = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const shoppingCount = inventory.filter(item => item.ideal_stock > 0 && item.quantity < item.ideal_stock).length;

  return (
    <div className="app">
      <header className="app-bar">
        <h1>
          {activeTab === 'scan-in' && 'Einscannen'}
          {activeTab === 'scan-out' && 'Ausscannen'}
          {activeTab === 'inventory' && 'Bestand'}
          {activeTab === 'shopping' && 'Einkaufsliste'}
        </h1>
        <button className="admin-link" onClick={() => { setShowAdmin(true); window.history.pushState({}, '', '/admin'); }} title="Admin">
          ⚙️
        </button>
        <button className="dark-mode-toggle" onClick={() => setDarkMode(d => !d)} title={darkMode ? 'Hellmodus' : 'Dunkelmodus'}>
          {darkMode ? '☀️' : '🌙'}
        </button>
      </header>

      {updateAvailable && (
        <div className="update-banner" onClick={handleUpdate}>
          <span>🔄 Neue Version verfügbar</span>
          <button className="update-btn">Jetzt aktualisieren</button>
        </div>
      )}

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="content">
        {activeTab === 'scan-in' && (
          <div className="scanner-container">
            <StoreSelector
              selected={selectedStore}
              onSelect={(store) => {
                setSelectedStore(store);
                localStorage.setItem('selectedStore', store);
              }}
            />
            {loading && <div className="loading-indicator">Produkt wird gesucht…</div>}
            <BarcodeScanner
              onScan={(barcode) => handleScan(barcode, 'in')}
              disabled={loading || showModal || showEditForm}
            />
          </div>
        )}

        {activeTab === 'scan-out' && (
          <div className="scanner-container">
            <p className="instruction">Barcode eines verbrauchten Artikels scannen</p>
            {loading && <div className="loading-indicator">Produkt wird gesucht…</div>}
            <BarcodeScanner
              onScan={(barcode) => handleScan(barcode, 'out')}
              disabled={loading || showScanOutModal}
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

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'scan-in' ? 'active' : ''}`} onClick={() => setActiveTab('scan-in')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
            <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span>Einscannen</span>
        </button>
        <button className={`nav-item ${activeTab === 'scan-out' ? 'active' : ''}`} onClick={() => setActiveTab('scan-out')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span>Ausscannen</span>
        </button>
        <button className={`nav-item ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => { setActiveTab('inventory'); loadInventory(); }}>
          <div className="nav-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            {inventoryCount > 0 && <span className="nav-badge">{inventoryCount}</span>}
          </div>
          <span>Bestand</span>
        </button>
        <button className={`nav-item ${activeTab === 'shopping' ? 'active' : ''}`} onClick={() => setActiveTab('shopping')}>
          <div className="nav-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
            </svg>
            {shoppingCount > 0 && <span className="nav-badge">{shoppingCount}</span>}
          </div>
          <span>Einkaufsliste</span>
        </button>
      </nav>

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
