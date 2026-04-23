import { state } from './state.js';
import { COLORS } from './config.js';

// ==================== LEGENDA ====================
export function updateDynamicLegend() {
  const box = document.getElementById('dynamic-legend');

  if (state.coloringMode === 'blocs') {
    let html = '';
    state.externalBlocsInfo.forEach(b => html += `<div class="legend-item"><div class="dot" style="background:${b.color}"></div><span>${b.name}</span></div>`);
    const multi = [...state.multiBlocMap.values()];
    if (multi.length) html += `<div class="legend-item"><div class="dot" style="background:linear-gradient(135deg,${multi[0].colors[0]} 50%,${multi[0].colors[1]} 50%)"></div><span>Multi-bloc</span></div>`;
    html += `<div class="legend-item"><div class="dot" style="background:${COLORS.DEFAULT_LAND};border:1px solid rgba(255,255,255,0.3)"></div><span>Other</span></div>`;
    box.innerHTML = html;
    return;
  }

  if (!state.selectedCountryId) {
    box.innerHTML = `<div class="legend-item"><div class="dot" style="background:#555"></div><span>NO SELECTION</span></div><div class="legend-item"><div class="dot" style="background:${COLORS.NAP}"></div><span>MANUAL NAP</span></div>${state.mapSource === 'original' ? '<div style="font-size:10px;color:#666;margin-top:8px;">Original owners</div>' : ''}`;
    return;
  }

  box.innerHTML = `
    <div class="legend-item"><div class="dot" style="background:${COLORS.SELECTED}"></div><span>SELECTED NATION</span></div>
    <div class="legend-item"><div class="dot" style="background:${COLORS.NAP}"></div><span>MANUAL NAP</span></div>
    <div class="legend-item"><div class="dot" style="background:${COLORS.WAR_DIRECT}"></div><span>DIRECT WAR</span></div>
    <div class="legend-item"><div class="dot" style="background:${COLORS.WAR_INDIRECT}"></div><span>INDIRECT ENEMY</span></div>
    <div class="legend-item"><div class="dot" style="background:${COLORS.ALLY_DIRECT}"></div><span>DIRECT ALLY</span></div>
    <div class="legend-item"><div class="dot" style="background:${COLORS.ALLY_INDIRECT}"></div><span>INDIRECT ALLY</span></div>
    <div class="legend-item"><div class="dot" style="background:${COLORS.DEFAULT_LAND};border:1px solid rgba(255,255,255,0.3)"></div><span>NEUTRAL</span></div>
    ${state.mapSource === 'original' ? '<div style="font-size:10px;color:#666;margin-top:8px;">Original territory borders</div>' : ''}
  `;
}

// ==================== STATS ====================
export function updateStats() {
  const allies = state.selectedCountryId ? (state.nationMap.get(state.selectedCountryId)?.allies?.length ?? 0) : 0;
  const wars   = state.selectedCountryId ? (state.nationMap.get(state.selectedCountryId)?.warsWith?.length ?? 0) : 0;
  const naps   = state.customNaps.length;

  document.getElementById('stats-allies').textContent = allies;
  document.getElementById('stats-wars').textContent   = wars;
  document.getElementById('stats-naps').textContent   = naps;
  document.getElementById('chip-allies').textContent  = allies;
  document.getElementById('chip-wars').textContent    = wars;
  document.getElementById('chip-naps').textContent    = naps;
}

// ==================== SELECTED DISPLAY ====================
export function updateSelectedDisplay() {
  const display     = document.getElementById('selected-display');
  const nameDisplay = document.getElementById('selected-name-display');
  const flagWrapper = document.getElementById('flag-wrapper');

  if (!state.selectedCountryId) { display.style.display = 'none'; return; }
  const nation = state.nationMap.get(state.selectedCountryId);
  if (!nation) { display.style.display = 'none'; return; }

  nameDisplay.textContent = nation.name;

  let code = '';
  if (state.mapSource === 'original') {
    code = state.originalLabelsData.find(l => l.properties.countryId === state.selectedCountryId)?.properties?.countryCode || nation.code?.toLowerCase() || '';
  } else {
    code = state.labelsData.find(l => l.properties?.countryId === state.selectedCountryId)?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
  }

  flagWrapper.innerHTML = '';
  if (code) {
    const img = document.createElement('img');
    img.alt = `${nation.name} flag`;
    img.style.cssText = 'display:inline-block!important;width:24px!important;height:16px!important;object-fit:contain!important;border-radius:2px!important;border:1px solid #00d4ff!important;background:#1a1a1a!important;vertical-align:middle!important;';
    img.src = `https://app.warera.io/images/map/${code}.png?v=21`;
    img.onload  = () => { img.style.border = '1px solid #2ecc71'; };
    img.onerror = () => { img.style.border = '1px solid #ff4747'; img.style.backgroundColor = '#ff4747'; };
    flagWrapper.appendChild(img);
  }
  display.style.display = 'block';
}

// ==================== NAP BADGE ====================
export function updateNapBadge(count) {
  document.getElementById('nap-count').textContent = count;
}

// ==================== EXTERNAL NAPS LIST ====================
export function updateExternalNapsUI() {
  const container = document.getElementById('externalNapList');
  if (!state.externalNapsList.length) {
    container.innerHTML = '<div class="empty-state">No external NAPs loaded</div>';
    return;
  }
  const grouped = new Map();
  state.externalNapsList.forEach(nap => {
    if (!grouped.has(nap.fromId)) grouped.set(nap.fromId, []);
    grouped.get(nap.fromId).push(nap.toName);
  });
  let html = '';
  for (const [fromId, toNames] of grouped) {
    const from = state.nationMap.get(fromId);
    if (from) html += `<div class="nap-item" style="border-left-color:#55a5d9;"><span>${from.name}</span><span style="color:#aaa;">→ ${toNames.join(', ')}</span></div>`;
  }
  container.innerHTML = html;
}

// ==================== TOGGLE NAP SECTION ====================
export function toggleNapSection(sectionId) {
  const section = document.getElementById(sectionId);
  const iconId  = sectionId === 'manual-nap-section' ? 'manual-nap-icon' : 'external-nap-icon';
  const icon    = document.getElementById(iconId);
  if (!section || !icon) return;
  if (section.style.maxHeight && section.style.maxHeight !== '0px') {
    section.style.maxHeight = '0';
    icon.innerHTML = '▶';
  } else {
    section.style.maxHeight = '200px';
    icon.innerHTML = '▼';
  }
}

// ==================== SYNC UI ====================
export function syncUIToState() {
  const isOriginal = state.mapSource === 'original';
  document.getElementById('toggle-borders').checked = isOriginal;

  const lA = document.getElementById('label-actual');
  const lO = document.getElementById('label-original');
  if (lA && lO) {
    lA.classList.toggle('active', !isOriginal);
    lO.classList.toggle('active',  isOriginal);
  }

  document.getElementById('mode-diplomacy').classList.toggle('active', state.coloringMode === 'diplomacy');
  document.getElementById('mode-blocs').classList.toggle('active',     state.coloringMode === 'blocs');
}