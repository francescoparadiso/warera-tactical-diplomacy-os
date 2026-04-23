import maplibregl from 'maplibre-gl';
import * as topojson from 'topojson-client';
import { state } from './state.js';
import { COLORS, LAYER_IDS } from './config.js';
import { buildMultiBlocPatternExpression, getMultiBlocPatternExpression, getMultiBlocPatternExpressionOriginal } from './patterns.js';
import { buildDiplomacyColorExpression, buildBlocColorExpression, buildOriginalBlocColorExpression, buildOriginalColorExpression, getIndirectAllies, getEnemyAllies } from './diplomacy.js';
import { initLabelCanvas, preloadAllFlags, buildOriginalLabels, loadFlagImage } from './labels.js';
import { updateDynamicLegend, updateStats, updateSelectedDisplay } from './ui.js';

const { SRC_REGIONS, SRC_BORDERS, SRC_LABELS, LYR_FILL, LYR_OUTLINE, LYR_COAST, LYR_BORDER, LYR_MULTI_BLOC } = LAYER_IDS;

// ==================== INIT MAPPA ====================
export function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': COLORS.OCEAN } }],
    },
    center: [0, 20],
    zoom: 2,
    minZoom: 1.7,
    maxZoom: 8,
    renderWorldCopies: true,
    attributionControl: false,
  });
}

// ==================== SETUP LAYER ====================
export async function setupMapLayers() {
  const topoData = state.mapDataGlobal.map;
  state.baseGeoJSON = topojson.feature(topoData, topoData.objects.regions);
  state.labelsData  = state.mapDataGlobal.countryLabels?.geometries || topoData.objects.countryLabels?.geometries || [];

  // Sorgenti
  _addOrUpdateSource(SRC_REGIONS, { type: 'geojson', data: state.baseGeoJSON });

  const bordersMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && a.properties.countryId !== b.properties.countryId);
  const coastMesh   = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a === b);
  const regionsMesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => a !== b && a.properties.countryId === b.properties.countryId);

  _addOrUpdateSource(SRC_BORDERS, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'border' }, geometry: bordersMesh },
        { type: 'Feature', properties: { kind: 'coast'  }, geometry: coastMesh   },
        { type: 'Feature', properties: { kind: 'region' }, geometry: regionsMesh },
      ],
    },
  });

  _addOrUpdateSource(SRC_LABELS, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: state.labelsData.map(l => ({ type: 'Feature', geometry: { type: 'Point', coordinates: l.coordinates }, properties: l.properties })),
    },
  });

  // Layer fill principale
  if (!state.map.getLayer(LYR_FILL)) {
    state.map.addLayer({ id: LYR_FILL, type: 'fill', source: SRC_REGIONS, paint: { 'fill-color': COLORS.NEUTRAL_UNSELECTED, 'fill-opacity': 0.9 } });
  }

  // Bordi originali
  if (!state.map.getSource('original-borders-src')) {
    const origMesh = _getOriginalBordersMesh(topoData);
    state.map.addSource('original-borders-src', { type: 'geojson', data: origMesh });
    state.map.addLayer({ id: 'original-borders-line', type: 'line', source: 'original-borders-src', paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.9 }, layout: { visibility: 'none' } });
  }

  // Layer multi-bloc actual
  if (!state.map.getLayer(LYR_MULTI_BLOC)) {
    state.map.addLayer({
      id: LYR_MULTI_BLOC, type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'countryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }
  // Layer multi-bloc original
  if (!state.map.getLayer('multi-bloc-pattern-original')) {
    state.map.addLayer({
      id: 'multi-bloc-pattern-original', type: 'fill', source: SRC_REGIONS,
      filter: ['==', ['get', 'initialCountryId'], '___none___'],
      layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.92 },
    });
  }

  // Coast, border, outline
  if (!state.map.getLayer(LYR_COAST)) state.map.addLayer({ id: LYR_COAST, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'coast'], paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.9 } });
  if (!state.map.getLayer(LYR_BORDER)) state.map.addLayer({ id: LYR_BORDER, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'border'], paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.8 } });
  if (!state.map.getLayer(LYR_OUTLINE)) state.map.addLayer({ id: LYR_OUTLINE, type: 'line', source: SRC_BORDERS, filter: ['==', ['get', 'kind'], 'region'], paint: { 'line-color': '#000000', 'line-width': 0.8, 'line-opacity': 0.7 } });
  if (state.map.getLayer(LYR_OUTLINE) && state.map.getLayer(LYR_BORDER)) state.map.moveLayer(LYR_OUTLINE, LYR_BORDER);

  initLabelCanvas();
  preloadAllFlags();

  // Click handler
  state.map.off('click', LYR_FILL, _onRegionClick);
  state.map.on('click', LYR_FILL, _onRegionClick);
  state.map.on('mouseenter', LYR_FILL, () => { state.map.getCanvas().style.cursor = 'pointer'; });
  state.map.on('mouseleave', LYR_FILL, () => { state.map.getCanvas().style.cursor = ''; });

  await buildMultiBlocPatternExpression();
  renderMap();
}

// ==================== RENDER MAPPA ====================
export function renderMap() {
  if (!state.map || !state.mapDataGlobal) return;
  updateDynamicLegend();
  updateStats();
  updateSelectedDisplay();

  // Visibilità bordi
  _setLayerVisibility(LYR_BORDER,             state.mapSource === 'actual');
  _setLayerVisibility('original-borders-line', state.mapSource === 'original');

  // Layer multi-bloc
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

  // Calcolo diplomazia
  const isExtended = document.getElementById('checkExtended').checked;
  let directWars = [], directAllies = [], indirectAllies = [], enemyAllies = [];
  if (state.coloringMode === 'diplomacy' && state.selectedCountryId) {
    const target = state.nationMap.get(state.selectedCountryId);
    if (target) {
      directWars    = target.warsWith || [];
      directAllies  = target.allies   || [];
      indirectAllies = getIndirectAllies(state.selectedCountryId);
      enemyAllies    = getEnemyAllies(state.selectedCountryId);
    }
  }

  // Fill color expression
  let fillExpr;
  if (state.coloringMode === 'blocs') {
    fillExpr = state.mapSource === 'actual' ? buildBlocColorExpression() : buildOriginalBlocColorExpression();
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
  const cloned  = JSON.parse(JSON.stringify(topoData));
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
  renderMap();
  if (window.umami && state.selectedCountryId) {
    const nation = state.nationMap.get(state.selectedCountryId);
    if (nation) umami.track('nation-click', { nation: nation.name });
  }
}

// ==================== RICERCA E RESET ====================
export function cercaNazione() {
  const input = document.getElementById('cercaInput');
  const val   = input.value.toLowerCase().trim();
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
    lO.classList.toggle('active',  isOriginal);
  }
  document.getElementById('toggle-borders').checked = isOriginal;
  renderMap();
}

export function setColoringMode(mode) {
  state.coloringMode = mode;
  document.getElementById('mode-diplomacy').classList.toggle('active', mode === 'diplomacy');
  document.getElementById('mode-blocs').classList.toggle('active',     mode === 'blocs');
  renderMap();
}
