// ui.js
import { state } from './state.js';
import { COLORS } from './config.js';
import { getAllianceAllies, getDualAllyDefensiveIds } from './diplomacy.js';
import { fmtNumber } from './utils.js'; // Aggiunto per formattare i numeri nella legenda

function _fmtDmg(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

const TOAST_ICONS = {
  info: '💬',
  success: '✅',
  error: '❌',
  warning: '⚠️',
};

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
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

export function updateDynamicLegend() {
  const box = document.getElementById('dynamic-legend');

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

  if (state.coloringMode === 'weeklyDamage') {
    let min = Infinity, max = -Infinity;
    for (const nation of state.nationMap.values()) {
      const dmg = nation?.rankings?.weeklyCountryDamages?.value;
      if (typeof dmg === 'number' && dmg >= 0) {
        if (dmg < min) min = dmg;
        if (dmg > max) max = dmg;
      }
    }
    box.innerHTML = `
      <div class="legend-section-title">Weekly Damage</div>
      <div style="margin:4px 0;">
        <div style="width:100%;height:14px;background:linear-gradient(to right, #4575b4, #d73027);border-radius:3px;"></div>
      </div>
      <div class="legend-note">Higher = darker</div>
    `;
    return;
  }

  if (state.coloringMode === 'sphereOfInfluence') {
    let html = '';
    state.sphereInfo.forEach(info => {
      const color = state.nationBaseColorMap.get(info.primaryId) || COLORS.DEFAULT_LAND;
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:${color};"></div>
          <div class="legend-info">
            <div class="legend-name">${info.primaryName}</div>
            <div class="legend-desc">${info.proxyIds.length} proxy nation${info.proxyIds.length === 1 ? '' : 's'}</div>
          </div>
        </div>`;
    });
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${COLORS.DEFAULT_LAND};opacity:0.6;"></div>
        <div class="legend-info"><div class="legend-name">Other</div></div>
      </div>`;
    box.innerHTML = html;
    return;
  }

  if (state.coloringMode === 'blocs') {
    let html = '';
    state.externalBlocsInfo.forEach(b => {
      const alliance = state.alliancesList.find(a => a.name === b.name);
      const memberCount = alliance ? alliance.memberCountries.length : 0;
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:${b.color};"></div>
          <div class="legend-info">
            <div class="legend-name">${b.name}</div>
            <div class="legend-desc">${memberCount} nations</div>
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

  // ==================== BATTLE HEATMAP ====================
// ui.js - sostituisci la sezione battleHeatmap nella funzione updateDynamicLegend

  // ==================== BATTLE HEATMAP ====================
  if (state.coloringMode === 'battleHeatmap' && state.battleHeatmapData) {
    const data = state.battleHeatmapData;
    
    // Calcola i totali per lato per la legenda
    const attackers = data.nations.filter(n => n.side === 'attacker');
    const defenders = data.nations.filter(n => n.side === 'defender');
    const totalAttackerDmg = attackers.reduce((sum, n) => sum + n.totalDamage, 0);
    const totalDefenderDmg = defenders.reduce((sum, n) => sum + n.totalDamage, 0);
    
    box.innerHTML = `
      <div class="legend-section-title">⚔️ Battle Heatmap</div>
      <div class="legend-item"><span style="font-weight:bold;">${data.battleName}</span></div>
      <div style="margin: 4px 0;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
          <span style="font-size:10px; color:#58a6ff;">Attacker</span>
          <div style="flex:1; height:12px; background:linear-gradient(to right, #B0D4FF, #0044FF); border-radius:3px;"></div>
          <span style="font-size:10px; color:#8b949e;">${fmtNumber(totalAttackerDmg)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:10px; color:#ff6b6b;">Defender</span>
          <div style="flex:1; height:12px; background:linear-gradient(to right, #FFB0B0, #FF0000); border-radius:3px;"></div>
          <span style="font-size:10px; color:#8b949e;">${fmtNumber(totalDefenderDmg)}</span>
        </div>
        <div style="font-size:10px; color:#484f58; margin-top:4px;">Percentuale = danno nazione / totale danno del lato</div>
      </div>
      <button id="exit-heatmap-btn" style="margin-top:8px; background:#ff4444; border:none; color:#fff; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600; width:100%; transition:background 0.15s;">✕ Exit Heatmap</button>
    `;
    
    // Gestione robusta del pulsante exit
    setTimeout(() => {
      const exitBtn = document.getElementById('exit-heatmap-btn');
      if (exitBtn) {
        const newExitBtn = exitBtn.cloneNode(true);
        exitBtn.parentNode.replaceChild(newExitBtn, exitBtn);
        newExitBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
        });
      }
    }, 50);
    return;
  }

  // Diplomacy mode (con o senza selezione)
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

  // Con nazione selezionata
  const target = state.nationMap.get(state.selectedCountryId);
  const dipl = state.diplomacyData.get(state.selectedCountryId);
  const defCount = dipl?.defensivePacts?.length || 0;
  const swornCount = dipl?.swornEnemy ? 1 : 0;
  const alliesCnt = getAllianceAllies(state.selectedCountryId).length;
  const warsCnt = target?.warsWith?.length ?? 0;
  const napsCnt = state.customNaps.length + _countExternalNaps();
  const dualCnt = getDualAllyDefensiveIds(state.selectedCountryId).length;

  let html = '';
  const items = [
    { color: COLORS.SELECTED, name: 'Selected', desc: 'The nation you clicked' },
    { color: COLORS.NAP, name: 'NAP', desc: 'Non-aggression pact' },
    { color: COLORS.DEFENSIVE_PACT, name: 'Defensive Pact', desc: 'Mutual defense agreement' },
    { color: COLORS.SWORN_ENEMY, name: 'Sworn Enemy', desc: 'Permanent enemy' },
    { color: COLORS.WAR_DIRECT, name: 'Direct war', desc: 'Active conflict' },
    { color: COLORS.WAR_INDIRECT, name: 'Indirect enemy', desc: "Enemy's allies" },
    { color: COLORS.ALLY_DIRECT, name: 'Direct ally', desc: 'Formal alliance' },
    { color: COLORS.ALLY_INDIRECT, name: 'Indirect ally', desc: "Ally's allies" },
    { color: COLORS.DEFAULT_LAND, name: 'Neutral', desc: 'No relation' },
  ];

  items.forEach(item => {
    let cnt = undefined;
    if (item.color === COLORS.ALLY_DIRECT) cnt = alliesCnt;
    else if (item.color === COLORS.WAR_DIRECT) cnt = warsCnt;
    else if (item.color === COLORS.NAP) cnt = napsCnt;
    else if (item.color === COLORS.DEFENSIVE_PACT) cnt = defCount;
    else if (item.color === COLORS.SWORN_ENEMY) cnt = swornCount;
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${item.color};${item.color === COLORS.DEFAULT_LAND ? 'opacity:0.6;' : ''}"></div>
        <div class="legend-info">
          <div class="legend-name">${item.name}</div>
          <div class="legend-desc">${item.desc}</div>
        </div>
        ${cnt !== undefined ? `<div class="legend-count">${cnt}</div>` : ''}
      </div>`;

    if (item.color === COLORS.ALLY_DIRECT && dualCnt > 0) {
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:linear-gradient(180deg,${COLORS.ALLY_DIRECT} 50%,${COLORS.DEFENSIVE_PACT} 50%);"></div>
          <div class="legend-info">
            <div class="legend-name">Ally + Defensive Pact</div>
            <div class="legend-desc">Same bloc, also defensive pact</div>
          </div>
          <div class="legend-count">${dualCnt}</div>
        </div>`;
    }
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

export function updateStats() {
  const allies = state.selectedCountryId ? getAllianceAllies(state.selectedCountryId).length : 0;
  const wars   = state.selectedCountryId ? (state.nationMap.get(state.selectedCountryId)?.warsWith?.length ?? 0) : 0;
  const naps   = state.customNaps.length;

  const setSafe = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setSafe('stats-allies', allies);
  setSafe('stats-wars',   wars);
  setSafe('stats-naps',   naps);
  setSafe('chip-allies',  allies);
  setSafe('chip-wars',    wars);
  setSafe('chip-naps',    naps);
}

export function updateSelectedDisplay() {
  const display = document.getElementById('selected-display');
  if (!state.selectedCountryId) { display.style.display = 'none'; return; }

  const nation = state.nationMap.get(state.selectedCountryId);
  if (!nation) { display.style.display = 'none'; return; }

  let code = '';
  if (state.mapSource === 'original') {
    code = state.originalLabelsData.find(l => l.properties.countryId === state.selectedCountryId)?.properties?.countryCode || nation.code?.toLowerCase() || '';
  } else {
    code = state.labelsData.find(l => l.properties?.countryId === state.selectedCountryId)?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
  }

  const allies = getAllianceAllies(state.selectedCountryId).length;
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

  document.getElementById('deselect-btn')?.addEventListener('click', () => {
    state.selectedCountryId = null;
    import('./map.js').then(m => m.renderMap());
  });
}

export function updateNapBadge(count) {
  document.getElementById('nap-count').textContent = count;
}

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

export function toggleNapSection(sectionId) {
  const body = document.getElementById(sectionId);
  const iconId = sectionId === 'manual-nap-section' ? 'manual-nap-icon' : 'external-nap-icon';
  const icon = document.getElementById(iconId);
  if (!body || !icon) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  icon.classList.toggle('open', !isOpen);
  icon.textContent = isOpen ? '▶' : '▶';
}

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
  document.getElementById('mode-weeklyDamage')?.classList.toggle('active', state.coloringMode === 'weeklyDamage');
  document.getElementById('mode-sphereOfInfluence')?.classList.toggle('active', state.coloringMode === 'sphereOfInfluence');
}