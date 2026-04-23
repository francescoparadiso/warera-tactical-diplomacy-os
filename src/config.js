export const COLORS = {
  SELECTED:          '#ffcc00',
  WAR_DIRECT:        '#ff0000',
  WAR_INDIRECT:      '#b30000',
  ALLY_DIRECT:       '#2ecc71',
  ALLY_INDIRECT:     '#145a32',
  BORDERLINE:        '#ff9100',
  NAP:               '#00d4ff',
  DEFAULT_LAND:      '#4a4e5a',
  NEUTRAL_UNSELECTED:'#3a3d46',
  OCEAN:             '#000000',
  ITALIAN_BLOC:      '#1b557a',
  WESTERN_BLOC:      '#55a5d9',
  AFRICAN_UNION:     '#e67e22',
  ASIAN_FEDERATION:  '#8e44ad',
  ICDP:              '#c0392b',
  HOLY_LEAGUE:       '#FFD700',
};

export const LAYER_IDS = {
  SRC_REGIONS: 'regions-src',
  SRC_BORDERS: 'borders-src',
  SRC_LABELS:  'labels-src',
  LYR_FILL:    'regions-fill',
  LYR_OUTLINE: 'regions-outline',
  LYR_COAST:   'regions-coast',
  LYR_BORDER:  'borders-line',
  LYR_MULTI_BLOC: 'multi-bloc-pattern',
};

export const EXTERNAL_BLOCS_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/AllianceBlocs.csv';

export const EXTERNAL_NAPS_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/warera_naps.csv';

export const HARDCODED_BLOCS = [
  { nome_blocco: 'Olive Union',      codici_nazioni: 'IT,HR,HU,GR,TR,IQ,EG,LT',                                                                                              colore: COLORS.ITALIAN_BLOC,    label_lng: '30',  label_lat: '40'  },
  { nome_blocco: 'test',             codici_nazioni: 'FR,NL,BE,AR,CL,US',                                                                                                      colore: COLORS.WESTERN_BLOC,    label_lng: '-70', label_lat: '30'  },
  { nome_blocco: 'African Union',    codici_nazioni: 'AO,DZ,BJ,BW,BF,BI,CM,CV,CF,KM,CD,DJ,EG,GQ,ET,GA,GM,GH,GN,GW,CI,KE,LS,LR,LY,MW,MR,MU,MA,MZ,NA,NE,NG,RW,ST,SN,SC,SL,SS,SD,SZ,TZ,TG,TN,UG,ZM,ZW', colore: COLORS.AFRICAN_UNION, label_lng: '-10', label_lat: '-20' },
  { nome_blocco: 'Asian Federation', codici_nazioni: 'BT,BN,CN,TL,EG,FJ,IN,IQ,PS,PG,PH,TR,KP,VN,VU',                                                                         colore: COLORS.ASIAN_FEDERATION,label_lng: '90',  label_lat: '-15' },
  { nome_blocco: 'ICDP',             codici_nazioni: 'RO,DE,UA,RS',                                                                                                            colore: COLORS.ICDP,            label_lng: '20',  label_lat: '52'  },
  { nome_blocco: 'Holy League',      codici_nazioni: 'CH,VA,JO,LB,ML,CY',                                                                                                      colore: COLORS.HOLY_LEAGUE,     label_lng: '35',  label_lat: '35'  },
];
