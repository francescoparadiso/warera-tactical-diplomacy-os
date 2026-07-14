// map.js
import maplibregl from 'maplibre-gl';
import * as topojson from 'topojson-client';
import { state } from './state.js';
import { COLORS, LAYER_IDS, THEMES } from './config.js';
import {
  buildMultiBlocPatternExpression, getMultiBlocPatternExpression, getMultiBlocPatternExpressionOriginal,
  preloadDiplomacyDualPattern, DIPLOMACY_DUAL_PATTERN_KEY,
} from './patterns.js';
import {
  buildDiplomacyColorExpression, buildBlocColorExpression, buildOriginalBlocColorExpression, buildOriginalColorExpression,
  getIndirectAllies, getEnemyAllies, getAllianceAllies, getDefensivePactAllies, getDualAllyDefensiveIds,
} from './diplomacy.js';
import { initLabelCanvas, preloadAllFlags, buildOriginalLabels, loadFlagImage } from './labels.js';
import { updateDynamicLegend, updateStats, updateSelectedDisplay } from './ui.js';
import { buildPopulationColorExpression, buildPopulationTextExpression } from './population.js';
import { buildWeeklyDamageColorExpression } from './weeklyDamage.js';
import { buildSphereColorExpression } from './sphereOfInfluence.js';
import { buildBattleHeatmapColorExpression } from './battleHeatmap.js';
import { initNationTooltip } from './nationTooltip.js';
import { hide as hideTooltip } from './nationTooltip.js';

const { SRC_REGIONS, SRC_BORDERS, SRC_LABELS, LYR_FILL, LYR_OUTLINE, LYR_COAST, LYR_BORDER, LYR_MULTI_BLOC, LYR_DIPLOMACY_DUAL } = LAYER_IDS;

// ==================== INIT MAPPA ====================
export function initMap() {
  const theme = THEMES[state.theme];
  state.map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme.OCEAN } }],
    },
    center: [0, 20],
    zoom: 2,
    minZoom: 1.7,
    maxZoom: 8,
    renderWorldCopies: true,
    attributionControl: false,
  });
}

function _buildLabelsWithPopulation() {
  const source = state.mapSource === 'original' ? state.originalLabelsData : state.labelsData;
  if (!source?.length) return [];
  return source.map(l => {
    const cId = l.properties.countryId;
    const nation = state.nationMap.get(cId);
    const pop = nation?.rankings?.countryActivePopulation?.value;
    let popText = '';
    if (typeof pop === 'number' && pop > 0) {
      popText = pop >= 1_000_000 ? (pop / 1_000_000).toFixed(1) + 'M' : pop.toLocaleString();
    }
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: l.coordinates },
      properties: { ...l.properties, populationText: popText }
    };
  });
}

// ==================== SETUP LAYER ====================
export async function setupMapLayers() {
  const topoData = state.mapDataGlobal.map;
  state.baseGeoJSON = topojson.feature(topoData, topoData.objects.regions);
  state.labelsData = state.mapDataGlobal.countryLabels?.geometries || topoData.objects.countryLabels?.geometries || [];

  computeCentroids();

  _addOrUpdateSource(SRC_REGIONS, { type: 'geojson', data: state.baseGeoJSON });

  const bordersMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && a.properties.countryId !== b.properties.countryId);
  const coastMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a === b);
  const regionsMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && a.properties.countryId === b.properties.countryId);

  _addOrUpdateSource(SRC_BORDERS, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'border' }, geometry: bordersMesh },
        { type: 'Feature', properties: { kind: 'coast' }, geometry: coastMesh },
        { type: 'Feature', properties: { kind: 'region' }, geometry: regionsMesh },
      ],
    },
  });

  _addOrUpdateSource(SRC_LABELS, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: _buildLabelsWithPopulation() },
  });

  if (!state.map.getLayer(LYR_FILL)) {
    state.map.addLayer({ id: LYR_FILL, type: 'fill', source: SRC_REGIONS, paint: { 'fill-color': COLORS.NEUTRAL_UNSELECTED, 'fill-opacity': 0.9 } });
  }

  if (!state.map.getSource('original-borders-src')) {
    const origMesh = _getOriginalBordersMesh(topoData);
    state.map.addSource('original-borders-src', { type: 'geojson', data: origMesh });
    state.map.addLayer({ id: 'original-borders-line', type: 'line', source: 'original-borders-src', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.9 }, layout: { visibility: 'none' } });
  }

  if (!state.map.getLayer(LYR_MULTI_BLOC)) {
    state.map.addLayer({
      id: LYR_MULTI_BLOC, type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'countryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }
  if (!state.map.getLayer('multi-bloc-pattern-original')) {
    state.map.addLayer({
      id: 'multi-bloc-pattern-original', type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'initialCountryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }

  if (!state.map.getLayer(LYR_DIPLOMACY_DUAL)) {
    state.map.addLayer({
      id: LYR_DIPLOMACY_DUAL, type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'countryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }

  if (!state.map.getLayer(LYR_COAST)) state.map.addLayer({ id: LYR_COAST, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'coast'], paint: { 'line-color': '#ffffff', 'line-width': 1.0, 'line-opacity': 0.9 } });
  if (!state.map.getLayer(LYR_BORDER)) state.map.addLayer({ id: LYR_BORDER, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'border'], paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 1 } });
  if (!state.map.getLayer(LYR_OUTLINE)) state.map.addLayer({ id: LYR_OUTLINE, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'region'], paint: { 'line-color': '#000000', 'line-width': 0.4, 'line-opacity': 1 } });
  if (state.map.getLayer(LYR_OUTLINE) && state.map.getLayer(LYR_BORDER)) state.map.moveLayer(LYR_OUTLINE, LYR_BORDER);

  initLabelCanvas();
  preloadAllFlags();
  initNationTooltip(state.map);
state.map.on('click', (e) => {
  // Se siamo in battleHeatmap
  if (state.coloringMode === 'battleHeatmap') {
    // Controlla se il click è su un marker di battaglia
    const target = e.originalEvent?.target;
    const isMarker = target && target.closest && target.closest('.battle-marker');
    
    // Se NON è un marker, esci dalla heatmap
    if (!isMarker) {
      import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
    }
  }
});
  state.map.on('click', LYR_FILL, _onRegionClick)
  state.map.on('mouseenter', LYR_FILL, () => { state.map.getCanvas().style.cursor = 'pointer'; });
  state.map.on('mouseleave', LYR_FILL, () => { state.map.getCanvas().style.cursor = ''; });

  await buildMultiBlocPatternExpression();
  await preloadDiplomacyDualPattern();
  renderMap();
}

// ==================== RENDER MAPPA ====================
export function renderMap() {
  if (!state.map || !state.mapDataGlobal) return;
  if (!state.alliancesList && state.coloringMode === 'blocs') return;
  if (!state.selectedCountryId) {
    hideTooltip();
  }
  updateDynamicLegend();
  updateStats();
  updateSelectedDisplay();

  _setLayerVisibility(LYR_BORDER, state.mapSource === 'actual');
  _setLayerVisibility('original-borders-line', state.mapSource === 'original');

  const multiIds = [...state.multiBlocMap.keys()];
  if (state.coloringMode === 'blocs' && multiIds.length > 0) {
    if (state.mapSource === 'original') {
      _setLayerVisibility(LYR_MULTI_BLOC, false);
      const lyr = 'multi-bloc-pattern-original';
      state.map.setFilter(lyr, ['in', ['get', 'initialCountryId'], ['literal', multiIds]]);
      state.map.setPaintProperty(lyr, 'fill-pattern', getMultiBlocPatternExpressionOriginal());
      _setLayerVisibility(lyr, true);
    } else {
      _setLayerVisibility('multi-bloc-pattern-original', false);
      state.map.setFilter(LYR_MULTI_BLOC, ['in', ['get', 'countryId'], ['literal', multiIds]]);
      state.map.setPaintProperty(LYR_MULTI_BLOC, 'fill-pattern', getMultiBlocPatternExpression());
      _setLayerVisibility(LYR_MULTI_BLOC, true);
    }
  } else {
    _setLayerVisibility(LYR_MULTI_BLOC, false);
    _setLayerVisibility('multi-bloc-pattern-original', false);
  }

  let dualIds = [];
  if (state.coloringMode === 'diplomacy' && state.selectedCountryId) {
    dualIds = getDualAllyDefensiveIds(state.selectedCountryId);
  }
  if (state.coloringMode === 'diplomacy' && dualIds.length > 0) {
    const propKey = state.mapSource === 'original' ? 'initialCountryId' : 'countryId';
    state.map.setFilter(LYR_DIPLOMACY_DUAL, ['in', ['get', propKey], ['literal', dualIds]]);
    state.map.setPaintProperty(LYR_DIPLOMACY_DUAL, 'fill-pattern', DIPLOMACY_DUAL_PATTERN_KEY);
    _setLayerVisibility(LYR_DIPLOMACY_DUAL, true);
  } else {
    _setLayerVisibility(LYR_DIPLOMACY_DUAL, false);
  }

  const isExtended = document.getElementById('checkExtended').checked;
  let directWars = [], directAllies = [], indirectAllies = [], enemyAllies = [];
  if (state.coloringMode === 'diplomacy' && state.selectedCountryId) {
    const target = state.nationMap.get(state.selectedCountryId);
    if (target) {
      directWars = [...(target.warsWith || [])];
      const dipl = state.diplomacyData.get(state.selectedCountryId);
      if (dipl?.swornEnemy) directWars.push(dipl.swornEnemy);
      directWars = [...new Set(directWars)];

      directAllies = getAllianceAllies(state.selectedCountryId);
      indirectAllies = getIndirectAllies(state.selectedCountryId);
      enemyAllies = getEnemyAllies(state.selectedCountryId);
    }
  }

  let fillExpr;
  if (state.coloringMode === 'population') {
    fillExpr = buildPopulationColorExpression(state.mapSource === 'original');
  } else if (state.coloringMode === 'weeklyDamage') {
    fillExpr = buildWeeklyDamageColorExpression(state.mapSource === 'original');
  } else if (state.coloringMode === 'sphereOfInfluence') {
    fillExpr = buildSphereColorExpression(state.mapSource === 'original');
  } else if (state.coloringMode === 'blocs') {
    fillExpr = state.mapSource === 'actual' ? buildBlocColorExpression() : buildOriginalBlocColorExpression();
  } else if (state.coloringMode === 'battleHeatmap') {
    fillExpr = buildBattleHeatmapColorExpression(state.mapSource === 'original');
  } else if (state.mapSource === 'actual') {
    const styleMap = {};
    state.labelsData.forEach(l => { if (l.properties?.countryId) styleMap[l.properties.countryId] = l.properties.strokeColor; });
    fillExpr = buildDiplomacyColorExpression(directWars, directAllies, indirectAllies, enemyAllies, styleMap, isExtended);
  } else {
    fillExpr = buildOriginalColorExpression(directWars, directAllies, indirectAllies, enemyAllies, isExtended);
  }

  if (state.map.getLayer(LYR_FILL)) {
    state.map.setPaintProperty(LYR_FILL, 'fill-color', fillExpr);
    state.map.setPaintProperty(LYR_FILL, 'fill-opacity', 0.9);
  }

  if (state.map.getSource(SRC_LABELS)) {
    state.map.getSource(SRC_LABELS).setData({
      type: 'FeatureCollection',
      features: _buildLabelsWithPopulation()
    });
  }
  if (state.labelCanvas) state.map.triggerRepaint();
}

// ==================== PRIVATE ====================
function _addOrUpdateSource(id, config) {
  if (!state.map.getSource(id)) state.map.addSource(id, config);
  else state.map.getSource(id).setData(config.data);
}

function _setLayerVisibility(id, visible) {
  if (state.map.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

function _getOriginalBordersMesh(topoData) {
  const cloned = JSON.parse(JSON.stringify(topoData));
  const regions = cloned.objects.regions;
  if (regions?.geometries) {
    regions.geometries.forEach(geom => {
      if (geom.properties?.initialCountryId) geom.properties.countryId = geom.properties.initialCountryId;
    });
  }
  return topojson.mesh(cloned, cloned.objects.regions, (a, b) => a !== b && a.properties.countryId !== b.properties.countryId);
}

function _onRegionClick(e) {
  if (!e.features?.length) return;
  const cId = state.mapSource === 'original'
    ? e.features[0].properties.initialCountryId
    : e.features[0].properties.countryId;
  state.selectedCountryId = state.selectedCountryId === cId ? null : cId;
  if (!state.selectedCountryId) {
    hideTooltip();
  }
  renderMap();
  if (window.umami && state.selectedCountryId) {
    const nation = state.nationMap.get(state.selectedCountryId);
    if (nation) umami.track('nation-click', { nation: nation.name });
  }
}

// ==================== CENTROIDI (per battle markers) ====================
function computeCentroids() {
  state.centroids.clear();
  if (!state.baseGeoJSON) return;
  const flattenCoords = (geometry) => {
    const result = [];
    function extract(c) {
      if (!c) return;
      if (typeof c[0] === 'number') result.push(c);
      else c.forEach(extract);
    }
    extract(geometry.coordinates);
    return result;
  };

  state.baseGeoJSON.features.forEach(f => {
    const initId = f.properties?.initialCountryId;
    const curId = f.properties?.countryId;
    if (!initId && !curId) return;
    const coords = flattenCoords(f.geometry);
    if (!coords.length) return;
    let sumLng = 0, sumLat = 0;
    coords.forEach(coord => { sumLng += coord[0]; sumLat += coord[1]; });
    const c = [sumLng / coords.length, sumLat / coords.length];
    if (curId && !state.centroids.has(curId)) state.centroids.set(curId, c);
    if (initId && !state.centroids.has(initId)) state.centroids.set(initId, c);
  });
}

// ==================== RICERCA E RESET ====================
export function cercaNazione() {
  const input = document.getElementById('cercaInput');
  const val = input.value.toLowerCase().trim();
  if (!val) return;
  const found = state.nazioniGlobal.find(n => n.name.toLowerCase() === val) || state.nazioniGlobal.find(n => n.name.toLowerCase().includes(val));
  if (found) {
    state.selectedCountryId = found._id;
    input.value = found.name;
    renderMap();
    const label = state.labelsData.find(l => l.properties?.countryId === found._id);
    if (label) state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
    if (window.innerWidth <= 768) document.getElementById('dynamic-legend').classList.add('hidden');
  }
}

export function resetDiplomazia() {
  state.selectedCountryId = null;
  state.customNaps = [];
  document.getElementById('cercaInput').value = '';
  document.getElementById('checkExtended').checked = false;
  document.getElementById('napInput').value = '';
  document.getElementById('checkExcludeExternalNaps').checked = false;
  setMapSource(false);
  setColoringMode('diplomacy');
  import('./naps.js').then(({ updateNapListUI }) => updateNapListUI());
  renderMap();
}

export function setMapSource(isOriginal) {
  state.mapSource = isOriginal ? 'original' : 'actual';
  const lA = document.getElementById('label-actual');
  const lO = document.getElementById('label-original');
  if (lA && lO) {
    lA.classList.toggle('active', !isOriginal);
    lO.classList.toggle('active', isOriginal);
  }
  document.getElementById('toggle-borders').checked = isOriginal;
  renderMap();
}

export function applyTheme() {
  const theme = THEMES[state.theme];
  if (!state.map) return;
  if (state.map.getLayer('background')) {
    state.map.setPaintProperty('background', 'background-color', theme.OCEAN);
  }
  if (state.map.getLayer(LYR_COAST)) {
    state.map.setPaintProperty(LYR_COAST, 'line-color', theme.COAST_COLOR);
  }
  if (state.map.getLayer(LYR_BORDER)) {
    state.map.setPaintProperty(LYR_BORDER, 'line-color', theme.BORDER_COLOR);
  }
  if (state.map.getLayer(LYR_OUTLINE)) {
    state.map.setPaintProperty(LYR_OUTLINE, 'line-color', theme.OUTLINE_COLOR);
  }
  if (state.map.getLayer(LYR_FILL)) {
    state.map.setPaintProperty(LYR_FILL, 'fill-color', theme.NEUTRAL_UNSELECTED);
  }
  renderMap();
}

// map.js - sostituisci la funzione setColoringMode

export function setColoringMode(mode) {
  state.coloringMode = mode;
  
  // Aggiorna i pulsanti della prima riga
  document.getElementById('mode-diplomacy').classList.toggle('active', mode === 'diplomacy');
  document.getElementById('mode-blocs').classList.toggle('active', mode === 'blocs');
  document.getElementById('mode-sphereOfInfluence')?.classList.toggle('active', mode === 'sphereOfInfluence');
  
  // Aggiorna i pulsanti della seconda riga
  document.getElementById('mode-weeklyDamage').classList.toggle('active', mode === 'weeklyDamage');
  document.getElementById('mode-population').classList.toggle('active', mode === 'population');
  
  // Slider prima riga (3 pulsanti: diplomacy, blocs, sphere)
  const sliderTop = document.getElementById('mode-slider');
  if (sliderTop) {
    const isMobile = window.innerWidth <= 768;
    const positions = {
      diplomacy: isMobile ? '2px' : '3px',
      blocs: isMobile ? 'calc(33.33% + 0.5px)' : 'calc(33.33% + 0.6px)',
      sphereOfInfluence: isMobile ? 'calc(66.66% + 0.5px)' : 'calc(66.66% + 0.6px)'
    };
    // Per i modi della seconda riga, nascondi lo slider o mettilo in una posizione neutra
    if (mode === 'weeklyDamage' || mode === 'population') {
      sliderTop.style.opacity = '0.3';
    } else {
      sliderTop.style.opacity = '1';
      sliderTop.style.left = positions[mode] || '3px';
    }
  }
  
  // Slider seconda riga (2 pulsanti: weeklyDamage, population)
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) {
    const isMobile = window.innerWidth <= 768;
    const positions = {
      weeklyDamage: isMobile ? '2px' : '3px',
      population: isMobile ? 'calc(50% + 0.5px)' : 'calc(50% + 0.6px)'
    };
    if (mode === 'weeklyDamage' || mode === 'population') {
      sliderBottom.style.opacity = '1';
      sliderBottom.style.left = positions[mode] || '3px';
    } else {
      sliderBottom.style.opacity = '0.3';
      // Rimani nella posizione precedente o nascondi
      if (state._lastBottomMode) {
        sliderBottom.style.left = positions[state._lastBottomMode] || '3px';
      }
    }
    // Salva l'ultimo modo della seconda riga
    if (mode === 'weeklyDamage' || mode === 'population') {
      state._lastBottomMode = mode;
    }
  }
  
  // Assicura che le modalità siano attive correttamente
  const topModes = ['diplomacy', 'blocs', 'sphereOfInfluence'];
  const bottomModes = ['weeklyDamage', 'population'];
  
  // Reset visivo per tutti i pulsanti
  document.querySelectorAll('.mode-btn').forEach(btn => {
    // I pulsanti sono gestiti dai toggle individuali sopra
  });
  
  renderMap();
}