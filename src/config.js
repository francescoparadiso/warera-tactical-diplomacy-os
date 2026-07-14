// config.js
//export const API_BASE_URL = 'https://apidev.warera.io';  // per test
export const API_BASE_URL = 'https://api6.warera.io'; // per produzione
export const CACHE_API_BASE_URL = 'https://gateway.warerastats.io'
export const API_KEY = 'wae_ea8085c61df10b92478347cecfeb7006844f1fb0e0e066ee462665e471141849';

export const COLORS = {
  SELECTED: '#ffcc00',
  WAR_DIRECT: '#ff0000',
  WAR_INDIRECT: '#b30000',
  ALLY_DIRECT: '#2ecc71',
  ALLY_INDIRECT: '#145a32',
  BORDERLINE: '#ff9100',
  NAP: '#00d4ff',
  DEFAULT_LAND: '#4a4e5a',
  NEUTRAL_UNSELECTED: '#3a3d46',
  OCEAN: '#000000',
  ITALIAN_BLOC: '#1b557a',
  WESTERN_BLOC: '#55a5d9',
  AFRICAN_UNION: '#e67e22',
  ASIAN_FEDERATION: '#8e44ad',
  ICDP: '#c0392b',
  HOLY_LEAGUE: '#FFD700',
  // Nuovi colori
  DEFENSIVE_PACT: '#9b59b6', // viola
  SWORN_ENEMY: '#e67e22',    // arancione
};

export const THEMES = {
  dark: {
    OCEAN: '#00042679',
    DEFAULT_LAND: '#4a4e5a',
    NEUTRAL_UNSELECTED: '#3a3d46',
    TEXT: '#e6edf3',
    TEXT_SECONDARY: '#8b949e',
    PANEL_BG: 'rgba(10,10,10,0.95)',
    PANEL_BORDER: '#333',
    BUTTON_BG: '#1a1a1a',
    BUTTON_BORDER: '#444',
    INPUT_BG: '#1a1a1a',
    INPUT_BORDER: '#444',
    SWITCH_BG: '#333',
    SWITCH_BORDER: '#444',
    LEGEND_BG: 'rgba(13,17,23,0.92)',
    LEGEND_BORDER: '#30363d',
    COAST_COLOR: '#ffffff',
    BORDER_COLOR: '#ffffff',
    OUTLINE_COLOR: '#000000',
  },
  light: {
    OCEAN: '#a2986f',        
    DEFAULT_LAND: '#ffe7a6',  
    NEUTRAL_UNSELECTED: '#352700',
    TEXT: '#1a1a1a',
    TEXT_SECONDARY: '#555555',
    PANEL_BG: 'rgba(255,255,255,0.95)',
    PANEL_BORDER: '#cccccc',
    BUTTON_BG: '#f0f0f0',
    BUTTON_BORDER: '#cccccc',
    INPUT_BG: '#ffffff',
    INPUT_BORDER: '#cccccc',
    SWITCH_BG: '#dddddd',
    SWITCH_BORDER: '#bbbbbb',
    LEGEND_BG: 'rgba(255,255,255,0.95)',
    LEGEND_BORDER: '#cccccc',
    COAST_COLOR: '#000000',
    BORDER_COLOR: '#000000',
    OUTLINE_COLOR: '#000000',
  }
};

export const LAYER_IDS = {
  SRC_REGIONS: 'regions-src',
  SRC_BORDERS: 'borders-src',
  SRC_LABELS: 'labels-src',
  LYR_FILL: 'regions-fill',
  LYR_OUTLINE: 'regions-outline',
  LYR_COAST: 'regions-coast',
  LYR_BORDER: 'borders-line',
  LYR_MULTI_BLOC: 'multi-bloc-pattern',
  LYR_DIPLOMACY_DUAL: 'diplomacy-dual-pattern',
};

export const EXTERNAL_NAPS_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/warera_naps.csv';

export const EXTERNAL_SPHERE_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/SphereOfInfluence.csv';