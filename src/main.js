import 'maplibre-gl/dist/maplibre-gl.css';
import { state } from './state.js';
import { hashColor, showLoading, hideLoading } from './utils.js';
import { showToast, updateDynamicLegend } from './ui.js';
import { initMap, renderMap, setupMapLayers, cercaNazione, resetDiplomazia, setMapSource, setColoringMode } from './map.js';
//import { loadExternalBlocs } from './blocs.js';
import { loadExternalNaps, aggiungiNap } from './naps.js';
import { loadSphereOfInfluence } from './sphereOfInfluence.js';
import { syncUIToState, toggleNapSection, updateExternalNapsUI } from './ui.js';
import { buildOriginalLabels, loadFlagImage } from './labels.js';
import { API_BASE_URL } from './config.js';
import { updateBattleMarkers } from './battleMarkers.js';
import { loadRegions } from './regions.js';
// ==================== CARICAMENTO DATI ====================
async function refreshData() {
  try {
    showLoading();
    const [resN, resM] = await Promise.all([
      fetch(`${API_BASE_URL}/trpc/country.getAllCountries`),
      fetch(`${API_BASE_URL}/trpc/map.getMapData`),
    ]);
    if (!resN.ok || !resM.ok) throw new Error('Failed to fetch data');

    const nationsData = await resN.json();
    const mapData = await resM.json();

    state.nazioniGlobal = nationsData.result.data;
    state.mapDataGlobal = mapData.result.data;

    state.nationMap.clear();
    state.nazioniGlobal.forEach(n => state.nationMap.set(n._id, n));

    // ----- CARICAMENTO ALLEANZE CON GET BATCH -----
    const uniqueAllianceIds = [...new Set(
      state.nazioniGlobal
        .map(nation => nation.allianceId)
        .filter(id => id != null)
    )];

    let alliances = [];
    if (uniqueAllianceIds.length > 0) {
      const procedureNames = uniqueAllianceIds.map(() => 'alliance.getById').join(',');
      const batchInput = {};
      uniqueAllianceIds.forEach((id, idx) => {
        batchInput[idx] = { allianceId: id };
      });
      const url = `${API_BASE_URL}/trpc/${procedureNames}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Batch request failed: ${res.status}`);
      const results = await res.json();
      alliances = results.map(item => item.result.data);
    }

    state.alliancesList = alliances;
    state.allianceColorMap.clear();
    state.nationAlliancesMap.clear();
    // NOTA: processAlliancesData viene chiamato PIÙ AVANTI, dopo setupMapLayers(),
    // perché ha bisogno di state.labelsData già popolato per calcolare le
    // coordinate delle label dei blocchi (altrimenti i nomi dei blocchi non
    // vengono disegnati in modalità "blocs").
    // ----- FINE CARICAMENTO ALLEANZE -----

    // ----- CARICAMENTO DIPLOMAZIA (sworn enemy + defensive pacts) -----
    const countryIds = state.nazioniGlobal.map(n => n._id);
    state.diplomacyData.clear();
    const DIPLOMACY_CHUNK_SIZE = 25;
    try {
      for (let i = 0; i < countryIds.length; i += DIPLOMACY_CHUNK_SIZE) {
        const chunk = countryIds.slice(i, i + DIPLOMACY_CHUNK_SIZE);
        const procedureNames = chunk.map(() => 'countryDiplomacy.getByCountry').join(',');
        const batchInput = {};
        chunk.forEach((id, idx) => { batchInput[idx] = { countryId: id }; });
        const diplomacyUrl = `${API_BASE_URL}/trpc/${procedureNames}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`;
        const diplomacyRes = await fetch(diplomacyUrl);
        if (!diplomacyRes.ok) throw new Error(`Diplomacy batch failed: ${diplomacyRes.status}`);
        const diplomacyResults = await diplomacyRes.json();
        diplomacyResults.forEach((item, idx) => {
          const nationId = chunk[idx];
          const data = item?.result?.data?.json ?? item?.result?.data;
          if (!data) { if (item?.error) console.warn('Diplomacy error for', nationId, item.error); return; }
          state.diplomacyData.set(nationId, {
            swornEnemy: data.swornEnemy?.enemy || null,
            defensivePacts: (data.defensivePacts || []).map(p => p.partner),
          });
        });
      }
    } catch (diplErr) {
      console.error('Errore caricamento diplomazia:', diplErr);
    }
    // ----- FINE CARICAMENTO DIPLOMAZIA -----

    // Datalist autocomplete
    const datalist = document.getElementById('nazioniList');
    datalist.innerHTML = '';
    [...state.nazioniGlobal]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(n => datalist.appendChild(new Option(n.name)));

    await setupMapLayers();
    await loadRegions();
    setInterval(updateBattleMarkers, 60000);

    // Color map base
    state.nationBaseColorMap.clear();
    state.labelsData.forEach(label => {
      if (label.properties?.countryId) state.nationBaseColorMap.set(label.properties.countryId, label.properties.strokeColor);
    });
    state.nazioniGlobal.forEach(n => {
      if (!state.nationBaseColorMap.has(n._id)) state.nationBaseColorMap.set(n._id, n.color || hashColor(n._id));
    });

    buildOriginalLabels();
    state.originalLabelsData.forEach(l => {
      const c = l.properties?.countryCode?.toLowerCase();
      if (c) loadFlagImage(c);
    });

    // ----- ORA che state.labelsData è popolato, calcoliamo i dati delle alleanze -----
    // (blocColorMap, multiBlocMap, externalBlocsInfo con labelLng/labelLat corretti)
    const allianceModule = await import('./alliances.js');
    allianceModule.processAlliancesData(alliances);
    // ----------------------------------------------------------------------------

    updateExternalNapsUI();
    syncUIToState();
    loadSphereOfInfluence();

    // ==================== BATTLE MARKERS ====================
    await updateBattleMarkers();
    // Aggiorna i marcatori ogni 30 secondi
    setInterval(updateBattleMarkers, 30000);

    showToast('Strategic data loaded', 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to load game data', 'error');
  } finally {
    hideLoading();
  }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {

document.getElementById('theme-toggle-btn').addEventListener('click', function () {
  const newTheme = state.theme === 'light' ? 'dark' : 'light';
  state.theme = newTheme;
  document.body.classList.toggle('light-theme', newTheme === 'light');

  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = newTheme === 'light' ? '☀️' : '🌙';

  import('./map.js').then(module => {
    if (typeof module.applyTheme === 'function') module.applyTheme();
    if (typeof module.renderMap === 'function') module.renderMap();
    import('./ui.js').then(ui => ui.updateDynamicLegend());
  });

  import('./battleMarkers.js').then(m => {
    m.clearMarkers();
    setTimeout(() => m.updateBattleMarkers(), 50);
  });
});

  document.getElementById('cercaInput').addEventListener('keypress', e => { if (e.key === 'Enter') cercaNazione(); });
  document.getElementById('searchBtn').addEventListener('click', cercaNazione);
  document.getElementById('resetBtn').addEventListener('click', resetDiplomazia);

  document.getElementById('napInput').addEventListener('keypress', e => { if (e.key === 'Enter') aggiungiNap(); });
  document.getElementById('addNapBtn').addEventListener('click', aggiungiNap);

  document.getElementById('toggle-borders').addEventListener('change', function () {
    setMapSource(this.checked);
  });

// main.js - sostituisci la sezione dei listener dei pulsanti

// Pulsanti prima riga
document.getElementById('mode-diplomacy').addEventListener('click', () => {
  // Nascondi lo slider della seconda riga
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
  setColoringMode('diplomacy');
});

document.getElementById('mode-blocs').addEventListener('click', () => {
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
  setColoringMode('blocs');
});

document.getElementById('mode-sphereOfInfluence')?.addEventListener('click', () => {
  const sliderBottom = document.getElementById('mode-slider-bottom');
  if (sliderBottom) sliderBottom.style.opacity = '0.3';
  setColoringMode('sphereOfInfluence');
});

// Pulsanti seconda riga
document.getElementById('mode-weeklyDamage').addEventListener('click', () => {
  const sliderTop = document.getElementById('mode-slider');
  if (sliderTop) sliderTop.style.opacity = '0.3';
  setColoringMode('weeklyDamage');
});

document.getElementById('mode-population').addEventListener('click', () => {
  const sliderTop = document.getElementById('mode-slider');
  if (sliderTop) sliderTop.style.opacity = '0.3';
  setColoringMode('population');
});
  document.getElementById('checkExtended').addEventListener('change', () => { import('./map.js').then(m => m.renderMap()); });
  document.getElementById('checkLabels').addEventListener('change', () => { if (state.map) state.map.triggerRepaint(); });
  document.getElementById('checkExcludeExternalNaps').addEventListener('change', () => { import('./map.js').then(m => m.renderMap()); });

  document.getElementById('manualNapToggle').addEventListener('click', () => toggleNapSection('manual-nap-section'));
  document.getElementById('externalNapToggle').addEventListener('click', () => toggleNapSection('external-nap-section'));

  document.getElementById('legendToggleBtn').addEventListener('click', () => {
    document.getElementById('dynamic-legend').classList.toggle('hidden');
  });

  document.getElementById('zoomInBtn')?.addEventListener('click', () => { state.map?.zoomIn(); });
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => { state.map?.zoomOut(); });

  const hamburgerBtn = document.getElementById('hamburger-btn');
  const hamburgerMenu = document.getElementById('hamburger-menu');
  hamburgerBtn.addEventListener('click', e => {
    e.stopPropagation();
    hamburgerMenu.classList.toggle('visible');
  });
  document.addEventListener('click', e => {
    if (!hamburgerBtn.contains(e.target) && !hamburgerMenu.contains(e.target)) {
      hamburgerMenu.classList.remove('visible');
    }
  });

  document.getElementById('bloc-stats-btn').addEventListener('click', () => {
    document.getElementById('map').style.display = 'none';
    document.getElementById('bloc-stats-page').style.display = 'block';
    import('./blocStats.js').then(m => {
      const stats = m.computeBlocStats();
      m.renderBlocStats(stats);
    });
  });

  document.getElementById('bloc-stats-close').addEventListener('click', () => {
    document.getElementById('bloc-stats-page').style.display = 'none';
    document.getElementById('map').style.display = 'block';
  });
// Toggle Active Battles
document.getElementById('checkActiveBattles').addEventListener('change', function() {
  import('./battleMarkers.js').then(m => {
    m.toggleBattleMarkers(this.checked);
  });
});
  // ==================== TASTO ESC PER USCITA HEATMAP ====================
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.coloringMode === 'battleHeatmap') {
      import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
    }
  });
}

// ==================== INIT ====================
async function init() {
  initMap();
// main.js - dopo initMap(), aggiungi:

// Inizializza gli slider
const sliderTop = document.getElementById('mode-slider');
const sliderBottom = document.getElementById('mode-slider-bottom');

if (sliderTop) {
  sliderTop.style.left = '3px';
  sliderTop.style.opacity = '1';
}

if (sliderBottom) {
  sliderBottom.style.left = '3px';
  sliderBottom.style.opacity = '0.3'; // Nascondi inizialmente la seconda riga
  state._lastBottomMode = 'weeklyDamage'; // Default
}
  setupEventListeners();
  state.map.on('load', refreshData);
}

init();