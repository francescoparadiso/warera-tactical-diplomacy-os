// ==================== CSV ====================
function parseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += char; }
  }
  result.push(current.trim());
  return result;
}

export function parseCSV(csvText) {
  const rows = [];
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return rows;
  const headers = parseLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx]; });
      rows.push(row);
    }
  }
  return rows;
}

// ==================== TOAST ====================
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== LOADING ====================
export function showLoading() {
  document.getElementById('loading-overlay').style.display = 'flex';
}
export function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 300);
}

// ==================== COLORI ====================
export function hashColor(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 45%, 32%)`;
}

// ==================== GEOMETRY ====================
export function flattenCoords(geometry) {
  const result = [];
  function extract(c) {
    if (!c) return;
    if (typeof c[0] === 'number') result.push(c);
    else c.forEach(extract);
  }
  extract(geometry.coordinates);
  return result;
}
