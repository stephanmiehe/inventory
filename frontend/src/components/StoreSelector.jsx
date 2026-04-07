import './StoreSelector.css';

const STORES = [
  { id: 'lidl', label: 'Lidl', color: '#0050AA', accent: '#FFF000' },
  { id: 'mercadona', label: 'Mercadona', color: '#00A650', accent: '#fff' },
  { id: 'hiperdino', label: 'HiperDino', color: '#E30613', accent: '#FFDD00' },
  { id: '', label: 'Andere', color: '#888', accent: '#fff' },
];

function StoreSelector({ selected, onSelect }) {
  return (
    <div className="store-selector">
      <p className="store-label">Einkauf bei:</p>
      <div className="store-options">
        {STORES.map((store) => (
          <button
            key={store.id}
            className={`store-chip ${selected === store.id ? 'active' : ''}`}
            onClick={() => onSelect(store.id)}
            style={{
              '--store-color': store.color,
              '--store-accent': store.accent,
            }}
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

export { STORES };
export default StoreSelector;
