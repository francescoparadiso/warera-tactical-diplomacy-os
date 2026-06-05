import 'maplibre-gl/dist/maplibre-gl.css';
import { state } from './state.js';
import { hashColor, showLoading, hideLoading } from './utils.js';
import { showToast, updateDynamicLegend } from './ui.js';
import { initMap,renderMap, setupMapLayers, cercaNazione, resetDiplomazia, setMapSource, setColoringMode } from './map.js';
import { loadExternalBlocs } from './blocs.js';
import { loadExternalNaps, aggiungiNap } from './naps.js';
import { syncUIToState, toggleNapSection, updateExternalNapsUI } from './ui.js';
import { buildOriginalLabels, loadFlagImage } from './labels.js';
// ==================== CARICAMENTO DATI ====================
async function refreshData() {
  try {
    showLoading();
    const [resN, resM] = await Promise.all([
      fetch('https://api2.warera.io/trpc/country.getAllCountries'),
      fetch('https://api2.warera.io/trpc/map.getMapData'),
    ]);
    if (!resN.ok || !resM.ok) throw new Error('Failed to fetch data');

    const nationsData = await resN.json();
    const mapData = await resM.json();

    state.nazioniGlobal = nationsData.result.data;
    state.mapDataGlobal = mapData.result.data;

    state.nationMap.clear();
    state.nazioniGlobal.forEach(n => state.nationMap.set(n._id, n));

    await loadExternalBlocs();
    await loadExternalNaps();

    // Datalist autocomplete
    const datalist = document.getElementById('nazioniList');
    datalist.innerHTML = '';
    [...state.nazioniGlobal]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(n => datalist.appendChild(new Option(n.name)));

    await setupMapLayers();

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

    updateExternalNapsUI();
    syncUIToState();
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

  // Aggiorna icona
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = newTheme === 'light' ? '☀️' : '🌙';

  // Applica il tema alla mappa
  import('./map.js').then(module => {
    if (typeof module.applyTheme === 'function') module.applyTheme();
    if (typeof module.renderMap === 'function') module.renderMap();
    import('./ui.js').then(ui => ui.updateDynamicLegend());
  });
});

  // Ricerca
  document.getElementById('cercaInput').addEventListener('keypress', e => { if (e.key === 'Enter') cercaNazione(); });
  document.getElementById('searchBtn').addEventListener('click', cercaNazione);
  document.getElementById('resetBtn').addEventListener('click', resetDiplomazia);

  // NAP
  document.getElementById('napInput').addEventListener('keypress', e => { if (e.key === 'Enter') aggiungiNap(); });
  document.getElementById('addNapBtn').addEventListener('click', aggiungiNap);

  // Toggle borders
  document.getElementById('toggle-borders').addEventListener('change', function () {
    setMapSource(this.checked);
  });

  // Mode buttons
  document.getElementById('mode-diplomacy').addEventListener('click', () => setColoringMode('diplomacy'));
  document.getElementById('mode-blocs').addEventListener('click', () => setColoringMode('blocs'));
  document.getElementById('mode-population').addEventListener('click', () => setColoringMode('population'));
  document.getElementById('mode-weeklyDamage').addEventListener('click', () => setColoringMode('weeklyDamage'));
  // Switches
  document.getElementById('checkExtended').addEventListener('change', () => { import('./map.js').then(m => m.renderMap()); });
  document.getElementById('checkLabels').addEventListener('change', () => { if (state.map) state.map.triggerRepaint(); });
  document.getElementById('checkExcludeExternalNaps').addEventListener('change', () => { import('./map.js').then(m => m.renderMap()); });

  // Collapsible NAP sections
  document.getElementById('manualNapToggle').addEventListener('click', () => toggleNapSection('manual-nap-section'));
  document.getElementById('externalNapToggle').addEventListener('click', () => toggleNapSection('external-nap-section'));

  // Legenda
  document.getElementById('legendToggleBtn').addEventListener('click', () => {
    document.getElementById('dynamic-legend').classList.toggle('hidden');
  });

  // Zoom controls
  document.getElementById('zoomInBtn')?.addEventListener('click', () => { state.map?.zoomIn(); });
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => { state.map?.zoomOut(); });


  // Hamburger menu
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

  // Bloc Statistics page
  document.getElementById('bloc-stats-btn').addEventListener('click', () => {
    document.getElementById('map').style.display = 'none';
    document.getElementById('bloc-stats-page').style.display = 'block';
    // Nascondi anche eventuali overlay se interferiscono
    import('./blocStats.js').then(m => {
      const stats = m.computeBlocStats();
      m.renderBlocStats(stats);
    });
  });

  document.getElementById('bloc-stats-close').addEventListener('click', () => {
    document.getElementById('bloc-stats-page').style.display = 'none';
    document.getElementById('map').style.display = 'block';
  });
}

// ==================== INIT ====================
async function init() {
  initMap();
  const slider = document.getElementById('mode-slider');
  if (slider) {
    slider.style.left = '3px'; // Diplomacy è attivo di default
  }
  setupEventListeners();
  state.map.on('load', refreshData);
}

init();