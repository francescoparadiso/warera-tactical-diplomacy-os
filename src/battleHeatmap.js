import { state } from './state.js';
import { API_BASE_URL, COLORS } from './config.js';
import { showRateLimitTooltip } from './utils.js';
import { renderMap } from './map.js';
import { updateDynamicLegend } from './ui.js';

const BATTLE_NEUTRAL = '#2a2d33';
let liveInterval = null;
let exitButton = null;
let currentBattleId = null;
let savedColoringMode = 'diplomacy';

// ============ API ============

let lastSuccessfulBattlesCache = [];
let isRateLimited = false;

export async function fetchActiveBattles() {
  try {
    const all = [];
    let cursor = undefined;
    let guard = 0;
    let hasError = false;
    
    do {
      const input = { isActive: true, limit: 100, ...(cursor ? { cursor } : {}) };
      const url = `${API_BASE_URL}/trpc/battle.getBattles?input=${encodeURIComponent(JSON.stringify(input))}`;
      const res = await fetch(url);
      
      if (res.status === 429) {
        isRateLimited = true;
        showRateLimitTooltip();
        if (all.length > 0) {
          return all;
        }
        if (lastSuccessfulBattlesCache.length > 0) {
          return lastSuccessfulBattlesCache;
        }
        return [];
      }
      
      isRateLimited = false;
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data?.result?.data?.items || data?.items || [];
      all.push(...items);
      cursor = data?.result?.data?.nextCursor || data?.nextCursor || null;
      guard++;
    } while (cursor && guard < 20);
    
    if (all.length > 0) {
      lastSuccessfulBattlesCache = all;
    }
    
    console.log(`Fetched ${all.length} battles from ${guard} pages`);
    return all;
  } catch (err) {
    console.error('fetchActiveBattles error:', err);
    if (lastSuccessfulBattlesCache.length > 0) {
      return lastSuccessfulBattlesCache;
    }
    return [];
  }
}

export function resetBattlesCache() {
  lastSuccessfulBattlesCache = [];
  isRateLimited = false;
}

export async function fetchBattleDetails(battleId) {
  try {
    const input = { battleId };
    const url = `${API_BASE_URL}/trpc/battle.getById?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    
    if (res.status === 429) {
      showRateLimitTooltip();
      return null;
    }
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.result?.data || data;
  } catch (err) {
    console.error('fetchBattleDetails error:', err);
    return null;
  }
}

async function fetchRankingSide(battleId, side) {
  try {
    const input = { 
      battleId, 
      type: 'country', 
      side, 
      dataType: 'damage',
      limit: 100
    };
    const url = `${API_BASE_URL}/trpc/battleRanking.getRanking?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    
    if (res.status === 429) {
      showRateLimitTooltip();
      return [];
    }
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.result?.data?.items || data?.items || [];
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error(`fetchRankingSide (${side}) error:`, err);
    return [];
  }
}

export async function fetchBattleRanking(battleId) {
  try {
    const [attackerRanking, defenderRanking] = await Promise.all([
      fetchRankingSide(battleId, 'attacker'),
      fetchRankingSide(battleId, 'defender'),
    ]);

    if (attackerRanking.length === 0 && defenderRanking.length === 0) {
      return [];
    }

    console.log('Attacker rankings:', attackerRanking);
    console.log('Defender rankings:', defenderRanking);

    const nationMap = new Map();

    attackerRanking.forEach(item => {
      const countryId = item.country;
      if (!countryId) return;
      if (!nationMap.has(countryId)) {
        nationMap.set(countryId, { damageToAttackers: 0, damageToDefenders: 0 });
      }
      nationMap.get(countryId).damageToDefenders += item.value || 0;
    });

    defenderRanking.forEach(item => {
      const countryId = item.country;
      if (!countryId) return;
      if (!nationMap.has(countryId)) {
        nationMap.set(countryId, { damageToAttackers: 0, damageToDefenders: 0 });
      }
      nationMap.get(countryId).damageToAttackers += item.value || 0;
    });

    const processed = [];
    let maxDamage = 0;

    for (const [countryId, damages] of nationMap) {
      const { damageToAttackers, damageToDefenders } = damages;
      const totalDamage = damageToAttackers + damageToDefenders;
      const side = damageToAttackers > damageToDefenders ? 'defender' : 'attacker';
      if (totalDamage > maxDamage) maxDamage = totalDamage;
      processed.push({
        countryId,
        totalDamage,
        damageToAttackers,
        damageToDefenders,
        side,
      });
    }

    processed.sort((a, b) => b.totalDamage - a.totalDamage);
    return processed;
  } catch (err) {
    console.error('fetchBattleRanking error:', err);
    return [];
  }
}

// ============ Impostazione / Uscita ============

export async function setBattleHeatmap(battleId) {
  console.log('setBattleHeatmap called for battle:', battleId);
  console.log('currentBattleId:', currentBattleId);
  console.log('coloringMode:', state.coloringMode);
  
  // Se è già selezionata la stessa battaglia, esci
  if (currentBattleId === battleId && state.coloringMode === 'battleHeatmap') {
    console.log('Same battle, exiting');
    exitBattleHeatmap();
    return;
  }

  try {
    // SALVA IL MODO ORIGINALE SOLO SE NON SIAMO GIÀ IN HEATMAP
    if (state.coloringMode !== 'battleHeatmap') {
      savedColoringMode = state.coloringMode;
      console.log('Saved coloring mode:', savedColoringMode);
    }
    
    console.log('Fetching ranking data for battle:', battleId);
    const rankingData = await fetchBattleRanking(battleId);
    console.log('Ranking data received:', rankingData);
    
    if (!rankingData || !rankingData.length) {
      console.warn('No ranking data for battle', battleId);
      return;
    }

    const nations = rankingData;
    let maxDamage = 0;
    nations.forEach(n => { if (n.totalDamage > maxDamage) maxDamage = n.totalDamage; });

    const details = await fetchBattleDetails(battleId);
    const attackerId = details?.attacker?.country;
    const defenderId = details?.defender?.country;
    const getNation = (id) => {
      if (!id) return 'Unknown';
      const nation = state.nazioniGlobal.find(n => n._id === id);
      return nation ? nation.name : id.slice(0, 6);
    };
    const battleName = `${getNation(attackerId)} vs ${getNation(defenderId)}`;

    // AGGIORNA I DATI
    state.battleHeatmapData = {
      battleId,
      battleName,
      region: details?.region || 'Unknown',
      nations,
      maxDamage,
      rankingRaw: rankingData,
    };
    
    state.coloringMode = 'battleHeatmap';
    currentBattleId = battleId;

    // Ferma il vecchio live update e avvia quello nuovo
    stopLiveUpdates();
    startLiveUpdates(battleId);

    // Forza il rendering
    renderMap();
    updateDynamicLegend();
    console.log('Heatmap updated for battle:', battleName);
    
  } catch (err) {
    console.error('setBattleHeatmap error:', err);
  }
}

export function exitBattleHeatmap() {
  console.log('exitBattleHeatmap called');
  
  if (state.coloringMode === 'battleHeatmap') {
    const previousMode = savedColoringMode || 'diplomacy';
    console.log('Returning to mode:', previousMode);
    
    state.coloringMode = previousMode;
    state.battleHeatmapData = null;
    state.previousColoringMode = null;
    currentBattleId = null;
    
    stopLiveUpdates();
    
    if (exitButton) exitButton.style.display = 'none';
    
    import('./battleMarkers.js').then(m => {
      m.clearMarkers();
      setTimeout(() => m.updateBattleMarkers(), 100);
    });
    
    renderMap();
    updateDynamicLegend();
  } else {
    state.battleHeatmapData = null;
    state.previousColoringMode = null;
    currentBattleId = null;
    if (exitButton) exitButton.style.display = 'none';
    renderMap();
    updateDynamicLegend();
  }
}

function startLiveUpdates(battleId) {
  stopLiveUpdates();
  liveInterval = setInterval(async () => {
    if (state.coloringMode !== 'battleHeatmap' || state.battleHeatmapData?.battleId !== battleId) {
      stopLiveUpdates();
      return;
    }
    try {
      const rankingData = await fetchBattleRanking(battleId);
      if (rankingData && rankingData.length) {
        const nations = rankingData;
        let maxDamage = 0;
        nations.forEach(n => { if (n.totalDamage > maxDamage) maxDamage = n.totalDamage; });
        state.battleHeatmapData.nations = nations;
        state.battleHeatmapData.maxDamage = maxDamage;
        state.battleHeatmapData.rankingRaw = rankingData;
        renderMap();
      }
    } catch (err) {
      console.warn('Live update error:', err);
    }
  }, 10000);
}

function stopLiveUpdates() {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }
}

// ============ ESPRESSIONE COLORE ============

export function buildBattleHeatmapColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  if (!state.battleHeatmapData) return BATTLE_NEUTRAL;
  const { nations } = state.battleHeatmapData;
  const colorMap = new Map();

  let maxAttackerDmg = 0;
  let maxDefenderDmg = 0;
  nations.forEach(item => {
    if (item.side === 'attacker' && item.totalDamage > maxAttackerDmg) {
      maxAttackerDmg = item.totalDamage;
    } else if (item.side === 'defender' && item.totalDamage > maxDefenderDmg) {
      maxDefenderDmg = item.totalDamage;
    }
  });

  if (maxAttackerDmg === 0) maxAttackerDmg = 1;
  if (maxDefenderDmg === 0) maxDefenderDmg = 1;

  nations.forEach(item => {
    let pct;
    if (item.side === 'attacker') {
      pct = item.totalDamage / maxAttackerDmg;
    } else {
      pct = item.totalDamage / maxDefenderDmg;
    }
    pct = Math.min(1, Math.max(0, pct));
    
    let color;
    if (item.side === 'attacker') {
      const r = Math.round(214 - 214 * pct);
      const g = Math.round(232 - 197 * pct);
      const b = 255;
      color = `rgb(${Math.max(0,r)},${Math.max(0,g)},${b})`;
    } else {
      const r = 255;
      const g = Math.round(217 - 217 * pct);
      const b = Math.round(217 - 217 * pct);
      color = `rgb(${r},${Math.max(0,g)},${Math.max(0,b)})`;
    }
    
    if (item.totalDamage === 0) {
      color = item.side === 'attacker' ? 'rgb(214,232,255)' : 'rgb(255,217,217)';
    }
    
    colorMap.set(item.countryId, color);
  });

  if (!colorMap.size) return BATTLE_NEUTRAL;

  const expr = isOriginal
    ? ['match', ['to-string', ['get', prop]]]
    : ['match', ['get', prop]];

  for (const [id, color] of colorMap) {
    expr.push(isOriginal ? id.toString() : id, color);
  }
  expr.push(BATTLE_NEUTRAL);
  return expr;
}