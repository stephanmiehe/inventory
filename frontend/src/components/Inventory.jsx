import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { authFetch } from '../authFetch';
import ProductFormFields from './ProductFormFields';
import StoreSelector from './StoreSelector';
import './Inventory.css';

function LazyItem({ children, height = 200 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    return <div ref={ref} className="inventory-item inventory-item-placeholder" style={{ minHeight: height }} />;
  }

  return <div ref={ref}>{children}</div>;
}

// Normalize umlauts and special chars for search comparison
function normalizeText(text) {
  return (text || '').toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
}

// Highlight matching words in text
function Highlight({ text, words }) {
  if (!text || !words || words.length === 0) return text;
  // Build regex matching any of the search words (on the original text, case-insensitive)
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) {
    // No regex match — try umlaut-normalized match for highlighting
    const normText = normalizeText(text);
    const normWords = words.map(normalizeText);
    // Find positions of matches in normalized text, highlight corresponding original chars
    let highlights = [];
    for (const nw of normWords) {
      let idx = 0;
      while ((idx = normText.indexOf(nw, idx)) !== -1) {
        highlights.push([idx, idx + nw.length]);
        idx += nw.length;
      }
    }
    if (highlights.length === 0) return text;
    // Merge overlapping ranges and build parts
    highlights.sort((a, b) => a[0] - b[0]);
    const merged = [highlights[0]];
    for (let i = 1; i < highlights.length; i++) {
      const last = merged[merged.length - 1];
      if (highlights[i][0] <= last[1]) {
        last[1] = Math.max(last[1], highlights[i][1]);
      } else {
        merged.push(highlights[i]);
      }
    }
    const result = [];
    let pos = 0;
    for (const [start, end] of merged) {
      if (pos < start) result.push(text.slice(pos, start));
      result.push(<mark key={start} className="search-highlight">{text.slice(start, end)}</mark>);
      pos = end;
    }
    if (pos < text.length) result.push(text.slice(pos));
    return result;
  }
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part
  );
}

function Inventory({ inventory, onRefresh, setInventory }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', name_de: '', brand: '', image_url: '' });
  const [zoomImage, setZoomImage] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [groupingProduct, setGroupingProduct] = useState(null);
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState(null);
  const [editGroupForm, setEditGroupForm] = useState({ name: '', name_de: '' });
  const searchInputRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Auto-focus search when component mounts
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Dismiss keyboard on scroll (mobile)
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onScroll = () => {
      if (document.activeElement === searchInputRef.current) {
        searchInputRef.current.blur();
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const loadGroups = async () => {
    try {
      const res = await authFetch('/api/groups');
      if (res.ok) setGroups(await res.json());
    } catch {}
  };

  useEffect(() => { loadGroups(); }, []);

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

  const handleSetGroupIdealStock = async (groupId, idealStock) => {
    const newIdeal = Math.max(0, idealStock);
    try {
      await authFetch('/api/groups/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, ideal_stock: newIdeal }),
      });
      onRefresh();
    } catch (error) {
      console.error('Error setting group ideal stock:', error);
    }
  };

  const handleDelete = async (barcode) => {
    try {
      const response = await authFetch(`/api/inventory/${barcode}`, { method: 'DELETE' });
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

  const handleAddToGroup = async (barcode, groupId) => {
    try {
      await authFetch('/api/groups/add-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, group_id: groupId }),
      });
      setGroupingProduct(null);
      onRefresh();
      loadGroups();
    } catch (error) {
      console.error('Error adding to group:', error);
    }
  };

  const handleCreateGroupWith = async (barcode) => {
    const product = inventory.find(i => i.barcode === barcode);
    const groupName = newGroupName.trim() || product?.name_de || product?.name || 'Neue Gruppe';
    try {
      const res = await authFetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName,
          name_de: groupName,
          image_url: product?.image_url || '',
          ideal_stock: product?.ideal_stock || 0,
          barcodes: [barcode]
        }),
      });
      if (res.ok) {
        setGroupingProduct(null);
        setNewGroupName('');
        onRefresh();
        loadGroups();
      }
    } catch (error) {
      console.error('Error creating group:', error);
    }
  };

  const handleRemoveFromGroup = async (barcode) => {
    try {
      await authFetch('/api/groups/remove-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode }),
      });
      onRefresh();
      loadGroups();
    } catch (error) {
      console.error('Error removing from group:', error);
    }
  };

  const startEditingGroup = (g) => {
    setEditingGroup(g.group_id);
    setEditGroupForm({ name: g.group_name || '', name_de: g.group_name_de || '' });
  };

  const handleSaveGroup = async (groupId) => {
    try {
      await authFetch('/api/groups/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, name: editGroupForm.name, name_de: editGroupForm.name_de }),
      });
      setEditingGroup(null);
      onRefresh();
      loadGroups();
    } catch (error) {
      console.error('Error updating group:', error);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    try {
      await authFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
      setEditingGroup(null);
      onRefresh();
      loadGroups();
    } catch (error) {
      console.error('Error deleting group:', error);
    }
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const query = debouncedSearch.toLowerCase().trim();
  const searchWords = query.split(/\s+/).filter(Boolean);
  const normalizedWords = searchWords.map(normalizeText);

  const filtered = normalizedWords.length > 0
    ? inventory.filter(item => {
        const fields = [
          item.name, item.name_de, item.brand,
          item.group_name, item.group_name_de, item.barcode
        ].map(normalizeText);
        // Every search word must match at least one field
        return normalizedWords.every(nw =>
          fields.some(f => f.includes(nw))
        );
      })
    : inventory;

  // Build grouped + ungrouped display items
  const displayItems = useMemo(() => {
    const groupMap = new Map();
    const ungrouped = [];

    for (const item of filtered) {
      if (item.group_id) {
        if (!groupMap.has(item.group_id)) {
          groupMap.set(item.group_id, {
            type: 'group',
            group_id: item.group_id,
            group_name: item.group_name,
            group_name_de: item.group_name_de,
            group_image_url: item.group_image_url,
            group_ideal_stock: item.group_ideal_stock || 0,
            members: [],
            totalQuantity: 0,
            last_added: null,
          });
        }
        const g = groupMap.get(item.group_id);
        g.members.push(item);
        g.totalQuantity += item.quantity;
        if (!g.last_added || item.last_added > g.last_added) g.last_added = item.last_added;
      } else {
        ungrouped.push({ type: 'single', item });
      }
    }

    const all = [
      ...Array.from(groupMap.values()),
      ...ungrouped
    ];

    all.sort((a, b) => {
      const nameA = a.type === 'group' ? (a.group_name_de || a.group_name) : (a.item.name_de || a.item.name);
      const nameB = b.type === 'group' ? (b.group_name_de || b.group_name) : (b.item.name_de || b.item.name);
      return (nameA || '').localeCompare(nameB || '', 'de');
    });

    return all;
  }, [filtered]);

  const totalProducts = displayItems.reduce((n, d) => n + (d.type === 'group' ? d.members.length : 1), 0);
  const totalArticles = displayItems.reduce((n, d) => n + (d.type === 'group' ? d.totalQuantity : d.item.quantity), 0);

  const renderItemCard = (item) => {
    const isLow = item.ideal_stock > 0 && item.quantity < item.ideal_stock;
    return (
      <div className={`inventory-item${isLow ? ' low-stock' : ''}`}>
        {isLow && <span className="low-stock-badge">Nachkaufen</span>}
        {editingProduct === item.barcode ? (
          <div className="product-edit-form">
            <h3>Produkt bearbeiten</h3>
            <ProductFormFields formData={editForm} setFormData={setEditForm} barcode={item.barcode} />
            <div className="edit-store-section">
              <StoreSelector selected={editForm.store} onSelect={(store) => setEditForm(prev => ({ ...prev, store }))} multi />
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
                <img src={item.image_url} alt={item.name} loading="lazy" />
              </div>
            )}
            <div className="item-details">
              <h3><Highlight text={item.name_de || item.name} words={searchWords} /></h3>
              {item.name_de && <p className="name-original"><Highlight text={item.name} words={searchWords} /></p>}
              {item.brand && <p className="brand"><Highlight text={item.brand} words={searchWords} /></p>}
              <div className="item-meta">
                <div className="qty-row">
                  <span className="qty-label">Ist</span>
                  <div className="qty-inline">
                    <button className="qty-btn-sm" onClick={() => handleSetQuantity(item.barcode, item.quantity - 1)} disabled={item.quantity <= 0}>−</button>
                    <span className="qty-display">{item.quantity}</span>
                    <button className="qty-btn-sm" onClick={() => handleSetQuantity(item.barcode, item.quantity + 1)}>+</button>
                  </div>
                </div>
                {!item.group_id && (
                  <div className="qty-row">
                    <span className="qty-label">Soll</span>
                    <div className="qty-inline soll">
                      <button className="qty-btn-sm" onClick={() => handleSetIdealStock(item.barcode, (item.ideal_stock || 0) - 1)} disabled={(item.ideal_stock || 0) <= 0}>−</button>
                      <span className={`qty-display ${item.ideal_stock > 0 && item.quantity < item.ideal_stock ? 'low' : ''}`}>{item.ideal_stock || 0}</span>
                      <button className="qty-btn-sm" onClick={() => handleSetIdealStock(item.barcode, (item.ideal_stock || 0) + 1)}>+</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="item-actions">
                <button className="edit-btn" onClick={() => startEditingProduct(item)}>✏️ Bearbeiten</button>
                {!item.group_id && (
                  <button className="group-btn" onClick={() => { setGroupingProduct(item.barcode); loadGroups(); }}>🔗 Gruppieren</button>
                )}
                {item.group_id && (
                  <button className="ungroup-btn" onClick={() => handleRemoveFromGroup(item.barcode)}>🔗✕ Entgruppieren</button>
                )}
                {confirmDelete === item.barcode ? (
                  <div className="confirm-delete">
                    <span>Alles löschen?</span>
                    <button className="confirm-yes" onClick={() => handleDelete(item.barcode)}>Ja</button>
                    <button className="confirm-no" onClick={() => setConfirmDelete(null)}>Nein</button>
                  </div>
                ) : (
                  <button className="delete-btn" onClick={() => setConfirmDelete(item.barcode)}>🗑️ Entfernen</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="inventory">
      <div className="inventory-header">
        <h2>Aktueller Bestand</h2>
      </div>

      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          ref={searchInputRef}
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

      {displayItems.length === 0 && (
        <div className="no-results">
          <p>Keine Artikel gefunden für "{search}"</p>
        </div>
      )}

      <div className="inventory-grid" ref={gridRef}>
        {displayItems.map((display) => {
          if (display.type === 'group') {
            const g = display;
            const expanded = expandedGroups.has(g.group_id);
            const isLow = g.group_ideal_stock > 0 && g.totalQuantity < g.group_ideal_stock;
            const imageUrl = g.group_image_url || g.members.find(m => m.image_url)?.image_url;
            return (
              <LazyItem key={`group-${g.group_id}`}>
                <div className={`inventory-item group-card${isLow ? ' low-stock' : ''}`}>
                  {isLow && <span className="low-stock-badge">Nachkaufen</span>}

                  {editingGroup === g.group_id ? (
                    <div className="group-edit-form">
                      <h3>Gruppe bearbeiten</h3>
                      <div className="edit-field">
                        <label>Name</label>
                        <input className="edit-input" value={editGroupForm.name} onChange={(e) => setEditGroupForm(prev => ({ ...prev, name: e.target.value }))} />
                      </div>
                      <div className="edit-field">
                        <label>Name (DE)</label>
                        <input className="edit-input" value={editGroupForm.name_de} onChange={(e) => setEditGroupForm(prev => ({ ...prev, name_de: e.target.value }))} />
                      </div>
                      <div className="edit-actions">
                        <button className="save-btn" onClick={() => handleSaveGroup(g.group_id)}>Speichern</button>
                        <button className="cancel-btn-sm" onClick={() => setEditingGroup(null)}>Abbrechen</button>
                        <button className="delete-btn" onClick={() => handleDeleteGroup(g.group_id)} style={{ marginLeft: 'auto' }}>🗑️ Gruppe auflösen</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {imageUrl && (
                        <div className="item-image" onClick={() => setZoomImage({ url: imageUrl, name: g.group_name_de || g.group_name })}>
                          <img src={imageUrl} alt={g.group_name} loading="lazy" />
                        </div>
                      )}
                      <div className="item-details">
                        <h3><Highlight text={g.group_name_de || g.group_name} words={searchWords} /> <span className="group-badge">{g.members.length} Varianten</span></h3>
                        <div className="item-meta">
                          <div className="qty-row">
                            <span className="qty-label">Ist (gesamt)</span>
                            <span className="qty-display">{g.totalQuantity}</span>
                          </div>
                          <div className="qty-row">
                            <span className="qty-label">Soll</span>
                            <div className="qty-inline soll">
                              <button className="qty-btn-sm" onClick={() => handleSetGroupIdealStock(g.group_id, g.group_ideal_stock - 1)} disabled={g.group_ideal_stock <= 0}>−</button>
                              <span className={`qty-display ${isLow ? 'low' : ''}`}>{g.group_ideal_stock}</span>
                              <button className="qty-btn-sm" onClick={() => handleSetGroupIdealStock(g.group_id, g.group_ideal_stock + 1)}>+</button>
                            </div>
                          </div>
                        </div>
                        <div className="item-actions">
                          <button className="edit-btn" onClick={() => startEditingGroup(g)}>✏️ Bearbeiten</button>
                          <button className="group-expand-btn" onClick={() => toggleGroup(g.group_id)}>
                            {expanded ? '▲ Zuklappen' : '▼ Varianten anzeigen'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {expanded && (
                    <div className="group-members">
                      {g.members.map(member => (
                        <div key={member.barcode} className="group-member-card">
                          {renderItemCard(member)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </LazyItem>
            );
          } else {
            const item = display.item;
            return (
              <LazyItem key={item.id}>
                {renderItemCard(item)}
              </LazyItem>
            );
          }
        })}
      </div>

      <div className="inventory-summary">
        <div className="summary-card">
          <div className="summary-number">{totalProducts}</div>
          <div className="summary-label">{query ? 'Gefundene Produkte' : 'Verschiedene Produkte'}</div>
        </div>
        <div className="summary-card">
          <div className="summary-number">{totalArticles}</div>
          <div className="summary-label">{query ? 'Gefundene Artikel' : 'Artikel gesamt'}</div>
        </div>
      </div>

      {/* Grouping modal */}
      {groupingProduct && (
        <div className="modal-overlay" onClick={() => setGroupingProduct(null)}>
          <div className="modal-content grouping-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Produkt gruppieren</h2>
            <p className="grouping-hint">Wähle eine bestehende Gruppe oder erstelle eine neue.</p>

            {groups.length > 0 && (
              <div className="existing-groups">
                <h3>Bestehende Gruppen</h3>
                {groups.map(g => (
                  <button key={g.id} className="group-option" onClick={() => handleAddToGroup(groupingProduct, g.id)}>
                    <span className="group-option-name">{g.name_de || g.name}</span>
                    <span className="group-option-count">{g.member_count} Produkte</span>
                  </button>
                ))}
              </div>
            )}

            <div className="new-group-section">
              <h3>Neue Gruppe erstellen</h3>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Gruppenname (z.B. Gehackte Tomaten)"
                className="group-name-input"
              />
              <button className="save-btn" onClick={() => handleCreateGroupWith(groupingProduct)}>
                Gruppe erstellen
              </button>
            </div>

            <button className="cancel-btn-sm" onClick={() => setGroupingProduct(null)}>Abbrechen</button>
          </div>
        </div>
      )}

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
