// diplomacy.js
import { state } from './state.js';
import { COLORS, THEMES } from './config.js';

// ==================== NUOVA FUNZIONE PER OTTENERE TUTTI GLI ALLEATI ====================
export function getAllianceAllies(countryId) {
  const allies = new Set();
  // Solo i membri della stessa alleanza/blocco
  const allianceIds = state.nationAlliancesMap.get(countryId);
  if (allianceIds) {
    allianceIds.forEach(allianceId => {
      const alliance = state.alliancesList.find(a => a._id === allianceId);
      if (alliance) {
        alliance.memberCountries.forEach(m => {
          if (m.country && m.country !== countryId) allies.add(m.country);
        });
      }
    });
  }
  return [...allies];
}

export function getDefensivePactAllies(countryId) {
  const dipl = state.diplomacyData.get(countryId);
  return dipl?.defensivePacts || [];
}

// Nazioni che sono SIA alleate (stesso blocco) SIA legate da patto difensivo:
// vengono mostrate in verde (priorità all'alleanza) ma evidenziate con pattern a doppio colore.
export function getDualAllyDefensiveIds(countryId) {
  const allies = getAllianceAllies(countryId);
  const defensive = getDefensivePactAllies(countryId);
  return allies.filter(id => defensive.includes(id));
}

// ==================== HELPERS DIPLOMAZIA ====================
export function getIndirectAllies(targetId) {
  const target = state.nationMap.get(targetId);
  if (!target) return [];
  const allDirect = new Set(getAllianceAllies(targetId));
  const indirect = new Set();
  allDirect.forEach(allyId => {
    const ally = state.nationMap.get(allyId);
    if (ally) {
      const allyAllies = getAllianceAllies(allyId);
      allyAllies.forEach(id => {
        if (id !== targetId && !allDirect.has(id)) indirect.add(id);
      });
    }
  });
  return [...indirect];
}

export function getEnemyAllies(targetId) {
  const target = state.nationMap.get(targetId);
  if (!target) return [];
  const enemies = new Set(target.warsWith || []);
  const dipl = state.diplomacyData.get(targetId);
  if (dipl?.swornEnemy) enemies.add(dipl.swornEnemy);
  const enemyAllies = new Set();
  enemies.forEach(enemyId => {
    const enemy = state.nationMap.get(enemyId);
    if (enemy) {
      getAllianceAllies(enemyId).forEach(id => {
        if (id !== targetId) enemyAllies.add(id);
      });
    }
  });
  return [...enemyAllies];
}

export function getColorForCountry(cId, directWars, directAllies, indirectAllies, enemyAllies, styleMap, isExtended) {
  const isManualNap = state.customNaps.includes(cId);
  const excludeExtNaps = document.getElementById('checkExcludeExternalNaps')?.checked || false;
  const isExternalNap = !excludeExtNaps && state.selectedCountryId && (
    state.externalNapsSet.has(`${state.selectedCountryId}-${cId}`) ||
    state.externalNapsSet.has(`${cId}-${state.selectedCountryId}`)
  );
  const isNap = isManualNap || isExternalNap;

  if (!state.selectedCountryId)        return styleMap[cId] || THEMES[state.theme].NEUTRAL_UNSELECTED;
  if (cId === state.selectedCountryId) return COLORS.SELECTED;
  if (isNap)                           return COLORS.NAP;

  const dipl = state.diplomacyData.get(state.selectedCountryId);
  const isDefensive = dipl?.defensivePacts?.includes(cId) || false;
  const isSworn = dipl?.swornEnemy === cId;

  // L'appartenenza allo stesso blocco/alleanza ha priorità sul patto difensivo:
  // una nazione alleata resta verde anche se ha anche un patto difensivo
  // (il doppio colore viene gestito separatamente via pattern overlay).
  if (isSworn)                         return COLORS.SWORN_ENEMY;
  if (directAllies.includes(cId))      return COLORS.ALLY_DIRECT;
  if (isDefensive)                     return COLORS.DEFENSIVE_PACT;

  if (directWars.includes(cId))        return COLORS.WAR_DIRECT;
  if (enemyAllies.includes(cId) && indirectAllies.includes(cId) && isExtended) return COLORS.BORDERLINE;
  if (enemyAllies.includes(cId))       return COLORS.WAR_INDIRECT;
  if (indirectAllies.includes(cId) && isExtended) return COLORS.ALLY_INDIRECT;
  return THEMES[state.theme].DEFAULT_LAND;
}

// ==================== BUILD EXPRESSIONS ====================
export function buildDiplomacyColorExpression(directWars, directAllies, indirectAllies, enemyAllies, styleMap, isExtended) {
  const theme = THEMES[state.theme];
  const expr = ['match', ['get', 'countryId']];
  const allIds = new Set([
    ...Object.keys(styleMap), ...directWars, ...directAllies,
    ...indirectAllies, ...enemyAllies, ...state.customNaps,
    ...(state.selectedCountryId ? [state.selectedCountryId] : []),
  ]);
  allIds.forEach(cId => expr.push(cId, getColorForCountry(cId, directWars, directAllies, indirectAllies, enemyAllies, styleMap, isExtended)));
  expr.push(theme.NEUTRAL_UNSELECTED);
  return expr;
}

export function buildBlocColorExpression() {
  const expr = ['match', ['get', 'countryId']];
  for (const [id, color] of state.blocColorMap.entries()) {
    if (!state.multiBlocMap.has(id)) expr.push(id, color);
  }
  expr.push(THEMES[state.theme].DEFAULT_LAND);
  return expr;
}

export function buildOriginalBlocColorExpression() {
  const expr = ['match', ['to-string', ['get', 'initialCountryId']]];
  for (const [id, color] of state.blocColorMap.entries()) {
    if (!state.multiBlocMap.has(id)) expr.push(id, color);
  }
  for (const [id, { colors }] of state.multiBlocMap.entries()) expr.push(id, colors[0]);
  expr.push(THEMES[state.theme].DEFAULT_LAND);
  return expr;
}

export function buildOriginalColorExpression(directWars, directAllies, indirectAllies, enemyAllies, isExtended) {
  const excludeExtNaps = document.getElementById('checkExcludeExternalNaps')?.checked || false;
  const colorMap = new Map();
  state.nazioniGlobal.forEach(n => {
    const id = n._id;
    let color;
    if (!state.selectedCountryId)        color = state.nationBaseColorMap.get(id) || THEMES[state.theme].DEFAULT_LAND;
    else if (id === state.selectedCountryId) color = COLORS.SELECTED;
    else if (state.customNaps.includes(id)) color = COLORS.NAP;
    else if (!excludeExtNaps && (state.externalNapsSet.has(`${state.selectedCountryId}-${id}`) || state.externalNapsSet.has(`${id}-${state.selectedCountryId}`))) color = COLORS.NAP;
    else {
      // Controlla patti difensivi e sworn enemy
      const dipl = state.diplomacyData.get(state.selectedCountryId);
      const isDefensive = dipl?.defensivePacts?.includes(id) || false;
      const isSworn = dipl?.swornEnemy === id;
      // Alleanza (stesso blocco) ha priorità sul patto difensivo
      if (isSworn) color = COLORS.SWORN_ENEMY;
      else if (directAllies.includes(id))  color = COLORS.ALLY_DIRECT;
      else if (isDefensive) color = COLORS.DEFENSIVE_PACT;
      else if (directWars.includes(id))    color = COLORS.WAR_DIRECT;
      else if (enemyAllies.includes(id) && indirectAllies.includes(id) && isExtended) color = COLORS.BORDERLINE;
      else if (enemyAllies.includes(id))   color = COLORS.WAR_INDIRECT;
      else if (indirectAllies.includes(id) && isExtended) color = COLORS.ALLY_INDIRECT;
      else color = THEMES[state.theme].DEFAULT_LAND;
    }
    colorMap.set(id, color);
  });

  const expr = ['match', ['to-string', ['get', 'initialCountryId']]];
  for (const [id, color] of colorMap.entries()) expr.push(id.toString(), color);
  expr.push(THEMES[state.theme].NEUTRAL_UNSELECTED);
  return expr;
}