import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Service worker registration with update detection
function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Check for updates every 30 seconds
    setInterval(() => reg.update(), 30 * 1000);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        // New SW installed and waiting — notify the app
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('sw-update-available'));
        }
      });
    });
  });

  // When the new SW takes over, reload the page
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

registerSW();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
