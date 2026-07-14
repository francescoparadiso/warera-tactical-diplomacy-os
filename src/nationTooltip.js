import { state } from './state.js';

let hoverSuppressed = false;

// ==================== HELPERS ====================
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  const offset = 0x1F1E6 - 65;
  return String.fromCodePoint(
    code.toUpperCase().charCodeAt(0) + offset,
    code.toUpperCase().charCodeAt(1) + offset
  );
}

function getTooltipEl() {
  let el = document.getElementById('nation-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nation-tooltip';
    el.className = 'nation-tooltip';
    document.body.appendChild(el);
  }
  return el;
}

function buildContent(nation, code, blocInfo) {
  const pop = nation?.rankings?.countryActivePopulation?.value || 0;
  const wealth = nation?.rankings?.countryWealth?.value ?? nation.money ?? 0;
  const dmg = nation?.rankings?.weeklyCountryDamages?.value || 0;
  const dev = nation?.rankings?.countryDevelopment?.value;
  const wars = nation?.warsWith?.length || 0;

  const dipl = state.diplomacyData.get(nation._id);
  const defPacts = dipl?.defensivePacts?.length || 0;
  let swornEnemyName = '';
  if (dipl?.swornEnemy) {
    const enemy = state.nationMap.get(dipl.swornEnemy);
    if (enemy) swornEnemyName = enemy.name;
  }

  const flagUrl = code ? `https://app.warera.io/images/map/${code}.png?v=21` : null;

  let html = `
    <div class="nt-header">
      ${flagUrl
      ? `<img class="nt-flag" src="${flagUrl}" alt="" onerror="this.style.display='none'">`
      : `<span class="nt-emoji">${getFlagEmoji(code)}</span>`
    }
      <span class="nt-name">${nation.name}</span>
      ${blocInfo ? `<span class="nt-bloc" style="background:${blocInfo.color}22;color:${blocInfo.color}">${blocInfo.name}</span>` : ''}
    </div>
    <div class="nt-grid">
      <div class="nt-item"><span class="nt-icon">👥</span><span class="nt-val">${fmt(pop)}</span><span class="nt-lbl">pop.</span></div>
      <div class="nt-item"><span class="nt-icon">💰</span><span class="nt-val">${fmt(wealth)}</span><span class="nt-lbl">wealth</span></div>
      <div class="nt-item"><span class="nt-icon">🔥</span><span class="nt-val">${fmt(dmg)}</span><span class="nt-lbl">dmg/wk</span></div>
      ${dev != null ? `<div class="nt-item"><span class="nt-icon">📈</span><span class="nt-val">${dev.toFixed(1)}</span><span class="nt-lbl">dev.</span></div>` : ''}
      <div class="nt-item"><span class="nt-icon">🛡️</span><span class="nt-val">${defPacts}</span><span class="nt-lbl">def pacts</span></div>
      <div class="nt-item"><span class="nt-icon">⚔️</span><span class="nt-val">${wars}</span><span class="nt-lbl">wars</span></div>
      ${swornEnemyName ? `<div class="nt-item" style="color:#e67e22;"><span class="nt-icon">⚡</span><span class="nt-val">${swornEnemyName}</span><span class="nt-lbl">sworn enemy</span></div>` : ''}
    </div>
  `;
// nationTooltip.js - sezione BATTLE HEATMAP DATI

if (state.coloringMode === 'battleHeatmap' && state.battleHeatmapData) {
  const data = state.battleHeatmapData;
  const nationData = data.nations.find(n => n.countryId === nation._id);
  if (nationData) {
    const rank = data.nations.findIndex(n => n.countryId === nation._id) + 1;
    
    // Percentuale rispetto al massimo del lato
    const sameSide = data.nations.filter(n => n.side === nationData.side);
    const maxInSide = sameSide.reduce((max, n) => Math.max(max, n.totalDamage), 0);
    const pct = maxInSide > 0 ? (nationData.totalDamage / maxInSide * 100) : 0;
    
    // Percentuale sul totale del lato
    const totalInSide = sameSide.reduce((sum, n) => sum + n.totalDamage, 0);
    const totalPct = totalInSide > 0 ? (nationData.totalDamage / totalInSide * 100) : 0;
    
    const sideColor = nationData.side === 'attacker' ? '#58a6ff' : '#ff6b6b';
    const sideLabel = nationData.side === 'attacker' ? '⚔️ Attacker' : '🛡️ Defender';
    
    const atkDmg = nationData.damageToAttackers || 0;
    const defDmg = nationData.damageToDefenders || 0;

    html += `
      <div style="border-top:1px solid rgba(255,255,255,0.08); margin-top:8px; padding-top:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span>Side: <strong style="color:${sideColor}">${sideLabel}</strong></span>
          <span>Rank: <strong>#${rank}</strong></span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
          <span>Total dmg: <strong>${fmt(nationData.totalDamage)}</strong></span>
          <span>vs max: <strong>${pct.toFixed(1)}%</strong></span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:2px; font-size:10px; color:#8b949e;">
          <span>Side total: ${fmt(totalInSide)}</span>
          <span>Share: ${totalPct.toFixed(1)}%</span>
        </div>
        ${defDmg > 0 ? `<div style="color:#58a6ff;">⚔️ As attacker: <strong>${fmt(defDmg)}</strong></div>` : ''}
        ${atkDmg > 0 ? `<div style="color:#ff6b6b;">🛡️ As defender: <strong>${fmt(atkDmg)}</strong></div>` : ''}
      </div>
    `;
  }
}

  html += `
    <div class="nt-footer">ID: ${nation._id?.slice(0, 8)}… · <span class="nt-code">${code?.toUpperCase() || '—'}</span></div>
  `;

  return html;
}

// ==================== STATE & LOGIC ====================
let currentId = null;
let isPinned = false;
let hoverTimer = null;

function show(nationId, x, y, pinned = false) {
  if (!nationId) return;
  const nation = state.nationMap.get(nationId);
  if (!nation) return;

  const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
  const isOriginal = state.mapSource === 'original';
  const srcData = isOriginal ? state.originalLabelsData : state.labelsData;
  const label = srcData.find(l => l.properties.countryId === nationId);
  const code = label?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
  const blocColor = state.blocColorMap.get(nationId);
  const blocInfo = blocColor ? state.externalBlocsInfo.find(b => b.color === blocColor) : null;

  const tooltip = getTooltipEl();

  if (pinned && currentId && nationId !== currentId) {
    tooltip.classList.remove('visible');
    void tooltip.offsetWidth;
  }

  tooltip.innerHTML = buildContent(nation, code, blocInfo);
  currentId = nationId;
  isPinned = pinned;

  if (pinned || isMobile) {
    tooltip.classList.add('pinned');
    tooltip.style.left = '50%';
    tooltip.style.top = 'auto';
    tooltip.style.setProperty('bottom', window.innerWidth <= 768 ? '45px' : '55px', 'important');
    tooltip.style.transform = 'translateX(-50%)';
  } else {
    tooltip.classList.remove('pinned');
    tooltip.style.visibility = 'hidden';
    tooltip.classList.add('visible');
    const rect = tooltip.getBoundingClientRect();
    let left = x + 20, top = y + 15;
    if (left + rect.width > window.innerWidth - 16) left = x - rect.width - 20;
    if (top + rect.height > window.innerHeight - 16) top = y - rect.height - 15;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.bottom = 'auto';
    tooltip.style.transform = 'none';
    tooltip.style.visibility = '';
  }

  requestAnimationFrame(() => tooltip.classList.add('visible'));
}

export function hide() {
  const tooltip = document.getElementById('nation-tooltip');
  if (tooltip) tooltip.classList.remove('visible');
  currentId = null;
  isPinned = false;
}

function _getCoords(e) {
  if (e.originalEvent?.clientX != null) {
    return { x: e.originalEvent.clientX, y: e.originalEvent.clientY };
  }
  if (e.point?.x != null) {
    return { x: e.point.x, y: e.point.y };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

// ==================== INIT ====================
export function initNationTooltip(map) {
  const layerId = 'regions-fill';

  function _extractId(e) {
    if (!e.features?.[0]) return null;
    const props = e.features[0].properties;
    return state.mapSource === 'original' ? props.initialCountryId : props.countryId;
  }

  map.on('mouseenter', layerId, (e) => {
    if (isPinned || hoverSuppressed) return;
    clearTimeout(hoverTimer);
    const nid = _extractId(e);
    if (nid && nid !== currentId) show(nid, e.originalEvent.clientX, e.originalEvent.clientY);
  });

  map.on('mousemove', layerId, (e) => {
    if (isPinned || hoverSuppressed) return;
    const tooltip = document.getElementById('nation-tooltip');
    if (!tooltip?.classList.contains('visible')) return;

    const nid = _extractId(e);
    if (nid && nid !== currentId) {
      show(nid, e.originalEvent.clientX, e.originalEvent.clientY, false);
    } else {
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = e.originalEvent.clientX + 20, top = e.originalEvent.clientY + 15;
      const rect = tooltip.getBoundingClientRect();
      if (left + rect.width > vw - 16) left = e.originalEvent.clientX - rect.width - 20;
      if (top + rect.height > vh - 16) top = e.originalEvent.clientY - rect.height - 15;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
  });

  map.on('mouseleave', layerId, () => {
    hoverTimer = setTimeout(() => {
      if (!isPinned) hide();
    }, 60);
  });

  map.on('click', layerId, (e) => {
    const nid = _extractId(e);
    if (!nid) return;

    if (currentId === nid && isPinned) {
      hide();
      hoverSuppressed = true;
      const reenable = () => {
        hoverSuppressed = false;
        document.removeEventListener('mousemove', reenable, { capture: true });
      };
      document.addEventListener('mousemove', reenable, { once: true, capture: true });
      return;
    }
    const coords = _getCoords(e);
    show(nid, coords.x, coords.y, true);
  });

  document.addEventListener('click', (e) => {
    if (isPinned && !e.target.closest('#nation-tooltip')) {
      hide();
      hoverSuppressed = true;
      const enableHover = () => {
        hoverSuppressed = false;
        document.removeEventListener('mousemove', enableHover);
      };
      document.addEventListener('mousemove', enableHover, { once: true });
    }
  }, true);
}