import { useState, useEffect, useRef } from 'react';
import { authFetch } from '../authFetch';
import { STORES, parseStores } from './StoreSelector';
import StoreSelector from './StoreSelector';
import ProductFormFields from './ProductFormFields';
import './ShoppingList.css';

const STORE_ORDER = ['lidl', 'mercadona', 'hiperdino', 'other'];
const storeLabel = (id) => STORES.find(s => s.id === id)?.label || 'Andere';
const storeColor = (id) => STORES.find(s => s.id === id)?.color || '#888';

function ShoppingList({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [manualItems, setManualItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState(1);
  const [editingAutoItem, setEditingAutoItem] = useState(null);
  const [editAutoForm, setEditAutoForm] = useState({ name: '', name_de: '', brand: '', image_url: '', ideal_stock: 0, store: '' });
  const [editGroupForm, setEditGroupForm] = useState({ name: '', name_de: '', image_url: '', ideal_stock: 0 });
  const addInputRef = useRef(null);
  const editNameRef = useRef(null);

  const loadShoppingList = async () => {
    setError(null);
    try {
      const [autoRes, manualRes] = await Promise.all([
        authFetch('/api/shopping-list'),
        authFetch('/api/shopping-list/manual'),
      ]);
      if (!autoRes.ok || !manualRes.ok) throw new Error('Laden fehlgeschlagen');
      setItems(await autoRes.json());
      setManualItems(await manualRes.json());
    } catch (err) {
      console.error('Error loading shopping list:', err);
      setError('Einkaufsliste konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShoppingList();
  }, [refreshKey]);

  useEffect(() => {
    if (showAddForm && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [showAddForm]);

  const handleAddManual = async (e) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    try {
      const res = await authFetch('/api/shopping-list/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, quantity: addQty }),
      });
      if (res.ok) {
        const item = await res.json();
        setManualItems(prev => [item, ...prev]);
        setAddName('');
        setAddQty(1);
        setShowAddForm(false);
      }
    } catch (err) {
      console.error('Error adding manual item:', err);
    }
  };

  const handleToggleChecked = async (item) => {
    try {
      const res = await authFetch('/api/shopping-list/manual/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      if (res.ok) {
        const updated = await res.json();
        setManualItems(prev => prev.map(i => i.id === item.id ? updated : i));
      }
    } catch (err) {
      console.error('Error toggling item:', err);
    }
  };

  const handleDeleteManual = async (item) => {
    try {
      const res = await authFetch(`/api/shopping-list/manual/${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        setManualItems(prev => prev.filter(i => i.id !== item.id));
      }
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  const handleClearChecked = async () => {
    try {
      const res = await authFetch('/api/shopping-list/manual/clear-checked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setManualItems(prev => prev.filter(i => !i.checked));
      }
    } catch (err) {
      console.error('Error clearing checked:', err);
    }
  };

  const startEditing = (item) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditQty(item.quantity);
    setTimeout(() => editNameRef.current?.focus(), 50);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim() || !editingId) return;
    try {
      const res = await authFetch('/api/shopping-list/manual/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, name: editName.trim(), quantity: editQty }),
      });
      if (res.ok) {
        const updated = await res.json();
        setManualItems(prev => prev.map(i => i.id === editingId ? updated : i));
      }
    } catch (err) {
      console.error('Error updating item:', err);
    }
    setEditingId(null);
  };

  const startEditingAutoItem = (item) => {
    if (item.is_group) {
      setEditingAutoItem(`group-${item.group_id}`);
      setEditGroupForm({
        name: item.name || '',
        name_de: item.name_de || '',
        image_url: item.image_url || '',
        ideal_stock: item.ideal_stock || 0,
      });
    } else {
      setEditingAutoItem(item.barcode);
      setEditAutoForm({
        name: item.name || '',
        name_de: item.name_de || '',
        brand: item.brand || '',
        image_url: item.image_url || '',
        ideal_stock: item.ideal_stock || 0,
        store: item.store || '',
      });
    }
  };

  const handleSaveAutoItem = async (item) => {
    try {
      if (item.is_group) {
        const res = await authFetch('/api/groups/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: Number(String(item.group_id)), ...editGroupForm }),
        });
        if (res.ok) {
          setEditingAutoItem(null);
          loadShoppingList();
        }
      } else {
        const res = await authFetch('/api/products/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: item.barcode, ...editAutoForm }),
        });
        if (res.ok) {
          setEditingAutoItem(null);
          loadShoppingList();
        }
      }
    } catch (err) {
      console.error('Error updating item:', err);
    }
  };

  if (loading) {
    return (
      <div className="shopping-list-loading">
        <p>Wird geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shopping-list-empty">
        <div className="empty-icon">⚠️</div>
        <h2>{error}</h2>
        <button onClick={loadShoppingList} className="refresh-btn" style={{marginTop: '15px'}}>
          🔄 Erneut versuchen
        </button>
      </div>
    );
  }

  const handleRemoveFromList = async (item) => {
    try {
      if (item.is_group && item.group_id) {
        const response = await authFetch('/api/groups/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: Number(String(item.group_id)), ideal_stock: item.current_stock }),
        });
        if (response.ok) {
          setItems(prev => prev.filter(i => i.id !== item.id));
        }
      } else {
        const response = await authFetch('/api/products/set-ideal-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: item.barcode, ideal_stock: item.current_stock }),
        });
        if (response.ok) {
          setItems(prev => prev.filter(i => i.barcode !== item.barcode));
        }
      }
    } catch (error) {
      console.error('Error removing from shopping list:', error);
    }
  };

  // Group auto items by store
  const grouped = {};
  for (const item of items) {
    const stores = parseStores(item.store);
    const keys = stores.length > 0 ? stores : ['other'];
    const itemKey = item.id || item.barcode;
    for (const key of keys) {
      const normalizedKey = STORE_ORDER.includes(key) ? key : 'other';
      if (!grouped[normalizedKey]) grouped[normalizedKey] = [];
      if (!grouped[normalizedKey].some(i => (i.id || i.barcode) === itemKey)) {
        grouped[normalizedKey].push(item);
      }
    }
  }

  const sortedGroups = STORE_ORDER.filter(id => grouped[id]?.length > 0);
  const totalNeeded = items.reduce((sum, item) => sum + item.needed, 0);
  const uncheckedManual = manualItems.filter(i => !i.checked);
  const checkedManual = manualItems.filter(i => i.checked);
  const isEmpty = items.length === 0 && manualItems.length === 0;

  return (
    <div className="shopping-list">
      <div className="sl-header">
        <h2>🛒 Einkaufsliste</h2>
        <button className="sl-add-btn" onClick={() => setShowAddForm(f => !f)}>
          {showAddForm ? '✕' : '+ Hinzufügen'}
        </button>
      </div>

      {showAddForm && (
        <form className="sl-add-form" onSubmit={handleAddManual}>
          <input
            ref={addInputRef}
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Was wird gebraucht?"
            className="sl-add-input"
          />
          <div className="sl-add-row">
            <label className="sl-add-qty-label">
              Menge:
              <input
                type="number"
                min="1"
                max="100"
                value={addQty}
                onChange={(e) => setAddQty(Math.max(1, Number(e.target.value) || 1))}
                className="sl-add-qty"
              />
            </label>
            <button type="submit" className="sl-add-submit" disabled={!addName.trim()}>
              Hinzufügen
            </button>
          </div>
        </form>
      )}

      {isEmpty && !showAddForm && (
        <div className="shopping-list-empty">
          <div className="empty-icon">✅</div>
          <h2>Alles auf Lager!</h2>
          <p>Alle Produkte sind auf oder über dem Soll-Bestand.</p>
          <p className="hint">Tippe auf „+ Hinzufügen" um etwas manuell einzutragen.</p>
        </div>
      )}

      {/* Manual items section */}
      {manualItems.length > 0 && (
        <div className="sl-manual-section">
          <div className="sl-store-header">
            <span className="sl-store-dot" style={{ background: '#f59e0b' }} />
            <h3>Manuell hinzugefügt</h3>
            <span className="sl-store-count">{uncheckedManual.length}</span>
            {checkedManual.length > 0 && (
              <button className="sl-clear-checked" onClick={handleClearChecked}>
                Erledigte löschen
              </button>
            )}
          </div>
          <div className="sl-items">
            {uncheckedManual.map((item) => (
              <div key={`manual-${item.id}`} className="sl-item sl-manual-item">
                <button className="sl-check-btn" onClick={() => handleToggleChecked(item)}>
                  <span className="sl-checkbox" />
                </button>
                {editingId === item.id ? (
                  <>
                    <form className="sl-inline-edit" onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }}>
                      <input
                        ref={editNameRef}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="sl-edit-name"
                        onBlur={handleSaveEdit}
                      />
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={editQty}
                        onChange={(e) => setEditQty(Math.max(1, Number(e.target.value) || 1))}
                        className="sl-edit-qty"
                        onBlur={handleSaveEdit}
                      />
                    </form>
                  </>
                ) : (
                  <>
                    <div className="sl-item-details sl-tappable" onClick={() => startEditing(item)}>
                      <h3>{item.name}</h3>
                    </div>
                    <div className="sl-item-qty sl-tappable" onClick={() => startEditing(item)}>
                      <div className="sl-needed">{item.quantity}×</div>
                    </div>
                  </>
                )}
                <button
                  className="sl-remove-btn"
                  onClick={() => handleDeleteManual(item)}
                  title="Löschen"
                >
                  ✕
                </button>
              </div>
            ))}
            {checkedManual.map((item) => (
              <div key={`manual-${item.id}`} className="sl-item sl-manual-item sl-checked">
                <button className="sl-check-btn" onClick={() => handleToggleChecked(item)}>
                  <span className="sl-checkbox checked">✓</span>
                </button>
                <div className="sl-item-details">
                  <h3>{item.name}</h3>
                </div>
                {item.quantity > 1 && (
                  <div className="sl-item-qty">
                    <div className="sl-needed">{item.quantity}×</div>
                  </div>
                )}
                <button
                  className="sl-remove-btn"
                  onClick={() => handleDeleteManual(item)}
                  title="Löschen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-generated items by store */}
      {items.length > 0 && (
        <p className="sl-subtitle">
          {items.length} {items.length === 1 ? 'Produkt' : 'Produkte'} nachkaufen
          ({totalNeeded} Artikel gesamt)
        </p>
      )}

      {sortedGroups.map((storeId) => (
        <div key={storeId || '_other'} className="sl-store-group">
          <div className="sl-store-header">
            <span className="sl-store-dot" style={{ background: storeColor(storeId) }} />
            <h3>{storeLabel(storeId)}</h3>
            <span className="sl-store-count">{grouped[storeId].length}</span>
          </div>

          <div className="sl-items">
            {grouped[storeId].map((item) => (
              <div key={item.id || item.barcode} className="sl-item">
                {editingAutoItem === (item.is_group ? `group-${item.group_id}` : item.barcode) ? (
                  <div className="sl-edit-form">
                    <h3>Produkt bearbeiten</h3>
                    {item.is_group ? (
                      <>
                        <div className="sl-edit-field">
                          <label>Name</label>
                          <input className="sl-edit-input" value={editGroupForm.name} onChange={(e) => setEditGroupForm(prev => ({ ...prev, name: e.target.value }))} />
                        </div>
                        <div className="sl-edit-field">
                          <label>Deutscher Name</label>
                          <input className="sl-edit-input" value={editGroupForm.name_de || ''} onChange={(e) => setEditGroupForm(prev => ({ ...prev, name_de: e.target.value }))} />
                        </div>
                        <div className="sl-edit-field">
                          <label>Soll-Bestand</label>
                          <input type="number" min="0" className="sl-edit-input" value={editGroupForm.ideal_stock} onChange={(e) => setEditGroupForm(prev => ({ ...prev, ideal_stock: Math.max(0, parseInt(e.target.value) || 0) }))} />
                        </div>
                      </>
                    ) : (
                      <>
                        <ProductFormFields formData={editAutoForm} setFormData={setEditAutoForm} barcode={item.barcode} />
                        <div className="sl-edit-store-section">
                          <StoreSelector selected={editAutoForm.store} onSelect={(store) => setEditAutoForm(prev => ({ ...prev, store }))} multi />
                        </div>
                      </>
                    )}
                    <div className="sl-edit-actions">
                      <button className="sl-save-btn" onClick={() => handleSaveAutoItem(item)}>Speichern</button>
                      <button className="sl-cancel-btn" onClick={() => setEditingAutoItem(null)}>Abbrechen</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {item.image_url && (
                      <div className="sl-item-image" onClick={() => setZoomImage({ url: item.image_url, name: item.name_de || item.name })}>
                        <img src={item.image_url} alt={item.name} loading="lazy" />
                      </div>
                    )}
                    <div className="sl-item-details">
                      <h3>
                        {item.name_de || item.name}
                        {item.is_group && <span className="sl-group-badge">{item.members?.length} Varianten</span>}
                      </h3>
                      {!item.is_group && item.name_de && item.name_de.toLowerCase() !== item.name.toLowerCase() && (
                        <p className="sl-original-name">{item.name}</p>
                      )}
                      {item.brand && <p className="sl-brand">{item.brand}</p>}
                    </div>
                    <div className="sl-item-qty">
                      <div className="sl-needed">+{item.needed}</div>
                      <div className="sl-stock-info">
                        {item.current_stock} / {item.ideal_stock}
                      </div>
                    </div>
                    <button
                      className="sl-edit-btn"
                      onClick={() => startEditingAutoItem(item)}
                      title="Bearbeiten"
                    >
                      ✏️
                    </button>
                    <button
                      className="sl-remove-btn"
                      onClick={() => handleRemoveFromList(item)}
                      title="Von der Einkaufsliste entfernen"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
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

export default ShoppingList;
