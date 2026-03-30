import { useState } from 'react';
import './ProductFormFields.css';

function ProductFormFields({ formData, setFormData, barcode, showBarcode = false }) {
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const uploadData = new FormData();
      uploadData.append('image', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: uploadData,
      });

      if (response.ok) {
        const data = await response.json();
        setFormData(prev => ({ ...prev, image_url: data.image_url }));
      }
    } catch (error) {
      console.error('Error uploading image:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="product-fields">
      {showBarcode && (
        <div className="pf-field">
          <label>Barcode</label>
          <input type="text" value={barcode} disabled className="pf-input" />
        </div>
      )}

      <div className="pf-field">
        <label>Name (Original) *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          required
          className="pf-input"
          placeholder="Produktname eingeben"
        />
      </div>

      <div className="pf-field">
        <label>Deutscher Name</label>
        <input
          type="text"
          value={formData.name_de}
          onChange={(e) => setFormData(prev => ({ ...prev, name_de: e.target.value }))}
          className="pf-input"
          placeholder="Deutsche Übersetzung (optional)"
        />
      </div>

      <div className="pf-field">
        <label>Marke</label>
        <input
          type="text"
          value={formData.brand}
          onChange={(e) => setFormData(prev => ({ ...prev, brand: e.target.value }))}
          className="pf-input"
          placeholder="Markenname eingeben (optional)"
        />
      </div>

      <div className="pf-field">
        <label>Produktbild</label>
        <div className="pf-image-controls">
          <label className="pf-upload-btn">
            📷 Bild hochladen
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={uploading}
              hidden
            />
          </label>
          <span className="pf-upload-or">oder</span>
          <input
            type="text"
            value={formData.image_url}
            onChange={(e) => setFormData(prev => ({ ...prev, image_url: e.target.value }))}
            className="pf-input"
            placeholder="Bild-URL eingeben"
          />
        </div>
        {uploading && <p className="pf-upload-status">Wird hochgeladen…</p>}
        {formData.image_url && (
          <div className="pf-image-preview">
            <img src={formData.image_url} alt="Vorschau" onError={(e) => e.target.style.display = 'none'} />
          </div>
        )}
      </div>

      <div className="pf-field">
        <label>Soll-Bestand</label>
        <input
          type="number"
          min="0"
          value={formData.ideal_stock || 0}
          onChange={(e) => setFormData(prev => ({ ...prev, ideal_stock: Math.max(0, parseInt(e.target.value) || 0) }))}
          className="pf-input"
          placeholder="0 = kein Soll-Bestand"
        />
        <span className="pf-hint">Für die Einkaufsliste: Wenn der Bestand darunter fällt, wird das Produkt angezeigt.</span>
      </div>
    </div>
  );
}

export default ProductFormFields;
