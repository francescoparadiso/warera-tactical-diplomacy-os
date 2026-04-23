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
  coloringMode: 'diplomacy', // 'diplomacy' | 'blocs'
  patternImageCache: new Map(),
  flagImageCache: new Map(),
  labelCanvas: null,
  labelCtx: null,
};
