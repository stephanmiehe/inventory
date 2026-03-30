import { useState, useRef, useCallback, useEffect } from 'react';
import ProductFormFields from './ProductFormFields';
import { authFetch } from '../authFetch';
import './ProductModal.css';

function ProductModal({ product, barcode, onConfirm, onEdit, onCancel }) {
  const [quantity, setQuantity] = useState(1);

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Produkt bestätigen</h2>
        
        <div className="product-preview">
          {product.image_url && (
            <img src={product.image_url} alt={product.name} className="product-image" />
          )}
          
          <div className="product-info">
            <h3>{product.name}</h3>
            {product.name_de && <p className="name-de-modal">{product.name_de}</p>}
            {product.brand && <p className="brand">{product.brand}</p>}
            <p className="barcode-text">Barcode: {barcode}</p>
          </div>
        </div>

        <p className="confirmation-question">Ist dies das richtige Produkt?</p>

        <div className="quantity-selector">
          <label htmlFor="qty-in">Anzahl:</label>
          <div className="quantity-controls">
            <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} className="qty-btn">−</button>
            <input
              type="number"
              id="qty-in"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="qty-input"
            />
            <button type="button" onClick={() => setQuantity(q => q + 1)} className="qty-btn">+</button>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={() => onConfirm(quantity)} className="btn btn-primary">
            ✓ Ja, {quantity > 1 ? `${quantity} Artikel` : 'zum Bestand'} hinzufügen
          </button>
          <button onClick={onEdit} className="btn btn-secondary">
            ✏️ Nein, Details bearbeiten
          </button>
          <button onClick={onCancel} className="btn btn-cancel">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductEditForm({ barcode, initialProduct, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: initialProduct?.name || '',
    name_de: initialProduct?.name_de || '',
    brand: initialProduct?.brand || '',
    image_url: initialProduct?.image_url || ''
  });
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeError, setRecognizeError] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  // Clean up camera on unmount
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setRecognizeError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      streamRef.current = stream;
      setCameraOpen(true);
      // Wait for ref to be attached after render
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch {
      setRecognizeError('Kamera konnte nicht geöffnet werden');
    }
  };

  const captureAndRecognize = async () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    stopCamera();
    setRecognizing(true);
    setRecognizeError(null);

    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      const uploadData = new FormData();
      uploadData.append('image', blob, 'capture.jpg');

      const response = await authFetch('/api/recognize', {
        method: 'POST',
        body: uploadData,
      });

      if (response.ok) {
        const data = await response.json();
        setFormData(prev => ({
          ...prev,
          name: data.name || prev.name,
          name_de: data.name_de || prev.name_de,
          brand: data.brand || prev.brand,
          image_url: data.image_url || prev.image_url,
        }));
      } else if (response.status === 501) {
        setRecognizeError('Bilderkennung nicht konfiguriert');
      } else {
        setRecognizeError('Erkennung fehlgeschlagen');
      }
    } catch {
      setRecognizeError('Verbindung fehlgeschlagen');
    } finally {
      setRecognizing(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Produktdetails bearbeiten</h2>
        
        <form onSubmit={handleSubmit} className="product-form">
          <div className="recognize-section">
            {cameraOpen ? (
              <div className="camera-viewfinder">
                <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                <div className="camera-controls">
                  <button type="button" onClick={stopCamera} className="btn btn-cancel camera-cancel-btn">✕</button>
                  <button type="button" onClick={captureAndRecognize} className="camera-shutter" />
                </div>
              </div>
            ) : (
              <>
                <button type="button" onClick={startCamera} className="recognize-btn" disabled={recognizing}>
                  {recognizing ? '⏳ Wird erkannt…' : '📸 Produkt fotografieren'}
                </button>
                <span className="recognize-hint">Foto aufnehmen, um Produktdaten automatisch zu erkennen</span>
              </>
            )}
            {recognizeError && <p className="recognize-error">{recognizeError}</p>}
            <canvas ref={canvasRef} hidden />
          </div>

          <ProductFormFields
            formData={formData}
            setFormData={setFormData}
            barcode={barcode}
            showBarcode
          />

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">
              Speichern & hinzufügen
            </button>
            <button type="button" onClick={onCancel} className="btn btn-cancel">
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { ProductModal, ProductEditForm, ScanOutModal };

function ScanOutModal({ product, barcode, maxQuantity, onConfirm, onCancel }) {
  const [quantity, setQuantity] = useState(1);

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Aus dem Bestand entfernen</h2>
        
        <div className="product-preview">
          {product.image_url && (
            <img src={product.image_url} alt={product.name} className="product-image" />
          )}
          
          <div className="product-info">
            <h3>{product.name}</h3>
            {product.brand && <p className="brand">{product.brand}</p>}
            <p className="barcode-text">Barcode: {barcode}</p>
            <p className="stock-info">Auf Lager: {maxQuantity}</p>
          </div>
        </div>

        <div className="quantity-selector">
          <label htmlFor="qty-out">Wie viele entfernen?</label>
          <div className="quantity-controls">
            <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} className="qty-btn">−</button>
            <input
              type="number"
              id="qty-out"
              min="1"
              max={maxQuantity}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(maxQuantity, parseInt(e.target.value) || 1)))}
              className="qty-input"
            />
            <button type="button" onClick={() => setQuantity(q => Math.min(maxQuantity, q + 1))} className="qty-btn">+</button>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={() => onConfirm(quantity)} className="btn btn-primary">
            {quantity > 1 ? `${quantity} Artikel` : '1 Artikel'} entfernen
          </button>
          <button onClick={onCancel} className="btn btn-cancel">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
