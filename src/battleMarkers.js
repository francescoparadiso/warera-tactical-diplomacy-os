// battleMarkers.js - versione completa con gestione 429 e cache

import { state } from './state.js';
import maplibregl from 'maplibre-gl';
import { fetchActiveBattles, setBattleHeatmap } from './battleHeatmap.js';
import { API_BASE_URL } from './config.js';

let markers = [];
let markersEnabled = true;
let markerInterval = null;
let lastSuccessfulBattles = [];

// ==================== BATTLE TOOLTIP (pin in basso) ====================
let pinnedBattleId = null;

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

// ==================== HELPERS: NATION (spostate PRIMA del tooltip) ====================
function getNation(countryId) {
  if (!countryId) return null;
  return state.nazioniGlobal.find(n => n._id === countryId) || null;
}

function getFlagUrl(code) {
  if (!code) return '';
  return `https://app.warera.io/images/map/${code.toLowerCase()}.png?v=21`;
}

function brightenAndSaturate(color, saturationBoost = 0.4) {
  if (!color) return '#e6edf3';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const brightFactor = lum < 80 ? 2.0 : lum < 140 ? 1.6 : lum < 180 ? 1.3 : 1.0;
  let nr = Math.min(255, Math.round(r * brightFactor));
  let ng = Math.min(255, Math.round(g * brightFactor));
  let nb = Math.min(255, Math.round(b * brightFactor));
  
  const max = Math.max(nr, ng, nb);
  if (max > 0) {
    const avg = (nr + ng + nb) / 3;
    const boost = 1 + saturationBoost;
    nr = Math.min(255, Math.round(avg + (nr - avg) * boost));
    ng = Math.min(255, Math.round(avg + (ng - avg) * boost));
    nb = Math.min(255, Math.round(avg + (nb - avg) * boost));
  }
  return `rgb(${nr},${ng},${nb})`;
}

// ==================== TOOLTIP FUNCTIONS ====================
function getBattleTooltipEl() {
  let el = document.getElementById('battle-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'battle-tooltip';
    el.style.cssText = `
      position: fixed;
      bottom: 55px;
      left: 50%;
      transform: translateX(-50%) translateY(8px);
      z-index: 9000;
      font-family: Inter, system-ui, sans-serif;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
      max-width: 420px;
      width: max-content;
    `;
    document.body.appendChild(el);
  }
  return el;
}

function buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg) {
  const attackerNation = getNation(battle.attacker?.country);
  const defenderNation = getNation(battle.defender?.country);
  const atkName = attackerNation?.name || 'Unknown';
  const defName = defenderNation?.name || 'Unknown';
  const atkCode = attackerNation?.code?.toLowerCase() || '';
  const defCode = defenderNation?.code?.toLowerCase() || '';

  const rawAtkColor = state.nationBaseColorMap.get(battle.attacker?.country);
  const rawDefColor = state.nationBaseColorMap.get(battle.defender?.country);
  const atkColor = brightenAndSaturate(rawAtkColor, 0.4);
  const defColor = brightenAndSaturate(rawDefColor, 0.4);

  let atkDmg = totalAttackerDmg || 0;
  let defDmg = totalDefenderDmg || 0;
  let useLive = false;
  if (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0)) {
    atkDmg = liveData.attackerDmg;
    defDmg = liveData.defenderDmg;
    useLive = true;
  }

  const total = atkDmg + defDmg;
  const atkPct = total > 0 ? Math.round(atkDmg / total * 100) : 50;
  const defPct = 100 - atkPct;

  const isLight = state.theme === 'light';
  const bg = isLight ? 'rgba(240,242,247,0.98)' : 'rgba(13,17,23,0.97)';
  const border = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
  const textColor = isLight ? '#1a1a1a' : '#e6edf3';
  const subColor = isLight ? '#555' : '#8b949e';
  const flagUrl = (code) => `https://app.warera.io/images/map/${code}.png?v=21`;

  return `
    <div style="
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 10px;
      padding: 12px 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      min-width: 260px;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:${subColor};">
          ⚔️ ${regionName || 'Battle'}${useLive ? ' <span style="color:#ff4444;">🔴 Live</span>' : ''}
        </span>
        <span id="battle-tooltip-close" style="cursor:pointer; font-size:14px; color:${subColor}; padding:0 4px; line-height:1;">✕</span>
      </div>

      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:5px; flex:1;">
          ${defCode ? `<img src="${flagUrl(defCode)}" style="height:16px; border-radius:2px;" onerror="this.style.display='none'">` : ''}
          <span style="font-size:13px; font-weight:700; color:${defColor};">${defName}</span>
        </div>
        <span style="font-size:10px; color:${subColor}; flex-shrink:0;">vs</span>
        <div style="display:flex; align-items:center; gap:5px; flex:1; justify-content:flex-end;">
          <span style="font-size:13px; font-weight:700; color:${atkColor}; text-align:right;">${atkName}</span>
          ${atkCode ? `<img src="${flagUrl(atkCode)}" style="height:16px; border-radius:2px;" onerror="this.style.display='none'">` : ''}
        </div>
      </div>

      <div style="height:6px; border-radius:3px; overflow:hidden; display:flex; margin-bottom:4px;">
        <div style="width:${defPct}%; background:${defColor}; box-shadow:0 0 6px ${defColor}66;"></div>
        <div style="width:${atkPct}%; background:${atkColor}; box-shadow:0 0 6px ${atkColor}66;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
        <span style="font-size:11px; font-weight:700; color:${defColor};">${defPct}% · ${fmt(defDmg)}</span>
        <span style="font-size:11px; font-weight:700; color:${atkColor};">${fmt(atkDmg)} · ${atkPct}%</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; color:${subColor};">
        <div>🛡️ Difensore totale: <strong style="color:${textColor};">${fmt(totalDefenderDmg)}</strong></div>
        <div>⚔️ Attaccante totale: <strong style="color:${textColor};">${fmt(totalAttackerDmg)}</strong></div>
      </div>

      <div style="margin-top:10px; font-size:10px; color:${subColor}; text-align:center;">
        Clicca di nuovo per aprire la heatmap · ✕ per chiudere
      </div>
    </div>
  `;
}

function showBattleTooltip(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg) {
  const el = getBattleTooltipEl();
  el.innerHTML = buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg);
  pinnedBattleId = battle._id;

  el.querySelector('#battle-tooltip-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBattleTooltip();
  });

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
}

function hideBattleTooltip() {
  const el = document.getElementById('battle-tooltip');
  if (!el) return;
  el.style.opacity = '0';
  el.style.transform = 'translateX(-50%) translateY(8px)';
  pinnedBattleId = null;
}

// Click fuori per chiudere il tooltip
document.addEventListener('click', (e) => {
  if (pinnedBattleId && !e.target.closest('#battle-tooltip') && !e.target.closest('.battle-marker')) {
    hideBattleTooltip();
  }
});

// ==================== TOGGLE ====================
export function toggleBattleMarkers(enabled) {
  markersEnabled = enabled;
  if (enabled) {
    updateBattleMarkers();
  } else {
    clearMarkers();
  }
  const toggle = document.getElementById('toggle-battle-markers');
  if (toggle) {
    toggle.checked = enabled;
  }
}

// ==================== HELPER: REGION DATA ====================
async function fetchRegionData(regionId) {
  if (state.regionCache.has(regionId)) return state.regionCache.get(regionId);
  try {
    const input = { regionId };
    const url = `${API_BASE_URL}/trpc/region.getById?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const region = data?.result?.data || data;
    const result = { position: region.position || null, name: region.name || region.mainCity || '' };
    state.regionCache.set(regionId, result);
    return result;
  } catch (err) {
    console.error(`fetchRegionData error for ${regionId}:`, err);
    return null;
  }
}

// ==================== LIVE BATTLE DATA ====================
async function fetchLiveBattleData(battleId) {
  try {
    const input = { battleId };
    const url = `${API_BASE_URL}/trpc/battle.getLiveBattleData?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const live = data?.result?.data || data;
    const round = live?.round || {};
    return {
      attackerDmg: round.attackerDamages || 0,
      defenderDmg: round.defenderDamages || 0,
    };
  } catch (err) {
    console.warn(`fetchLiveBattleData error for ${battleId}:`, err);
    return null;
  }
}

// ==================== BUILD MARKER ELEMENT ====================
function buildMarkerEl(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom) {
  const attackerNation = getNation(battle.attacker?.country);
  const defenderNation = getNation(battle.defender?.country);
  const attackerName = attackerNation?.name || 'Unknown';
  const defenderName = defenderNation?.name || 'Unknown';
  const attackerCode = attackerNation?.code || '';
  const defenderCode = defenderNation?.code || '';

  const rawAtkColor = state.nationBaseColorMap.get(battle.attacker?.country);
  const rawDefColor = state.nationBaseColorMap.get(battle.defender?.country);
  const atkColor = brightenAndSaturate(rawAtkColor, 0.4);
  const defColor = brightenAndSaturate(rawDefColor, 0.4);

  let attackerDmg, defenderDmg;
  let useLive = false;
  if (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0)) {
    attackerDmg = liveData.attackerDmg;
    defenderDmg = liveData.defenderDmg;
    useLive = true;
  } else {
    attackerDmg = totalAttackerDmg || 0;
    defenderDmg = totalDefenderDmg || 0;
  }

  const total = attackerDmg + defenderDmg;
  const showBar = total > 0;
  const atkPct = showBar ? Math.round(attackerDmg / total * 100) : 50;
  const defPct = showBar ? 100 - atkPct : 50;

  // Adattamento allo zoom
  const isZoomLow = zoom < 3.5;
  const isZoomMedium = zoom >= 3.5 && zoom < 5;
  const fontSizeName = isZoomLow ? '7px' : (isZoomMedium ? '8px' : '9px');
  const fontSizeRegion = isZoomLow ? '6px' : (isZoomMedium ? '7px' : '8px');
  const fontSizePct = isZoomLow ? '6px' : (isZoomMedium ? '7px' : '8px');
  const padding = isZoomLow ? '3px 5px' : (isZoomMedium ? '4px 6px' : '5px 8px');
  const minWidth = isZoomLow ? 60 : (isZoomMedium ? 90 : 120);
  const maxWidth = isZoomLow ? 90 : (isZoomMedium ? 130 : 180);
  const borderRadius = isZoomLow ? '3px' : '6px';
  const gap = isZoomLow ? '2px' : '4px';
  const marginBottom = isZoomLow ? '1px' : '3px';

  const regionLabel = regionName || '⚔️ Battle';
  const liveLabel = useLive ? ' 🔴' : '';

  // SEMPRE mostra bandiere e percentuali
  const showFlags = true;
  const showPct = true;

  const el = document.createElement('div');
  el.className = 'battle-marker';

  // DIFENSORE a SX, ATTACCANTE a DX
  el.innerHTML = `
    <div style="
      background: rgba(10,12,20,0.96);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: ${borderRadius};
      padding: ${padding};
      min-width: ${minWidth}px;
      max-width: ${maxWidth}px;
      font-family: Inter, system-ui, sans-serif;
      cursor: pointer;
      user-select: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    " class="bm-inner">
      <div style="font-size:${fontSizeRegion}; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; text-align:center; color:${defColor}; margin-bottom:${marginBottom}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow: 0 0 8px ${defColor}33;">
        ${regionLabel}${liveLabel}
      </div>
      <div style="display:flex; align-items:center; gap:${gap}; margin-bottom:${marginBottom};">
        <!-- DIFENSORE a SINISTRA -->
        <div style="display:flex; align-items:center; gap:2px; flex:1; min-width:0;">
          ${defenderCode && showFlags ? `<img src="${getFlagUrl(defenderCode)}" style="height:${isZoomLow ? '8px' : '10px'}; width:auto; border-radius:1px; flex-shrink:0; opacity:0.95; border: 1px solid rgba(255,255,255,0.08);" onerror="this.style.display='none'">` : ''}
          <span style="font-size:${fontSizeName}; font-weight:700; color:${defColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow: 0 0 6px ${defColor}44;">${defenderName}</span>
        </div>
        <span style="font-size:${isZoomLow ? '5px' : '7px'}; color:rgba(255,255,255,0.18); flex-shrink:0; font-weight:500;">vs</span>
        <!-- ATTACCANTE a DESTRA -->
        <div style="display:flex; align-items:center; gap:2px; flex:1; min-width:0; justify-content:flex-end;">
          <span style="font-size:${fontSizeName}; font-weight:700; color:${atkColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right; text-shadow: 0 0 6px ${atkColor}44;">${attackerName}</span>
          ${attackerCode && showFlags ? `<img src="${getFlagUrl(attackerCode)}" style="height:${isZoomLow ? '8px' : '10px'}; width:auto; border-radius:1px; flex-shrink:0; opacity:0.95; border: 1px solid rgba(255,255,255,0.08);" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      ${showBar ? `
        <div style="height:${isZoomLow ? '2px' : '3px'}; border-radius:2px; overflow:hidden; display:flex; background:rgba(255,255,255,0.06);">
          <div style="width:${defPct}%; background:${defColor}; border-radius:2px 0 0 2px; transition:width 0.5s cubic-bezier(0.22, 1, 0.36, 1); box-shadow: 0 0 8px ${defColor}66;"></div>
          <div style="width:${atkPct}%; background:${atkColor}; border-radius:0 2px 2px 0; transition:width 0.5s cubic-bezier(0.22, 1, 0.36, 1); box-shadow: 0 0 8px ${atkColor}66;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:${isZoomLow ? '1px' : '2px'};">
          <span style="font-size:${fontSizePct}; color:${defColor}; font-weight:600; text-shadow: 0 0 4px ${defColor}44;">${defPct}%</span>
          <span style="font-size:${fontSizePct}; color:${atkColor}; font-weight:600; text-shadow: 0 0 4px ${atkColor}44;">${atkPct}%</span>
        </div>
      ` : `
        <div style="height:${isZoomLow ? '2px' : '3px'}; border-radius:2px; overflow:hidden; display:flex; background:rgba(255,255,255,0.06);">
          <div style="width:50%; background:${defColor}; opacity:0.4; border-radius:2px 0 0 2px;"></div>
          <div style="width:50%; background:${atkColor}; opacity:0.4; border-radius:0 2px 2px 0;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:${isZoomLow ? '1px' : '2px'};">
          <span style="font-size:${fontSizePct}; color:${defColor}; font-weight:600; text-shadow: 0 0 4px ${defColor}44; opacity:0.5;">50%</span>
          <span style="font-size:${fontSizePct}; color:${atkColor}; font-weight:600; text-shadow: 0 0 4px ${atkColor}44; opacity:0.5;">50%</span>
        </div>
      `}
    </div>
  `;

  const inner = el.querySelector('.bm-inner');
  el.addEventListener('mouseenter', () => {
    inner.style.borderColor = 'rgba(255,68,68,0.45)';
    inner.style.boxShadow = '0 4px 18px rgba(255,68,68,0.18)';
    inner.style.background = 'rgba(18,20,34,0.98)';
  });
  el.addEventListener('mouseleave', () => {
    inner.style.borderColor = 'rgba(255,255,255,0.1)';
    inner.style.boxShadow = 'none';
    inner.style.background = 'rgba(10,12,20,0.96)';
  });
  
  // Click handler
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    const battleId = battle._id;
    
    // Se la heatmap è già aperta su questa battaglia, esci
    if (state.coloringMode === 'battleHeatmap' && 
        state.battleHeatmapData?.battleId === battleId) {
      import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
      return;
    }
    
    // Mostra il tooltip
    showBattleTooltip(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg);
    
    // Apri la heatmap
    setBattleHeatmap(battleId);
  });

  Object.assign(el.style, { pointerEvents: 'auto', zIndex: 2000 });
  return el;
}

// ==================== UPDATE MARKERS ====================
export async function updateBattleMarkers() {
  // Se i marker sono disabilitati, esci
  if (!markersEnabled) return;
  if (!state.map) return;

  try {
    const battles = await fetchActiveBattles();
    
    // Se la risposta è vuota e abbiamo dati salvati, mantieni quelli
    if ((!battles || battles.length === 0) && lastSuccessfulBattles.length > 0) {
      // Non fare nulla, mantieni i marker esistenti
      return;
    }
    
    // Se abbiamo dati validi, aggiorna
    if (battles && battles.length > 0) {
      // Salva i dati validi
      lastSuccessfulBattles = battles;
      
      // Ora possiamo cancellare i vecchi marker e crearne di nuovi
      clearMarkers();
      
      const zoom = state.map.getZoom();

      // Recupera dati live in batch
      const liveDataMap = new Map();
      const BATCH_SIZE = 5;
      for (let i = 0; i < battles.length; i += BATCH_SIZE) {
        const batch = battles.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(b => fetchLiveBattleData(b._id)));
        batch.forEach((b, idx) => {
          liveDataMap.set(b._id, batchResults[idx]);
        });
      }

      for (const battle of battles) {
        const regionId = battle.regionId || battle.defender?.region || battle.attacker?.region;

        let centroid = null;
        let regionName = '';

        if (regionId) {
          const cached = state.regionCache?.get(regionId);
          if (cached) {
            centroid = cached.position;
            regionName = cached.name || '';
          } else {
            const rd = await fetchRegionData(regionId);
            if (rd?.position) { centroid = rd.position; regionName = rd.name || ''; }
          }
        }

        if (!centroid) {
          const fallbackId = battle.defender?.country || battle.attacker?.country;
          if (fallbackId) centroid = state.centroids.get(fallbackId);
        }
        if (!centroid) continue;

        const totalAttackerDmg = battle.attacker?.damages || 0;
        const totalDefenderDmg = battle.defender?.damages || 0;
        const liveData = liveDataMap.get(battle._id);

        const el = buildMarkerEl(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom);
        const marker = new maplibregl.Marker({ element: el }).setLngLat(centroid).addTo(state.map);
        markers.push(marker);
      }
    }
  } catch (err) {
    console.error('Error updating battle markers:', err);
    // In caso di errore, mantieni i marker esistenti
  }
}

// ==================== CLEAR MARKERS ====================
export function clearMarkers() {
  markers.forEach(m => {
    try { m.remove(); } catch(e) {}
  });
  markers = [];
}

// ==================== FORCE UPDATE ====================
export function forceUpdateBattleMarkers() {
  lastSuccessfulBattles = [];
  updateBattleMarkers();
}

// ==================== START/STOP AUTO UPDATE ====================
export function startMarkerUpdates(intervalMs = 30000) {
  stopMarkerUpdates();
  markerInterval = setInterval(updateBattleMarkers, intervalMs);
}

export function stopMarkerUpdates() {
  if (markerInterval) {
    clearInterval(markerInterval);
    markerInterval = null;
  }
}

// ==================== INIT ====================
export function initBattleMarkers() {
  const toggle = document.getElementById('toggle-battle-markers');
  if (toggle) {
    toggle.addEventListener('change', function() {
      toggleBattleMarkers(this.checked);
    });
    markersEnabled = toggle.checked;
  }
  // Carica i marker subito
  updateBattleMarkers();
  startMarkerUpdates(30000);
}