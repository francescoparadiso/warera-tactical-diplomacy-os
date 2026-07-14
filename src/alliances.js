import { state } from './state.js';
import { renderMap } from './map.js';
import { updateDynamicLegend } from './ui.js';
import { buildMultiBlocPatternExpression } from './patterns.js';
// Genera un colore in base al nome e allo scheme (come prima)
import { hashColor } from './utils.js';   // aggiungi in cima


const SCHEME_COLORS = {
  violet: '#8b5cf6',
  pink: '#ec4899',
  amber: '#ffbf00',
  red: '#d60606',
  green: '#0d652d',
  lightblue: '#007cb1',
  // aggiungi altri scheme man mano che compaiono
};

// Converte RGB in HSL
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

// Shifta il hue di un colore (esadecimale o nome CSS)
function shiftColor(colorHexOrName, amount) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = colorHexOrName;
  const hex = ctx.fillStyle; // normalizza a #rrggbb
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let [h, s, l] = rgbToHsl(r, g, b);
  h = (h + amount) % 360;
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

function getBaseAllianceColor(ally) {
  const scheme = ally.scheme?.toLowerCase();
  if (scheme && SCHEME_COLORS[scheme]) {
    return SCHEME_COLORS[scheme];
  }
  // fallback: hash dell'ID (non dovrebbe servire)
  let hash = 0;
  for (let i = 0; i < ally._id.length; i++) hash = ((hash << 5) - hash) + ally._id.charCodeAt(i);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

// ==================== MEDIANA GEOMETRICA (robusta agli outlier) ====================
// A differenza della media aritmetica, questo punto minimizza la somma delle
// distanze da tutti i membri: resta vicino al cluster più numeroso anche se
// ci sono nazioni isolate molto lontane (es. 10 in Europa + 2 in Sudamerica).
function geometricMedian(points, iterations = 60) {
  if (!points.length) return null;
  if (points.length === 1) return points[0];

  let x = points.reduce((s, p) => s + p[0], 0) / points.length;
  let y = points.reduce((s, p) => s + p[1], 0) / points.length;

  for (let iter = 0; iter < iterations; iter++) {
    let numX = 0, numY = 0, denom = 0;
    for (const [px, py] of points) {
      const d = Math.hypot(px - x, py - y) || 1e-6;
      numX += px / d;
      numY += py / d;
      denom += 1 / d;
    }
    if (denom === 0) break;
    const nx = numX / denom, ny = numY / denom;
    if (Math.abs(nx - x) < 1e-6 && Math.abs(ny - y) < 1e-6) { x = nx; y = ny; break; }
    x = nx; y = ny;
  }
  return [x, y];
}

// Questa è la funzione chiamata da refreshData
export function processAlliancesData(alliances) {
  // Se non ci sono alleanze, pulisci tutto
  if (!alliances.length) {
    state.externalBlocsInfo = [];
    state.blocColorMap.clear();
    state.multiBlocMap.clear();
    updateDynamicLegend();
    if (state.coloringMode === 'blocs') renderMap();
    return;
  }

  // 1. Mappa allianceId -> colore
  state.allianceColorMap.clear();
const usedColors = new Set();
for (const ally of alliances) {
  let baseColor = getBaseAllianceColor(ally);
  let color = baseColor;
  let shift = 30;
  while (usedColors.has(color)) {
    color = shiftColor(baseColor, shift);
    shift += 30;
  }
  usedColors.add(color);
  state.allianceColorMap.set(ally._id, color);
}

  // 2. Costruisci nationAlliancesMap (paese -> Set di allianceId)
  state.nationAlliancesMap.clear();
  for (const ally of alliances) {
    for (const member of ally.memberCountries) {
      const countryId = member.country;
      if (!countryId) continue;
      if (!state.nationAlliancesMap.has(countryId))
        state.nationAlliancesMap.set(countryId, new Set());
      state.nationAlliancesMap.get(countryId).add(ally._id);
    }
  }

  // 3. Crea externalBlocsInfo per la legenda
  // La posizione della label usa la mediana geometrica dei membri (non la
  // media aritmetica), così resta vicina al cluster più numeroso anche in
  // presenza di membri isolati molto lontani (es. Europa + outlier in Africa).
  state.externalBlocsInfo = alliances.map(ally => {
    const memberIds = ally.memberCountries.map(m => m.country);
    const coords = memberIds
      .map(id => state.labelsData.find(l => l.properties.countryId === id)?.coordinates)
      .filter(Boolean);

    const median = coords.length ? geometricMedian(coords) : null;

    return {
      id: ally._id,
      name: ally.name,
      color: state.allianceColorMap.get(ally._id),
      labelLng: median ? median[0] : null,
      labelLat: median ? median[1] : null,
      memberCount: memberIds.length, // usato per la priorità nel posizionamento label
    };
  });

  // 4. Costruisci blocColorMap (colore singolo) e multiBlocMap (pattern)
  state.blocColorMap.clear();
  state.multiBlocMap.clear();
  for (const [countryId, allianceSet] of state.nationAlliancesMap.entries()) {
    if (allianceSet.size === 1) {
      const singleAllianceId = [...allianceSet][0];
      const color = state.allianceColorMap.get(singleAllianceId);
      state.blocColorMap.set(countryId, color);
    } else if (allianceSet.size > 1) {
      const colors = [...allianceSet].map(aid => state.allianceColorMap.get(aid));
      state.multiBlocMap.set(countryId, { colors });
    }
  }

  // 5. Precarica pattern per nazioni in più alleanze
  buildMultiBlocPatternExpression();

  // 6. Aggiorna UI e mappa
  updateDynamicLegend();
  if (state.coloringMode === 'blocs') renderMap();
}