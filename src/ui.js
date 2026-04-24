import { state } from './state.js';
import { COLORS } from './config.js';

// ==================== TOAST ====================
const TOAST_ICONS = {
  info: '💬',
  success: '✅',
  error: '❌',
  warning: '⚠️',
};

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');

  // Separa titolo e dettaglio (opzionale: usa " | " come separatore)
  const parts = message.split(' | ');
  const title = parts[0];
  const detail = parts[1] || '';

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon ${type}">${TOAST_ICONS[type] || '💬'}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${detail ? `<div class="toast-msg">${detail}</div>` : ''}
      <div class="toast-progress"><div class="toast-prog-fill ${type}"></div></div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== LEGENDA ====================
const LEGEND_ITEMS = [
  { color: COLORS.SELECTED, name: 'Selected', desc: 'The nation you clicked' },
  { color: COLORS.NAP, name: 'NAP', desc: 'Non-aggression pact' },
  { color: COLORS.WAR_DIRECT, name: 'Direct war', desc: 'Active conflict' },
  { color: COLORS.WAR_INDIRECT, name: 'Indirect enemy', desc: "Enemy's allies" },
  { color: COLORS.ALLY_DIRECT, name: 'Direct ally', desc: 'Formal alliance' },
  { color: COLORS.ALLY_INDIRECT, name: 'Indirect ally', desc: "Ally's allies" },
  { color: COLORS.DEFAULT_LAND, name: 'Neutral', desc: 'No relation' },
];

export function updateDynamicLegend() {
  const box = document.getElementById('dynamic-legend');

  // ----- POPULATION MODE -----
  if (state.coloringMode === 'population') {
    let min = Infinity, max = -Infinity;
    for (const nation of state.nationMap.values()) {
      const pop = nation?.rankings?.countryActivePopulation?.value;
      if (typeof pop === 'number' && pop > 0) {
        if (pop < min) min = pop;
        if (pop > max) max = pop;
      }
    }

    box.innerHTML = `
      <div class="legend-section-title">Active Population</div>
      <div style="margin: 4px 0;">
        <div style="width:100%;height:14px;background:linear-gradient(to right, #ffffcc, #ff9900);border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding: 0 4px;">
        <span style="font-size:10px; color:#ccc;">${min.toLocaleString()}</span>
        <span style="font-size:10px; color:#ccc;">${max.toLocaleString()}</span>
      </div>
      <div class="legend-note">Higher = darker</div>
    `;
    return;
  }

  if (state.coloringMode === 'blocs') {
    let html = '';
    state.externalBlocsInfo.forEach(b => {
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:${b.color};"></div>
          <div class="legend-info">
            <div class="legend-name">${b.name}</div>
          </div>
        </div>`;
    });
    const multi = [...state.multiBlocMap.values()];
    if (multi.length) {
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:linear-gradient(180deg,${multi[0].colors[0]} 50%,${multi[0].colors[1]} 50%);"></div>
          <div class="legend-info">
            <div class="legend-name">Multi-bloc</div>
            <div class="legend-desc">Member of multiple alliances</div>
          </div>
        </div>`;
    }
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${COLORS.DEFAULT_LAND};opacity:0.6;"></div>
        <div class="legend-info"><div class="legend-name">Other</div></div>
      </div>`;
    box.innerHTML = html;
    return;
  }

  if (!state.selectedCountryId) {
    box.innerHTML = `
      <div class="legend-item">
        <div class="legend-bar" style="background:#3a3d46;"></div>
        <div class="legend-info">
          <div class="legend-name">No selection</div>
          <div class="legend-desc">Click a nation on the map</div>
        </div>
      </div>
      <div class="legend-item">
        <div class="legend-bar" style="background:${COLORS.NAP};"></div>
        <div class="legend-info">
          <div class="legend-name">NAP</div>
          <div class="legend-desc">Non-aggression pact</div>
        </div>
      </div>
      ${state.mapSource === 'original' ? '<div class="legend-note">Showing original territory borders</div>' : ''}
    `;
    return;
  }

  // Con nazione selezionata: mostra tutte le voci con conteggio
  const target = state.nationMap.get(state.selectedCountryId);
  const alliesCnt = target?.allies?.length ?? 0;
  const warsCnt = target?.warsWith?.length ?? 0;
  const napsCnt = state.customNaps.length + _countExternalNaps();

  const counts = {
    [COLORS.ALLY_DIRECT]: alliesCnt,
    [COLORS.WAR_DIRECT]: warsCnt,
    [COLORS.NAP]: napsCnt,
  };

  let html = '';
  LEGEND_ITEMS.forEach(item => {
    const cnt = counts[item.color];
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${item.color};${item.color === COLORS.DEFAULT_LAND ? 'opacity:0.6;' : ''}"></div>
        <div class="legend-info">
          <div class="legend-name">${item.name}</div>
          <div class="legend-desc">${item.desc}</div>
        </div>
        ${cnt !== undefined ? `<div class="legend-count">${cnt}</div>` : ''}
      </div>`;
  });
  if (state.mapSource === 'original') {
    html += '<div class="legend-note">Showing original territory borders</div>';
  }
  box.innerHTML = html;
}

function _countExternalNaps() {
  if (!state.selectedCountryId) return 0;
  let cnt = 0;
  state.externalNapsList.forEach(n => {
    if (n.fromId === state.selectedCountryId || n.toId === state.selectedCountryId) cnt++;
  });
  return cnt;
}

// ==================== STATS ====================
export function updateStats() {
  const allies = state.selectedCountryId ? (state.nationMap.get(state.selectedCountryId)?.allies?.length ?? 0) : 0;
  const wars = state.selectedCountryId ? (state.nationMap.get(state.selectedCountryId)?.warsWith?.length ?? 0) : 0;
  const naps = state.customNaps.length;

  document.getElementById('stats-allies').textContent = allies;
  document.getElementById('stats-wars').textContent = wars;
  document.getElementById('stats-naps').textContent = naps;
  document.getElementById('chip-allies').textContent = allies;
  document.getElementById('chip-wars').textContent = wars;
  document.getElementById('chip-naps').textContent = naps;
}

// ==================== SELECTED DISPLAY ====================
export function updateSelectedDisplay() {
  const display = document.getElementById('selected-display');
  if (!state.selectedCountryId) { display.style.display = 'none'; return; }

  const nation = state.nationMap.get(state.selectedCountryId);
  if (!nation) { display.style.display = 'none'; return; }

  // Recupera codice bandiera
  let code = '';
  if (state.mapSource === 'original') {
    code = state.originalLabelsData.find(l => l.properties.countryId === state.selectedCountryId)?.properties?.countryCode || nation.code?.toLowerCase() || '';
  } else {
    code = state.labelsData.find(l => l.properties?.countryId === state.selectedCountryId)?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
  }

  const allies = nation.allies?.length ?? 0;
  const wars = nation.warsWith?.length ?? 0;
  const naps = state.customNaps.length + _countExternalNaps();

  const flagHtml = code
    ? `<img src="https://app.warera.io/images/map/${code}.png?v=21" alt="${nation.name}" onerror="this.style.display='none'" />`
    : `<span class="selected-flag-fallback">🌍</span>`;

  display.innerHTML = `
    <div class="selected-flag-wrap">${flagHtml}</div>
    <div class="selected-info-col">
      <div class="selected-nation-name">${nation.name}</div>
      <div class="selected-nation-meta">${allies} allies · ${wars} wars · ${naps} NAPs</div>
    </div>
    <button id="deselect-btn" title="Deselect">✕</button>
  `;
  display.style.display = 'flex';

  // Deselect al click della ×
  document.getElementById('deselect-btn')?.addEventListener('click', () => {
    state.selectedCountryId = null;
    import('./map.js').then(m => m.renderMap());
  });
}

// ==================== NAP BADGE ====================
export function updateNapBadge(count) {
  document.getElementById('nap-count').textContent = count;
}

// ==================== NAP LIST ====================
export function updateNapListUI() {
  const container = document.getElementById('napList');
  updateNapBadge(state.customNaps.length);

  if (!state.customNaps.length) {
    container.innerHTML = '<div class="empty-state">No manual NAPs set</div>';
    return;
  }

  container.innerHTML = state.customNaps.map(id => {
    const n = state.nationMap.get(id);
    if (!n) return '';
    const code = (n.code || '').toLowerCase();
    const flagHtml = code
      ? `<img class="nap-flag-thumb" src="https://app.warera.io/images/map/${code}.png?v=21" alt="${n.name}" onerror="this.style.display='none'">`
      : `<div class="nap-flag-placeholder">?</div>`;
    return `
      <div class="nap-item">
        ${flagHtml}
        <span class="nap-name">${n.name}</span>
        <span class="remove-nap" data-id="${id}" title="Remove">✕</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.remove-nap').forEach(btn => {
    btn.addEventListener('click', () => {
      import('./naps.js').then(({ rimuoviNap }) => rimuoviNap(btn.dataset.id));
    });
  });
}

// ==================== EXTERNAL NAPS UI ====================
export function updateExternalNapsUI() {
  const container = document.getElementById('externalNapList');
  if (!state.externalNapsList.length) {
    container.innerHTML = '<div class="empty-state">No external NAPs loaded</div>';
    return;
  }

  // Raggruppa per nazione sorgente
  const grouped = new Map();
  state.externalNapsList.forEach(nap => {
    if (!grouped.has(nap.fromId)) grouped.set(nap.fromId, []);
    grouped.get(nap.fromId).push(nap.toName);
  });

  let html = '';
  for (const [fromId, toNames] of grouped) {
    const from = state.nationMap.get(fromId);
    if (!from) continue;
    const code = (from.code || '').toLowerCase();
    const flagHtml = code
      ? `<img class="nap-flag-thumb" src="https://app.warera.io/images/map/${code}.png?v=21" alt="${from.name}" onerror="this.style.display='none'">`
      : `<div class="nap-flag-placeholder">?</div>`;
    html += `
      <div class="nap-item external">
        ${flagHtml}
        <span class="nap-name">${from.name}</span>
        <span class="nap-to" title="${toNames.join(', ')}">→ ${toNames.length > 2 ? toNames.slice(0, 2).join(', ') + ` +${toNames.length - 2}` : toNames.join(', ')}</span>
      </div>`;
  }
  container.innerHTML = html;
}

// ==================== TOGGLE COLLAPSIBLE ====================
export function toggleNapSection(sectionId) {
  const body = document.getElementById(sectionId);
  const iconId = sectionId === 'manual-nap-section' ? 'manual-nap-icon' : 'external-nap-icon';
  const icon = document.getElementById(iconId);
  if (!body || !icon) return;

  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  icon.classList.toggle('open', !isOpen);
  icon.textContent = isOpen ? '▶' : '▶'; // la rotazione è via CSS
}

// ==================== SYNC UI ====================
export function syncUIToState() {
  const isOriginal = state.mapSource === 'original';
  document.getElementById('toggle-borders').checked = isOriginal;

  const lA = document.getElementById('label-actual');
  const lO = document.getElementById('label-original');
  if (lA && lO) {
    lA.classList.toggle('active', !isOriginal);
    lO.classList.toggle('active', isOriginal);
  }
  document.getElementById('mode-population')?.classList.toggle('active', state.coloringMode === 'population');
  document.getElementById('mode-diplomacy').classList.toggle('active', state.coloringMode === 'diplomacy');
  document.getElementById('mode-blocs').classList.toggle('active', state.coloringMode === 'blocs');
}