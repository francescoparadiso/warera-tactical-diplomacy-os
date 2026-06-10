// Stato globale centralizzato dell'applicazione
export const state = {
  map: null,
  nazioniGlobal: [],
  mapDataGlobal: null,
  selectedCountryId: null,
  customNaps: [],
  nationBaseColorMap: new Map(),
  externalBlocsInfo: [],
  externalNapsList: [],
  externalNapsSet: new Set(),
  nationMap: new Map(),
  multiBlocMap: new Map(),
  blocColorMap: new Map(),
  baseGeoJSON: null,
  originalLabelsData: [],
  labelsData: [],
  mapSource: 'actual',       // 'actual' | 'original'
  coloringMode: 'diplomacy', // 'diplomacy' | 'blocs' | 'population' | 'weeklyDamage'
  patternImageCache: new Map(),
  flagImageCache: new Map(),
  labelCanvas: null,
  theme: 'dark',
  labelCtx: null,
  alliancesList: [],           // array completo delle alleanze ricevute dall'API
  allianceColorMap: new Map(), // allianceId -> colore assegnato
  nationAlliancesMap: new Map(), // countryId -> Set di allianceId
};
