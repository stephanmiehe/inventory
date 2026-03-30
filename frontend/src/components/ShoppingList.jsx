import { useState, useEffect } from 'react';
import './ShoppingList.css';

function ShoppingList({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadShoppingList = async () => {
    setError(null);
    try {
      const response = await fetch('/api/shopping-list');
      if (!response.ok) throw new Error('Laden fehlgeschlagen');
      const data = await response.json();
      setItems(data);
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

  if (items.length === 0) {
    return (
      <div className="shopping-list-empty">
        <div className="empty-icon">✅</div>
        <h2>Alles auf Lager!</h2>
        <p>Alle Produkte sind auf oder über dem Soll-Bestand.</p>
        <p className="hint">Setze einen Soll-Bestand bei Produkten im Bestand, um sie hier zu sehen.</p>
      </div>
    );
  }

  const handleRemoveFromList = async (item) => {
    try {
      const response = await fetch('/api/products/set-ideal-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: item.barcode, ideal_stock: item.current_stock }),
      });
      if (response.ok) {
        setItems(prev => prev.filter(i => i.barcode !== item.barcode));
      }
    } catch (error) {
      console.error('Error removing from shopping list:', error);
    }
  };

  return (
    <div className="shopping-list">
      <div className="sl-header">
        <h2>🛒 Einkaufsliste</h2>
      </div>

      <p className="sl-subtitle">
        {items.length} {items.length === 1 ? 'Produkt' : 'Produkte'} nachkaufen
        ({items.reduce((sum, item) => sum + item.needed, 0)} Artikel gesamt)
      </p>

      <div className="sl-items">
        {items.map((item) => (
          <div key={item.id} className="sl-item">
            {item.image_url && (
              <div className="sl-item-image">
                <img src={item.image_url} alt={item.name} />
              </div>
            )}
            <div className="sl-item-details">
              <h3>{item.name_de || item.name}</h3>
              {item.name_de && item.name_de.toLowerCase() !== item.name.toLowerCase() && (
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
              className="sl-remove-btn"
              onClick={() => handleRemoveFromList(item)}
              title="Von der Einkaufsliste entfernen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ShoppingList;
