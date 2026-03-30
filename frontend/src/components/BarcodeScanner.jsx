import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import './BarcodeScanner.css';

const BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
];

function BarcodeScanner({ onScan, disabled }) {
  const [isScanning, setIsScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [error, setError] = useState(null);
  const html5QrCodeRef = useRef(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    // Get available cameras
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (!mounted) return;
        
        if (devices && devices.length) {
          console.log('Available cameras:', devices);
          setCameras(devices);
          // Prefer back camera
          const backCamera = devices.find(
            (device) => device.label.toLowerCase().includes('back') || 
                       device.label.toLowerCase().includes('rear')
          );
          setSelectedCamera(backCamera?.id || devices[0].id);
        } else {
          setError('Keine Kameras auf diesem Gerät gefunden');
        }
      })
      .catch((err) => {
        console.error('Error getting cameras:', err);
        setError('Kamerazugriff fehlgeschlagen. Bitte Berechtigungen prüfen.');
      });

    return () => {
      mounted = false;
      // Cleanup on unmount
      if (html5QrCodeRef.current && isInitializedRef.current) {
        html5QrCodeRef.current.stop()
          .catch(() => {})
          .finally(() => {
            html5QrCodeRef.current = null;
            isInitializedRef.current = false;
          });
      } else {
        html5QrCodeRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, []);

  const startScanning = async () => {
    if (!selectedCamera) {
      alert('Keine Kamera verfügbar');
      return;
    }

    setError(null);

    try {
      // Initialize scanner if not already initialized
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode('barcode-reader', {
          formatsToSupport: BARCODE_FORMATS,
          verbose: false
        });
      }
      
      // Check if already scanning
      if (isInitializedRef.current) {
        console.log('Scanner already initialized');
        return;
      }

      console.log('Starting camera with ID:', selectedCamera);
      
      await html5QrCodeRef.current.start(
        selectedCamera,
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
        },
        (decodedText) => {
          // Successfully scanned
          console.log('Barcode scanned:', decodedText);
          // Use setTimeout to avoid calling stop() from within the callback
          setTimeout(() => {
            onScan(decodedText);
            stopScanning();
          }, 0);
        },
        (errorMessage) => {
          // Scanning error (ignore, happens frequently while scanning)
        }
      );

      isInitializedRef.current = true;
      setIsScanning(true);
      console.log('Camera started successfully');
    } catch (err) {
      console.error('Error starting scanner:', err);
      setError('Kamera konnte nicht gestartet werden: ' + err.message);
      isInitializedRef.current = false;
    }
  };

  const stopScanning = async () => {
    if (html5QrCodeRef.current && isInitializedRef.current) {
      try {
        isInitializedRef.current = false;
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (err) {
        // Ignore - scanner may not be running
      }
    }
    setIsScanning(false);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualBarcode.trim()) {
      onScan(manualBarcode.trim());
      setManualBarcode('');
    }
  };

  return (
    <div className="barcode-scanner">
      {error && (
        <div className="error-message">
          <p>❌ {error}</p>
        </div>
      )}

      {cameras.length > 0 && (
        <div className="camera-controls">
          {cameras.length > 1 && (
            <select
              value={selectedCamera || ''}
              onChange={(e) => setSelectedCamera(e.target.value)}
              disabled={isScanning}
              className="camera-select"
            >
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.label}
                </option>
              ))}
            </select>
          )}
          
          {!isScanning ? (
            <button
              onClick={startScanning}
              disabled={disabled}
              className="btn btn-primary"
            >
              📷 Kamera starten
            </button>
          ) : (
            <button onClick={stopScanning} className="btn btn-secondary">
              ⏹ Kamera stoppen
            </button>
          )}
        </div>
      )}

      <div id="barcode-reader" className="scanner-view"></div>

      <div className="manual-input">
        <p className="or-divider">ODER</p>
        <form onSubmit={handleManualSubmit}>
          <input
            type="text"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder="Barcode manuell eingeben"
            disabled={disabled}
            className="barcode-input"
          />
          <button type="submit" disabled={disabled || !manualBarcode.trim()} className="btn btn-primary">
            Absenden
          </button>
        </form>
      </div>

      {cameras.length === 0 && !error && (
        <div className="no-camera-message">
          <p>⚠️ Keine Kamera erkannt. Bitte Barcode manuell eingeben.</p>
        </div>
      )}
    </div>
  );
}

export default BarcodeScanner;
