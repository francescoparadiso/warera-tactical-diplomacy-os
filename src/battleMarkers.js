// battleMarkers.js - versione completa con gestione 429 e cache

import { state } from './state.js';
import maplibregl from 'maplibre-gl';
import { fetchActiveBattles, setBattleHeatmap } from './battleHeatmap.js';
import { API_BASE_URL } from './config.js';
import { trpcBatch } from './utils.js';
import { escapeHtml } from './utils.js';

let markers = new Map(); // battleId -> { marker, el }
let markersEnabled = true;
let lastSuccessfulBattles = [];

// ==================== TREND / MOMENTUM (locale, nessuna chiamata extra) ====================
// Confronta i danni totali di ogni battaglia fra un refresh e il successivo
// (updateBattleMarkers gira ogni ~30s) per capire chi sta guadagnando terreno
// ORA, senza fare nessuna richiesta API in piu': i totali arrivano gia' dal
// batch esistente (getBattles + live data batch).
const battleHistory = new Map(); // battleId -> { atk, def, ts }

function computeTrend(battleId, atkDmg, defDmg) {
  const now = Date.now();
  const prev = battleHistory.get(battleId);
  battleHistory.set(battleId, { atk: atkDmg, def: defDmg, ts: now });
  if (!prev) return null;
  const dtSec = (now - prev.ts) / 1000;
  if (dtSec < 5) return prev.trend || null; // refresh troppo ravvicinato, tieni l'ultimo valore buono
  const dAtk = Math.max(0, atkDmg - prev.atk);
  const dDef = Math.max(0, defDmg - prev.def);
  const rateAtk = dAtk / dtSec;
  const rateDef = dDef / dtSec;
  const rateSum = rateAtk + rateDef;
  // balance > 0 = il difensore sta guadagnando terreno piu' in fretta ORA
  // (stessa convenzione di segno usata in battleWall3D, per coerenza fra le viste).
  const trend = rateSum > 0
    ? { rateAtk, rateDef, balance: (rateDef - rateAtk) / rateSum }
    : { rateAtk: 0, rateDef: 0, balance: 0 };
  battleHistory.set(battleId, { atk: atkDmg, def: defDmg, ts: now, trend });
  return trend;
}

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
  return state.nationMap.get(countryId) || null;
}

function getFlagUrl(code) {
  if (!code) return '';
  return `https://app.warera.io/images/map/${code.toLowerCase()}.png?v=21`;
}

// Canvas 1x1 riusato + cache: prima ne veniva creato uno nuovo ad ogni
// chiamata, 2 per marker ad ogni refresh (60 canvas ogni 30s con 30 battaglie).
let _colorCanvasCtx = null;
const _colorCache = new Map();

function brightenAndSaturate(color, saturationBoost = 0.4) {
  if (!color) return '#e6edf3';
  const cacheKey = `${color}|${saturationBoost}`;
  const hit = _colorCache.get(cacheKey);
  if (hit) return hit;

  if (!_colorCanvasCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    _colorCanvasCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = _colorCanvasCtx;
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
  const out = `rgb(${nr},${ng},${nb})`;
  _colorCache.set(cacheKey, out);
  return out;
}

// ==================== TOOLTIP FUNCTIONS ====================
function getBattleTooltipEl() {
  let el = document.getElementById('battle-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'battle-tooltip';
    el.style.cssText = `
      position: fixed;
      bottom: calc(55px + env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%) translateY(8px);
      z-index: 9000;
      font-family: Inter, system-ui, sans-serif;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
      /* Responsivo: mai piu' largo della viewport meno un margine, invece del
         fisso max-width:420px che su schermi stretti (<440px) veniva tagliato
         o spingeva oltre il bordo, rompendo il layout su mobile. */
      width: min(420px, calc(100vw - 20px));
      max-width: calc(100vw - 20px);
      box-sizing: border-box;
    `;
    document.body.appendChild(el);
  }
  return el;
}

function buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend) {
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

  // Layout responsivo: niente piu' min-width fisso a 260px, che su schermi
  // molto stretti costringeva il contenitore oltre il bordo viewport.
  // Con width:100% + box-sizing:border-box il box si adatta sempre al
  // contenitore (gia' limitato a calc(100vw - 20px) in getBattleTooltipEl).
  const isMobile = window.innerWidth <= 480;
  const padding = isMobile ? '10px 12px' : '12px 16px';
  const nameFontSize = isMobile ? '12px' : '13px';
  const flagHeight = isMobile ? '14px' : '16px';

  // ── Momentum: riga extra solo se abbiamo un dato attendibile (serve
  //    almeno un refresh precedente). Stesso schema colori/etichette del
  //    resto dell'app (>0 = difensore in vantaggio di ritmo). ──
  let momentumHtml = '';
  if (trend && Math.abs(trend.balance) >= 0.05) {
    const defGaining = trend.balance > 0;
    const momColor = defGaining ? defColor : atkColor;
    const who = defGaining ? `🛡️ ${escapeHtml(defName)}` : `⚔️ ${escapeHtml(atkName)}`;
    momentumHtml = `
      <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:${subColor};">
        📊 Momentum: <strong style="color:${momColor};">${who} gaining ground</strong>
      </div>
    `;
  }

  return `
    <div style="
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 10px;
      padding: ${padding};
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      width: 100%;
      box-sizing: border-box;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:${subColor}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">
          ⚔️ ${escapeHtml(regionName || 'Battle')}${useLive ? ' <span style="color:#ff4444;">🔴 Live</span>' : ''}
        </span>
        <span id="battle-tooltip-close" style="cursor:pointer; font-size:16px; color:${subColor}; padding:4px; line-height:1; flex-shrink:0;">✕</span>
      </div>

      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:5px; flex:1 1 40%; min-width:0;">
          ${defCode ? `<img src="${flagUrl(defCode)}" style="height:${flagHeight}; border-radius:2px; flex-shrink:0;" onerror="this.style.display='none'">` : ''}
          <span style="font-size:${nameFontSize}; font-weight:700; color:${defColor}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(defName)}</span>
        </div>
        <span style="font-size:10px; color:${subColor}; flex-shrink:0;">vs</span>
        <div style="display:flex; align-items:center; gap:5px; flex:1 1 40%; min-width:0; justify-content:flex-end;">
          <span style="font-size:${nameFontSize}; font-weight:700; color:${atkColor}; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(atkName)}</span>
          ${atkCode ? `<img src="${flagUrl(atkCode)}" style="height:${flagHeight}; border-radius:2px; flex-shrink:0;" onerror="this.style.display='none'">` : ''}
        </div>
      </div>

      <div style="height:6px; border-radius:3px; overflow:hidden; display:flex; margin-bottom:4px;">
        <div style="width:${defPct}%; background:${defColor}; box-shadow:0 0 6px ${defColor}66;"></div>
        <div style="width:${atkPct}%; background:${atkColor}; box-shadow:0 0 6px ${atkColor}66;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:10px; gap:8px;">
        <span style="font-size:11px; font-weight:700; color:${defColor};">${defPct}% · ${fmt(defDmg)}</span>
        <span style="font-size:11px; font-weight:700; color:${atkColor};">${fmt(atkDmg)} · ${atkPct}%</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; color:${subColor};">
        <div>🛡️ Defender total: <strong style="color:${textColor};">${fmt(totalDefenderDmg)}</strong></div>
        <div>⚔️ Attacker total: <strong style="color:${textColor};">${fmt(totalAttackerDmg)}</strong></div>
        <div style="grid-column:1 / -1;">💥 Combined total: <strong style="color:${textColor};">${fmt(total)}</strong></div>
      </div>
      ${momentumHtml}

      <div style="margin-top:10px; display:flex; gap:8px;">
        <button id="battle-3d-btn" style="
          flex:1; cursor:pointer; padding:9px 10px; border-radius:8px;
          background:rgba(232,201,122,0.12); border:1px solid rgba(232,201,122,0.35);
          color:#e8c97a; font-size:11px; font-weight:700; letter-spacing:.02em;
        ">🎮 3D Battle View</button>
      </div>
      <div style="margin-top:8px; font-size:10px; color:${subColor}; text-align:center;">
        Click again to open the heatmap · ✕ to close
      </div>
    </div>
  `;
}

function showBattleTooltip(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend) {
  // I due tooltip vivono entrambi in basso al centro: se restano aperti
  // insieme, quello battaglia (z-index 9000) copre quello nazione (3000) e
  // intercetta i click destinati ai suoi link.
  import('./nationTooltip.js').then(m => m.hide());
  const el = getBattleTooltipEl();
  el.innerHTML = buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend);
  pinnedBattleId = battle._id;

  el.querySelector('#battle-tooltip-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBattleTooltip();
  });

  el.querySelector('#battle-3d-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    import('./battleWall3D.js').then(m => m.openBattleWall3D(battle._id));
  });

  el.style.pointerEvents = 'auto';
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
}

export function hideBattleTooltip() {
  const el = document.getElementById('battle-tooltip');
  if (!el) return;
  el.style.opacity = '0';
  el.style.transform = 'translateX(-50%) translateY(8px)';
  // CAUSA PRINCIPALE del bug "il link apre una battaglia": senza questo il
  // tooltip resta invisibile ma cliccabile (pointer-events:auto) sopra la
  // nation-tooltip, intercettando i click destinati ai suoi link.
  el.style.pointerEvents = 'none';
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
  const toggle = document.getElementById('checkActiveBattles');
  if (toggle) toggle.checked = enabled;
}

// ==================== HELPER: REGION DATA ====================
// Versione singola (fallback / usi puntuali). Il percorso "hot" in
// updateBattleMarkers usa fetchRegionDataBatch per evitare N richieste separate.
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

// Batcha in un solo POST tutte le regioni non ancora in cache (era una
// fetch sequenziale per battaglia). Vedi warera-api-batching.md.
async function fetchRegionDataBatch(regionIds) {
  const toFetch = [...new Set(regionIds)].filter(id => id && !state.regionCache.has(id));
  if (!toFetch.length) return;
  const calls = toFetch.map(id => ['region.getById', { regionId: id }]);
  const results = await trpcBatch(calls);
  toFetch.forEach((regionId, idx) => {
    const region = results[idx];
    if (!region) return;
    state.regionCache.set(regionId, {
      position: region.position || null,
      name: region.name || region.mainCity || '',
    });
  });
}

// ==================== LIVE BATTLE DATA ====================
// Versione singola (fallback). Il percorso "hot" usa fetchLiveBattleDataBatch.
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

// Batcha i dati live di tutte le battaglie in un solo POST (era Promise.all
// a gruppi di 5 -> ceil(N/5) richieste HTTP; ora 1 richiesta fino a 50
// battaglie, chunk automatico oltre). Vedi warera-api-batching.md.
async function fetchLiveBattleDataBatch(battleIds) {
  const liveDataMap = new Map();
  if (!battleIds.length) return liveDataMap;
  const calls = battleIds.map(id => ['battle.getLiveBattleData', { battleId: id }]);
  const results = await trpcBatch(calls);
  battleIds.forEach((battleId, idx) => {
    const live = results[idx];
    const round = live?.round || {};
    liveDataMap.set(battleId, live ? {
      attackerDmg: round.attackerDamages || 0,
      defenderDmg: round.defenderDamages || 0,
    } : null);
  });
  return liveDataMap;
}

// ==================== BUILD MARKER ELEMENT ====================
// Genera SOLO il markup del marker (nessun DOM, nessun listener), cosi' puo'
// essere riusato sia alla creazione sia agli aggiornamenti in place.
function buildMarkerMarkup(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend) {
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

  // Adattamento allo zoom. Su mobile lo zoom iniziale e' spesso sotto 3.5,
  // il che faceva scattare quasi sempre la fascia "low" (marker minuscoli,
  // testo a 6-7px, quasi impossibili da leggere o toccare su un telefono).
  // Alziamo la soglia effettiva su mobile cosi' i marker restano leggibili
  // e con un'area di tocco decente indipendentemente dal livello di zoom.
  const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window);
  const effectiveZoom = isMobile ? Math.max(zoom, 3.5) : zoom;
  const isZoomLow = effectiveZoom < 3.5;
  const isZoomMedium = effectiveZoom >= 3.5 && effectiveZoom < 5;
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

  // ── Info aggiuntive (solo se c'e' spazio, fascia medium/high): danno
  //    combinato e, se disponibile, un indicatore sintetico di chi sta
  //    guadagnando terreno ORA (derivato localmente dal refresh precedente,
  //    nessuna chiamata API in piu'). ──
  let extraInfo = '';
  if (!isZoomLow) {
    const totalLine = total > 0
      ? `<span style="color:rgba(255,255,255,0.4);">💥 ${fmt(total)}</span>`
      : '';
    let momentumLine = '';
    if (trend && Math.abs(trend.balance) >= 0.08) {
      const defGaining = trend.balance > 0;
      const momColor = defGaining ? defColor : atkColor;
      const arrow = defGaining ? '🛡️◀' : '▶⚔️';
      momentumLine = `<span style="color:${momColor}; font-weight:700;">${arrow}</span>`;
    }
    if (totalLine || momentumLine) {
      extraInfo = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:${marginBottom}; font-size:${fontSizePct};">
          ${totalLine || '<span></span>'}
          ${momentumLine}
        </div>
      `;
    }
  }

  return `
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
        ${escapeHtml(regionLabel)}${liveLabel}
      </div>
      <div style="display:flex; align-items:center; gap:${gap}; margin-bottom:${marginBottom};">
        <!-- DIFENSORE a SINISTRA -->
        <div style="display:flex; align-items:center; gap:2px; flex:1; min-width:0;">
          ${defenderCode && showFlags ? `<img src="${getFlagUrl(defenderCode)}" style="height:${isZoomLow ? '8px' : '10px'}; width:auto; border-radius:1px; flex-shrink:0; opacity:0.95; border: 1px solid rgba(255,255,255,0.08);" onerror="this.style.display='none'">` : ''}
          <span style="font-size:${fontSizeName}; font-weight:700; color:${defColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow: 0 0 6px ${defColor}44;">${escapeHtml(defenderName)}</span>
        </div>
        <span style="font-size:${isZoomLow ? '5px' : '7px'}; color:rgba(255,255,255,0.18); flex-shrink:0; font-weight:500;">vs</span>
        <!-- ATTACCANTE a DESTRA -->
        <div style="display:flex; align-items:center; gap:2px; flex:1; min-width:0; justify-content:flex-end;">
          <span style="font-size:${fontSizeName}; font-weight:700; color:${atkColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right; text-shadow: 0 0 6px ${atkColor}44;">${escapeHtml(attackerName)}</span>
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
      ${extraInfo}
    </div>
  `;
}

// Aggiorna il contenuto di un marker gia' montato, senza ricrearlo.
// I dati correnti vivono su el._battleData: i listener (agganciati una volta
// sola alla creazione) li leggono da li', altrimenti resterebbero legati alla
// battaglia catturata nella closure al primo render.
function updateMarkerEl(el, battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend) {
  el._battleData = { battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend };
  el.innerHTML = buildMarkerMarkup(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend);
}

function buildMarkerEl(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend) {
  const el = document.createElement('div');
  el.className = 'battle-marker';
  updateMarkerEl(el, battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend);

  // .bm-inner viene ricreato ad ogni updateMarkerEl, quindi va risolto al
  // momento dell'evento e non catturato una volta sola.
  const hoverStyle = (borderColor, boxShadow, background) => {
    const inner = el.querySelector('.bm-inner');
    if (!inner) return;
    inner.style.borderColor = borderColor;
    inner.style.boxShadow = boxShadow;
    inner.style.background = background;
  };
  el.addEventListener('mouseenter', () => {
    hoverStyle('rgba(255,68,68,0.45)', '0 4px 18px rgba(255,68,68,0.18)', 'rgba(18,20,34,0.98)');
  });
  el.addEventListener('mouseleave', () => {
    hoverStyle('rgba(255,255,255,0.1)', 'none', 'rgba(10,12,20,0.96)');
  });

  // Click handler: legge i dati correnti da el._battleData, non dalla closure
  // (che resterebbe ferma ai valori del primo render).
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const d = el._battleData;
    if (!d) return;
    const battleId = d.battle._id;

    // Se la heatmap è già aperta su questa battaglia, esci
    if (state.coloringMode === 'battleHeatmap' &&
        state.battleHeatmapData?.battleId === battleId) {
      import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
      return;
    }

    showBattleTooltip(d.battle, d.regionName, d.liveData, d.totalAttackerDmg, d.totalDefenderDmg, d.trend);
    setBattleHeatmap(battleId);
  });

  // Nota: niente hack di padding/margin negativo sull'elemento radice per
  // allargare l'area di tocco — maplibre calcola l'ancoraggio del marker
  // sulla dimensione di questo stesso elemento, e alterarla rischierebbe di
  // disallineare il marker dal punto geografico reale. L'area di tocco resta
  // comunque piu' grande su mobile grazie alla fascia di zoom minima
  // "medium" forzata sopra (minWidth/padding piu' generosi).
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

      const zoom = state.map.getZoom();

      // Dati live: 1 solo POST batch per tutte le battaglie.
      const battleIds = battles.map(b => b._id);
      const liveDataMap = await fetchLiveBattleDataBatch(battleIds);

      // Dati regione: 1 solo POST batch per tutte le regioni non in cache.
      const regionIds = battles
        .map(b => b.regionId || b.defender?.region || b.attacker?.region)
        .filter(Boolean);
      await fetchRegionDataBatch(regionIds);

      // DIFF invece di clearMarkers()+ricrea-tutto: prima ad ogni giro (30s)
      // ogni Marker veniva distrutto e ricostruito, causando flicker e churn
      // di DOM. Ora si aggiorna in place il contenuto di quelli esistenti e si
      // creano/rimuovono solo quelli effettivamente cambiati.
      const seen = new Set();

      for (const battle of battles) {
        const regionId = battle.regionId || battle.defender?.region || battle.attacker?.region;

        let centroid = null;
        let regionName = '';

        if (regionId) {
          const cached = state.regionCache?.get(regionId);
          if (cached) {
            centroid = cached.position;
            regionName = cached.name || '';
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

        // Stesso criterio usato nel markup per scegliere i danni "effettivi"
        // (live se disponibili, altrimenti i totali): il trend deve seguire
        // la stessa fonte, altrimenti oscillerebbe ogni volta che live/non
        // live si alternano.
        const effAtk = (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0))
          ? liveData.attackerDmg : totalAttackerDmg;
        const effDef = (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0))
          ? liveData.defenderDmg : totalDefenderDmg;
        const trend = computeTrend(battle._id, effAtk, effDef);

        seen.add(battle._id);
        const existing = markers.get(battle._id);

        if (existing) {
          // Aggiorna in place: niente rimozione/riaggiunta del marker.
          updateMarkerEl(existing.el, battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend);
          existing.marker.setLngLat(centroid);
        } else {
          const el = buildMarkerEl(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend);
          const marker = new maplibregl.Marker({ element: el }).setLngLat(centroid).addTo(state.map);
          markers.set(battle._id, { marker, el });
        }
      }

      // Rimuovi solo i marker di battaglie non piu' attive
      for (const [battleId, entry] of markers) {
        if (seen.has(battleId)) continue;
        try { entry.marker.remove(); } catch (e) {}
        markers.delete(battleId);
        battleHistory.delete(battleId); // niente memoria di trend per battaglie chiuse
      }
    }
  } catch (err) {
    console.error('Error updating battle markers:', err);
    // In caso di errore, mantieni i marker esistenti
  }
}

// ==================== CLEAR MARKERS ====================
export function clearMarkers() {
  markers.forEach(({ marker }) => {
    try { marker.remove(); } catch (e) {}
  });
  markers.clear();
}

// ==================== FORCE UPDATE ====================
export function forceUpdateBattleMarkers() {
  lastSuccessfulBattles = [];
  updateBattleMarkers();
}

// NOTA: initBattleMarkers()/startMarkerUpdates() sono state rimosse.
// Non erano chiamate da nessun modulo e cercavano l'id 'toggle-battle-markers'
// che non esiste nell'HTML (l'id reale e' 'checkActiveBattles'). Il ciclo di
// aggiornamento e' gestito da main.js, il toggle da toggleBattleMarkers().