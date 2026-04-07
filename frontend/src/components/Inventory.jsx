import { useState, useEffect, useMemo } from 'react';
import { authFetch } from '../authFetch';
import ProductFormFields from './ProductFormFields';
import StoreSelector from './StoreSelector';
import './Inventory.css';

function Inventory({ inventory, onRefresh, setInventory }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', name_de: '', brand: '', image_url: '' });
  const [zoomImage, setZoomImage] = useState(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (inventory.length === 0) {
    return (
      <div className="empty-inventory">
        <div className="empty-icon">📦</div>
        <h2>Dein Bestand ist leer</h2>
        <p>Scanne Artikel, um deinen Vorrat zu verwalten</p>
      </div>
    );
  }

  const handleSetQuantity = async (barcode, quantity) => {
    const newQty = Math.max(0, quantity);
    setInventory(prev =>
      prev.map(item =>
        item.barcode === barcode ? { ...item, quantity: newQty } : item
      )
    );

    try {
      await authFetch('/api/inventory/set-quantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, quantity }),
      });
    } catch (error) {
      console.error('Error setting quantity:', error);
      onRefresh();
    }
  };

  const handleSetIdealStock = async (barcode, idealStock) => {
    const newIdeal = Math.max(0, idealStock);
    setInventory(prev =>
      prev.map(item =>
        item.barcode === barcode ? { ...item, ideal_stock: newIdeal } : item
      )
    );

    try {
      await authFetch('/api/products/set-ideal-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, ideal_stock: newIdeal }),
      });
    } catch (error) {
      console.error('Error setting ideal stock:', error);
      onRefresh();
    }
  };

  const handleDelete = async (barcode) => {
    try {
      const response = await authFetch(`/api/inventory/${barcode}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setConfirmDelete(null);
        onRefresh();
      }
    } catch (error) {
      console.error('Error deleting item:', error);
    }
  };

  const startEditingProduct = (item) => {
    setEditingProduct(item.barcode);
    setEditForm({
      name: item.name || '',
      name_de: item.name_de || '',
      brand: item.brand || '',
      image_url: item.image_url || '',
      ideal_stock: item.ideal_stock || 0,
      store: item.store || ''
    });
  };

  const handleSaveProduct = async (barcode) => {
    try {
      const response = await authFetch('/api/products/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, ...editForm }),
      });
      if (response.ok) {
        setEditingProduct(null);
        onRefresh();
      }
    } catch (error) {
      console.error('Error updating product:', error);
    }
  };

  const query = debouncedSearch.toLowerCase().trim();
  const filtered = query
    ? inventory.filter(item =>
        item.name.toLowerCase().includes(query) ||
        (item.name_de && item.name_de.toLowerCase().includes(query)) ||
        (item.brand && item.brand.toLowerCase().includes(query)) ||
        item.barcode.includes(query)
      )
    : inventory;

  const sorted = useMemo(() => 
    [...filtered].sort((a, b) => 
      (a.name_de || a.name).localeCompare(b.name_de || b.name, 'de')
    ),
    [filtered]
  );

  return (
    <div className="inventory">
      <div className="inventory-header">
        <h2>Aktueller Bestand</h2>
      </div>

      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nach Name, Marke oder Barcode suchen…"
          className="search-input"
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {sorted.length === 0 && (
        <div className="no-results">
          <p>Keine Artikel gefunden für "{search}"</p>
        </div>
      )}

      <div className="inventory-grid">
        {sorted.map((item) => (
          <div key={item.id} className="inventory-item">
            {editingProduct === item.barcode ? (
              <div className="product-edit-form">
                <h3>Produkt bearbeiten</h3>
                <ProductFormFields
                  formData={editForm}
                  setFormData={setEditForm}
                  barcode={item.barcode}
                />
                <div className="edit-store-section">
                  <StoreSelector
                    selected={editForm.store}
                    onSelect={(store) => setEditForm(prev => ({ ...prev, store }))}
                  />
                </div>
                <div className="edit-actions">
                  <button className="save-btn" onClick={() => handleSaveProduct(item.barcode)}>Speichern</button>
                  <button className="cancel-btn-sm" onClick={() => setEditingProduct(null)}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <>
            {item.image_url && (
              <div className="item-image" onClick={() => setZoomImage({ url: item.image_url, name: item.name_de || item.name })}>
                <img src={item.image_url} alt={item.name} />
              </div>
            )}
            <div className="item-details">
              <h3>{item.name_de || item.name}</h3>
              {item.name_de && <p className="name-original">{item.name}</p>}
              {item.brand && <p className="brand">{item.brand}</p>}
              <div className="item-meta">
                <div className="qty-row">
                  <span className="qty-label">Ist</span>
                  <div className="qty-inline">
                    <button
                      className="qty-btn-sm"
                      onClick={() => handleSetQuantity(item.barcode, item.quantity - 1)}
                      disabled={item.quantity <= 0}
                    >−</button>
                    <span className="qty-display">{item.quantity}</span>
                    <button
                      className="qty-btn-sm"
                      onClick={() => handleSetQuantity(item.barcode, item.quantity + 1)}
                    >+</button>
                  </div>
                </div>
                <div className="qty-row">
                  <span className="qty-label">Soll</span>
                  <div className="qty-inline soll">
                    <button
                      className="qty-btn-sm"
                      onClick={() => handleSetIdealStock(item.barcode, (item.ideal_stock || 0) - 1)}
                      disabled={(item.ideal_stock || 0) <= 0}
                    >−</button>
                    <span className={`qty-display ${item.ideal_stock > 0 && item.quantity < item.ideal_stock ? 'low' : ''}`}>
                      {item.ideal_stock || 0}
                    </span>
                    <button
                      className="qty-btn-sm"
                      onClick={() => handleSetIdealStock(item.barcode, (item.ideal_stock || 0) + 1)}
                    >+</button>
                  </div>
                </div>
              </div>
              <div className="item-actions">
                <button className="edit-btn" onClick={() => startEditingProduct(item)}>
                  ✏️ Bearbeiten
                </button>
                {confirmDelete === item.barcode ? (
                  <div className="confirm-delete">
                    <span>Alles löschen?</span>
                    <button className="confirm-yes" onClick={() => handleDelete(item.barcode)}>Ja</button>
                    <button className="confirm-no" onClick={() => setConfirmDelete(null)}>Nein</button>
                  </div>
                ) : (
                  <button className="delete-btn" onClick={() => setConfirmDelete(item.barcode)}>
                    🗑️ Entfernen
                  </button>
                )}
              </div>
            </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="inventory-summary">
        <div className="summary-card">
          <div className="summary-number">{sorted.length}</div>
          <div className="summary-label">{query ? 'Gefundene Produkte' : 'Verschiedene Produkte'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-number">
            {sorted.reduce((sum, item) => sum + item.quantity, 0)}
          </div>
          <div className="summary-label">{query ? 'Gefundene Artikel' : 'Artikel gesamt'}</div>
        </div>
      </div>

      {zoomImage && (
        <div className="image-zoom-overlay" onClick={() => setZoomImage(null)}>
          <div className="image-zoom-content" onClick={(e) => e.stopPropagation()}>
            <img src={zoomImage.url} alt={zoomImage.name} />
            <p className="image-zoom-name">{zoomImage.name}</p>
            <button className="image-zoom-close" onClick={() => setZoomImage(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inventory;
