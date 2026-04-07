import './StoreSelector.css';

const STORES = [
  { id: 'lidl', label: 'Lidl', color: '#0050AA', accent: '#FFF000' },
  { id: 'mercadona', label: 'Mercadona', color: '#00A650', accent: '#fff' },
  { id: 'hiperdino', label: 'HiperDino', color: '#E30613', accent: '#FFDD00' },
  { id: '', label: 'Andere', color: '#888', accent: '#fff' },
];

function parseStores(value) {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function StoreSelector({ selected, onSelect, multi = false }) {
  const selectedSet = multi ? new Set(parseStores(selected)) : null;

  const handleClick = (storeId) => {
    if (!multi) {
      onSelect(storeId);
      return;
    }
    const next = new Set(selectedSet);
    if (storeId === '') {
      // "Andere" toggles: if selected, remove it; if not, add it
      next.has('') ? next.delete('') : next.add('');
    } else if (next.has(storeId)) {
      next.delete(storeId);
    } else {
      next.add(storeId);
    }
    onSelect([...next].join(','));
  };

  const isActive = (storeId) => {
    if (multi) return selectedSet.has(storeId);
    return selected === storeId;
  };

  return (
    <div className="store-selector">
      <p className="store-label">{multi ? 'Erhältlich bei:' : 'Einkauf bei:'}</p>
      <div className="store-options">
        {STORES.map((store) => (
          <button
            key={store.id}
            className={`store-chip ${isActive(store.id) ? 'active' : ''}`}
            onClick={() => handleClick(store.id)}
            style={{
              '--store-color': store.color,
              '--store-accent': store.accent,
            }}
            type="button"
          >
            <span className="store-icon" style={{ background: store.color, color: store.accent }}>
              {store.id === 'lidl' && 'L'}
              {store.id === 'mercadona' && 'M'}
              {store.id === 'hiperdino' && 'HD'}
              {store.id === '' && '?'}
            </span>
            <span className="store-name">{store.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { STORES, parseStores };
export default StoreSelector;
