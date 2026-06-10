// in config.js
//export const API_BASE_URL = 'https://apidev.warera.io';  // per test
 export const API_BASE_URL = 'https://api6.warera.io'; // per produzione

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
    COAST_COLOR: '#000000',   // marroncino chiaro, come i pulsanti
    BORDER_COLOR: '#000000',
    OUTLINE_COLOR: '#000000',
  }
}
export const LAYER_IDS = {
  SRC_REGIONS: 'regions-src',
  SRC_BORDERS: 'borders-src',
  SRC_LABELS: 'labels-src',
  LYR_FILL: 'regions-fill',
  LYR_OUTLINE: 'regions-outline',
  LYR_COAST: 'regions-coast',
  LYR_BORDER: 'borders-line',
  LYR_MULTI_BLOC: 'multi-bloc-pattern',
};
export const EXTERNAL_NAPS_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/warera_naps.csv';

  /*
export const EXTERNAL_BLOCS_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/AllianceBlocs.csv';



/*export const HARDCODED_BLOCS = [
  { nome_blocco: 'Olive Union', codici_nazioni: 'IT,HR,HU,GR,TR,IQ,EG,LT', colore: COLORS.ITALIAN_BLOC, label_lng: '30', label_lat: '40' },
  { nome_blocco: 'test', codici_nazioni: 'FR,NL,BE,AR,CL,US', colore: COLORS.WESTERN_BLOC, label_lng: '-70', label_lat: '30' },
  { nome_blocco: 'African Union', codici_nazioni: 'AO,DZ,BJ,BW,BF,BI,CM,CV,CF,KM,CD,DJ,EG,GQ,ET,GA,GM,GH,GN,GW,CI,KE,LS,LR,LY,MW,MR,MU,MA,MZ,NA,NE,NG,RW,ST,SN,SC,SL,SS,SD,SZ,TZ,TG,TN,UG,ZM,ZW', colore: COLORS.AFRICAN_UNION, label_lng: '-10', label_lat: '-20' },
  { nome_blocco: 'Asian Federation', codici_nazioni: 'BT,BN,CN,TL,EG,FJ,IN,IQ,PS,PG,PH,TR,KP,VN,VU', colore: COLORS.ASIAN_FEDERATION, label_lng: '90', label_lat: '-15' },
  { nome_blocco: 'ICDP', codici_nazioni: 'RO,DE,UA,RS', colore: COLORS.ICDP, label_lng: '20', label_lat: '52' },
  { nome_blocco: 'Holy League', codici_nazioni: 'CH,VA,JO,LB,ML,CY', colore: COLORS.HOLY_LEAGUE, label_lng: '35', label_lat: '35' },
];
*/