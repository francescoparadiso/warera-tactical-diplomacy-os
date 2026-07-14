import { API_KEY } from './config.js';
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
// ==================== TOOLTIP 429 ====================
let rateLimitTooltip = null;
let rateLimitTimeout = null;

export function showRateLimitTooltip() {
  // Rimuovi il tooltip esistente se presente
  hideRateLimitTooltip();
  
  // Crea il tooltip
  rateLimitTooltip = document.createElement('div');
  rateLimitTooltip.id = 'rate-limit-tooltip';
  rateLimitTooltip.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.9);
    background: rgba(13, 17, 23, 0.97);
    border: 1px solid rgba(255, 165, 0, 0.5);
    border-radius: 16px;
    padding: 24px 32px;
    z-index: 99999;
    color: #e6edf3;
    font-family: 'Inter', -apple-system, sans-serif;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(12px);
    max-width: 380px;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
  `;
  
  rateLimitTooltip.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 12px;">⏳</div>
    <div style="font-size: 18px; font-weight: 700; color: #ff9100; margin-bottom: 8px;">Too Many Requests</div>
    <div style="font-size: 14px; color: #8b949e; line-height: 1.5;">
      The server is receiving too many requests.<br>
      Please wait a moment before trying again.
    </div>
    <div style="margin-top: 16px; font-size: 12px; color: #484f58;">
      ⚡ Rate limit exceeded
    </div>
  `;
  
  document.body.appendChild(rateLimitTooltip);
  
  // Animazione di entrata
  requestAnimationFrame(() => {
    rateLimitTooltip.style.opacity = '1';
    rateLimitTooltip.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  
  // Auto-remove dopo 4 secondi
  if (rateLimitTimeout) clearTimeout(rateLimitTimeout);
  rateLimitTimeout = setTimeout(() => {
    hideRateLimitTooltip();
  }, 4000);
}

export function hideRateLimitTooltip() {
  if (rateLimitTooltip) {
    rateLimitTooltip.style.opacity = '0';
    rateLimitTooltip.style.transform = 'translate(-50%, -50%) scale(0.9)';
    setTimeout(() => {
      if (rateLimitTooltip && rateLimitTooltip.parentNode) {
        rateLimitTooltip.parentNode.removeChild(rateLimitTooltip);
      }
      rateLimitTooltip = null;
    }, 300);
  }
  if (rateLimitTimeout) {
    clearTimeout(rateLimitTimeout);
    rateLimitTimeout = null;
  }
}

// ==================== FETCH CON AUTENTICAZIONE ====================
export function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    'X-API-KEY': API_KEY,
  };
  return fetch(url, { ...options, headers });
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
export function fmtNumber(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
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
