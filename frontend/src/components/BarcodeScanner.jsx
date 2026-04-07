import { useState, useEffect, useRef } from 'react';
import { BarcodeDetector } from 'barcode-detector/ponyfill';
import './BarcodeScanner.css';

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

function BarcodeScanner({ onScan, disabled }) {
  const [manualBarcode, setManualBarcode] = useState('');
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [inputActive, setInputActive] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const scannedRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (disabled) {
      stopCamera();
      return;
    }
    detectorRef.current = new BarcodeDetector({ formats: BARCODE_FORMATS });
    startCamera();
    return () => stopCamera();
  }, [disabled]);

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const startCamera = async () => {
    setError(null);
    scannedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
        detectLoop();
      }
    } catch {
      setError('Kamerazugriff fehlgeschlagen. Bitte Berechtigungen prüfen.');
    }
  };

  const detectLoop = async () => {
    if (!videoRef.current || scannedRef.current || !streamRef.current) return;
    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (barcodes.length > 0 && !scannedRef.current) {
        scannedRef.current = true;
        stopCamera();
        onScan(barcodes[0].rawValue);
        return;
      }
    } catch { /* ignore frame errors */ }
    rafRef.current = requestAnimationFrame(detectLoop);
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

      <div className="native-scanner">
        <video ref={videoRef} autoPlay playsInline muted className="scanner-video" />
        {scanning && <div className="scan-line" />}
      </div>

      <div className="manual-input">
        <p className="or-divider">ODER</p>
        <form onSubmit={handleManualSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            onFocus={() => setInputActive(true)}
            readOnly={!inputActive}
            placeholder="Barcode manuell eingeben"
            disabled={disabled}
            className="barcode-input"
          />
          <button type="submit" disabled={disabled || !manualBarcode.trim()} className="btn btn-primary">
            Absenden
          </button>
        </form>
      </div>
    </div>
  );
}

export default BarcodeScanner;
