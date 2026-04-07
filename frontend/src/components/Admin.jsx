import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../authFetch';
import './Admin.css';

const ACTION_ICONS = {
  'Eingebucht': '📥',
  'Ausgebucht': '📤',
  'Menge geändert': '🔢',
  'Soll geändert': '🎯',
  'Produkt bearbeitet': '✏️',
  'Produkt gelöscht': '🗑️',
  'Gruppe erstellt': '📦',
  'Gruppe bearbeitet': '📦✏️',
  'Gruppe gelöscht': '📦🗑️',
  'Zu Gruppe hinzugefügt': '➕',
  'Aus Gruppe entfernt': '➖',
};

function formatTime(dateStr) {
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  let relative;
  if (diffMin < 1) relative = 'gerade eben';
  else if (diffMin < 60) relative = `vor ${diffMin} Min.`;
  else if (diffH < 24) relative = `vor ${diffH} Std.`;
  else if (diffD < 7) relative = `vor ${diffD} Tag${diffD > 1 ? 'en' : ''}`;
  else relative = d.toLocaleDateString('de-DE');

  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return { relative, full: `${date} ${time}` };
}

export default function Admin({ onBack }) {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLogs = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/audit-log?page=${p}&limit=50`);
      if (!res.ok) throw new Error('Fehler beim Laden');
      const data = await res.json();
      setLogs(data.logs);
      setTotalPages(data.pages);
      setTotal(data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(page); }, [page, fetchLogs]);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <button className="admin-back-btn" onClick={onBack}>← Zurück</button>
        <h1>Aktivitätsprotokoll</h1>
        <span className="admin-total">{total} Einträge</span>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {loading ? (
        <div className="admin-loading">Laden…</div>
      ) : logs.length === 0 ? (
        <div className="admin-empty">Noch keine Aktivitäten aufgezeichnet.</div>
      ) : (
        <div className="admin-log-list">
          {logs.map((log) => {
            const t = formatTime(log.created_at);
            return (
              <div key={log.id} className="admin-log-item">
                <div className="log-icon">{ACTION_ICONS[log.action] || '📋'}</div>
                <div className="log-content">
                  <div className="log-action">{log.action}</div>
                  {log.product_name && <div className="log-product">{log.product_name}</div>}
                  {log.details && <div className="log-details">{log.details}</div>}
                  <div className="log-meta">
                    <span className="log-time" title={t.full}>{t.relative}</span>
                    {log.device && <span className="log-device">📱 {log.device}</span>}
                    {log.ip && <span className="log-ip">{log.ip}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="admin-pagination">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Zurück</button>
          <span>Seite {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Weiter →</button>
        </div>
      )}
    </div>
  );
}
