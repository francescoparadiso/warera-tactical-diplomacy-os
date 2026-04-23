import { state } from './state.js';
import { COLORS } from './config.js';

// ==================== HELPERS DIPLOMAZIA ====================
export function getIndirectAllies(targetId) {
  const target = state.nationMap.get(targetId);
  if (!target?.allies) return [];
  const indirect = new Set();
  target.allies.forEach(allyId => {
    const ally = state.nationMap.get(allyId);
    if (ally?.allies) ally.allies.forEach(id => { if (id !== targetId && !target.allies.includes(id)) indirect.add(id); });
  });
  return [...indirect];
}

export function getEnemyAllies(targetId) {
  const target = state.nationMap.get(targetId);
  if (!target?.warsWith) return [];
  const enemyAllies = new Set();
  target.warsWith.forEach(enemyId => {
    const enemy = state.nationMap.get(enemyId);
    if (enemy?.allies) enemy.allies.forEach(id => { if (id !== targetId) enemyAllies.add(id); });
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

  if (!state.selectedCountryId)        return styleMap[cId] || COLORS.NEUTRAL_UNSELECTED;
  if (cId === state.selectedCountryId) return COLORS.SELECTED;
  if (isNap)                           return COLORS.NAP;
  if (directAllies.includes(cId))      return COLORS.ALLY_DIRECT;
  if (directWars.includes(cId))        return COLORS.WAR_DIRECT;
  if (enemyAllies.includes(cId) && indirectAllies.includes(cId) && isExtended) return COLORS.BORDERLINE;
  if (enemyAllies.includes(cId))       return COLORS.WAR_INDIRECT;
  if (indirectAllies.includes(cId) && isExtended) return COLORS.ALLY_INDIRECT;
  return COLORS.DEFAULT_LAND;
}

// ==================== BUILD EXPRESSIONS ====================
export function buildDiplomacyColorExpression(directWars, directAllies, indirectAllies, enemyAllies, styleMap, isExtended) {
  const expr = ['match', ['get', 'countryId']];
  const allIds = new Set([
    ...Object.keys(styleMap), ...directWars, ...directAllies,
    ...indirectAllies, ...enemyAllies, ...state.customNaps,
    ...(state.selectedCountryId ? [state.selectedCountryId] : []),
  ]);
  allIds.forEach(cId => expr.push(cId, getColorForCountry(cId, directWars, directAllies, indirectAllies, enemyAllies, styleMap, isExtended)));
  expr.push(state.selectedCountryId ? COLORS.DEFAULT_LAND : COLORS.NEUTRAL_UNSELECTED);
  return expr;
}

export function buildBlocColorExpression() {
  const expr = ['match', ['get', 'countryId']];
  for (const [id, color] of state.blocColorMap.entries()) { if (!state.multiBlocMap.has(id)) expr.push(id, color); }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

export function buildOriginalBlocColorExpression() {
  const expr = ['match', ['to-string', ['get', 'initialCountryId']]];
  for (const [id, color] of state.blocColorMap.entries()) { if (!state.multiBlocMap.has(id)) expr.push(id, color); }
  for (const [id, { colors }] of state.multiBlocMap.entries()) expr.push(id, colors[0]);
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

export function buildOriginalColorExpression(directWars, directAllies, indirectAllies, enemyAllies, isExtended) {
  const excludeExtNaps = document.getElementById('checkExcludeExternalNaps')?.checked || false;
  const colorMap = new Map();
  state.nazioniGlobal.forEach(n => {
    const id = n._id;
    let color;
    if (!state.selectedCountryId)        color = state.nationBaseColorMap.get(id) || COLORS.DEFAULT_LAND;
    else if (id === state.selectedCountryId) color = COLORS.SELECTED;
    else if (state.customNaps.includes(id)) color = COLORS.NAP;
    else if (!excludeExtNaps && (state.externalNapsSet.has(`${state.selectedCountryId}-${id}`) || state.externalNapsSet.has(`${id}-${state.selectedCountryId}`))) color = COLORS.NAP;
    else if (directAllies.includes(id))  color = COLORS.ALLY_DIRECT;
    else if (directWars.includes(id))    color = COLORS.WAR_DIRECT;
    else if (enemyAllies.includes(id) && indirectAllies.includes(id) && isExtended) color = COLORS.BORDERLINE;
    else if (enemyAllies.includes(id))   color = COLORS.WAR_INDIRECT;
    else if (indirectAllies.includes(id) && isExtended) color = COLORS.ALLY_INDIRECT;
    else color = COLORS.DEFAULT_LAND;
    colorMap.set(id, color);
  });

  const expr = ['match', ['to-string', ['get', 'initialCountryId']]];
  for (const [id, color] of colorMap.entries()) expr.push(id.toString(), color);
  expr.push(COLORS.NEUTRAL_UNSELECTED);
  return expr;
}
