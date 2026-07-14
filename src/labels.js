import { state } from './state.js';
import { COLORS } from './config.js';
import { flattenCoords } from './utils.js';

// ==================== FLAG CACHE ====================
export function loadFlagImage(code) {
  if (!code || state.flagImageCache.has(code)) return;
  state.flagImageCache.set(code, null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { state.flagImageCache.set(code, img); if (state.map) state.map.triggerRepaint(); };
  img.onerror = () => state.flagImageCache.set(code, null);
  img.src = `https://app.warera.io/images/map/${code}.png?v=21`;
}

export function preloadAllFlags() {
  state.labelsData.forEach(l => { const c = l.properties?.countryCode?.toLowerCase(); if (c) loadFlagImage(c); });
}

// ==================== CANVAS SETUP ====================
export function initLabelCanvas() {
  state.labelCanvas = document.createElement('canvas');
  state.labelCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:500;';
  state.map.getContainer().appendChild(state.labelCanvas);
  state.labelCtx = state.labelCanvas.getContext('2d');
  resizeLabelCanvas();
  state.map.on('render', drawLabels);
  window.addEventListener('resize', resizeLabelCanvas);
}

export function resizeLabelCanvas() {
  if (!state.labelCanvas) return;
  const container = state.map.getContainer();
  const r = window.devicePixelRatio || 1;
  state.labelCanvas.width = container.clientWidth * r;
  state.labelCanvas.height = container.clientHeight * r;
  state.labelCanvas.style.width = container.clientWidth + 'px';
  state.labelCanvas.style.height = container.clientHeight + 'px';
  state.labelCtx.scale(r, r);
}

// ==================== DISEGNO LABEL ====================
export function drawLabels() {
  if (!state.labelCanvas || !state.labelCtx || !state.labelsData.length) return;
  const showNations = document.getElementById('checkLabels').checked;
  const r = window.devicePixelRatio || 1;
  const W = state.labelCanvas.width / r;
  const H = state.labelCanvas.height / r;
  const ctx = state.labelCtx;

  ctx.save();
  ctx.setTransform(r, 0, 0, r, 0, 0);
  ctx.clearRect(0, 0, W, H);

  let blocBBoxes = [];
  
  // DISEGNA I NOMI DEI BLOCCHI SEMPRE IN MODALITÀ BLOCS
  if (state.coloringMode === 'blocs') {
    blocBBoxes = _drawBlocLabels(ctx, W, H);
  }
  
  if (!showNations) { ctx.restore(); return; }

  const zoom = state.map.getZoom();
  const sourceLabels = state.mapSource === 'original' ? state.originalLabelsData : state.labelsData;
  const sorted = [...sourceLabels].sort((a, b) => (b.properties.flagSize || 0) - (a.properties.flagSize || 0));
  const drawnBoxes = [];

  function intersects(b1, b2) {
    return !(b2.xMin > b1.xMax || b2.xMax < b1.xMin || b2.yMin > b1.yMax || b2.yMax < b1.yMin);
  }

  sorted.forEach(label => {
    const props = label.properties;
    const coords = label.coordinates;
    if (!coords) return;
    if (state.coloringMode === 'blocs' && zoom < 3.3) return;
    if (zoom < 2.5 && props.flagSize < 0.15) return;
    if (zoom < 3.5 && props.flagSize < 0.08) return;

    const pt = state.map.project([coords[0], coords[1]]);
    if (pt.x < -100 || pt.x > W + 100 || pt.y < -60 || pt.y > H + 60) return;

    const nameStr = props.countryName?.toUpperCase() || '';
    const baseSize = props.textSize || 10;
    const scale = zoom < 2.5 ? 1.4 : zoom < 3 ? 1.3 : zoom < 4 ? 1.2 : zoom < 5 ? 1.0 : 0.9;
    const fontSize = Math.round(baseSize * scale);

    ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
    const textWidth = ctx.measureText(nameStr).width;
    const nationBox = { xMin: pt.x - textWidth / 2 - 1, xMax: pt.x + textWidth / 2 + 1, yMin: pt.y - fontSize / 2 - 1, yMax: pt.y + fontSize / 2 + 1 };

    if (state.coloringMode === 'blocs' && blocBBoxes.some(b => intersects(nationBox, b))) return;
    if (drawnBoxes.some(b => intersects(nationBox, b))) return;
    drawnBoxes.push(nationBox);

    const code = (props.countryCode || '').toLowerCase();
    const fScale = zoom < 3 ? 1.5 : zoom < 4 ? 1.3 : zoom < 5 ? 1.1 : 1.0;
    const flagW = Math.round(16 * fScale);
    const flagH = Math.round(11 * fScale);
    const cachedFlag = state.flagImageCache.get(code);
    const totalH = (cachedFlag ? flagH + 2 : 0) + fontSize;
    const startY = pt.y - totalH / 2;
    if (cachedFlag) ctx.drawImage(cachedFlag, pt.x - flagW / 2, startY, flagW, flagH);

    const cId = props.countryId;
    let textColor;
    if (state.coloringMode === 'blocs') textColor = state.blocColorMap.get(cId) || '#cccccc';
    else textColor = state.selectedCountryId ? '#ffffff' : (props.textColor || '#cccccc');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const textY = startY + (cachedFlag ? flagH + 2 : 0);
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(nameStr, pt.x, textY);
    ctx.shadowBlur = 0;
    ctx.fillStyle = textColor;
    ctx.fillText(nameStr, pt.x, textY);
    // ==================== BATTLE HEATMAP PERCENTUALE (sopra il nome) ====================
    if (state.coloringMode === 'battleHeatmap' && state.battleHeatmapData) {
      const data = state.battleHeatmapData;
      const nationData = data.nations.find(n => n.countryId === cId);
      if (nationData) {
        // Calcola il totale dei danni per questo lato
        const sameSide = data.nations.filter(n => n.side === nationData.side);
        const totalInSide = sameSide.reduce((sum, n) => sum + n.totalDamage, 0);
        const pct = totalInSide > 0 ? (nationData.totalDamage / totalInSide * 100) : 0;
        const pctFormatted = pct.toFixed(0);

        const pctFontSize = 11;
        ctx.font = `bold ${pctFontSize}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        const pctY = textY - 4;
        ctx.strokeText(`${pctFormatted}%`, pt.x, pctY);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${pctFormatted}%`, pt.x, pctY);
      }
    }
  });

  // === ETICHETTE AGGIUNTIVE: Popolazione o Danni ===
  if (state.coloringMode === 'population' || state.coloringMode === 'weeklyDamage') {
    const isPopulation = state.coloringMode === 'population';
    const sourceLabels = state.mapSource === 'original' ? state.originalLabelsData : state.labelsData;
    const zoom = state.map.getZoom();

    let minDmg = Infinity, maxDmg = -Infinity;
    if (!isPopulation) {
      for (const nation of state.nationMap.values()) {
        const dmg = nation?.rankings?.weeklyCountryDamages?.value;
        if (typeof dmg === 'number' && dmg >= 0) {
          if (dmg < minDmg) minDmg = dmg;
          if (dmg > maxDmg) maxDmg = dmg;
        }
      }
    }

    ctx.font = `bold 12px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;

    sourceLabels.forEach(label => {
      const coords = label.coordinates;
      if (!coords) return;

      const pt = state.map.project([coords[0], coords[1]]);
      if (pt.x < -100 || pt.x > W + 100 || pt.y < -60 || pt.y > H + 60) return;

      const cId = label.properties.countryId;
      const nation = state.nationMap.get(cId);
      if (!nation) return;

      let text = '';
      let color = '#ffffff';

      if (isPopulation) {
        const pop = nation?.rankings?.countryActivePopulation?.value;
        if (typeof pop === 'number' && pop > 0) {
          text = pop >= 1_000_000 ? (pop / 1_000_000).toFixed(1) + 'M' : pop.toLocaleString();
        }
      } else {
        const dmg = nation?.rankings?.weeklyCountryDamages?.value;
        if (typeof dmg === 'number' && dmg >= 0) {
          text = dmg >= 1e6 ? (dmg / 1e6).toFixed(1) + 'M' :
            dmg >= 1e3 ? (dmg / 1e3).toFixed(1) + 'K' :
            String(dmg);
          const t = (maxDmg > minDmg) ? (dmg - minDmg) / (maxDmg - minDmg) : 0;
          const r = Math.round(69 + (215 - 69) * t);
          const g = Math.round(117 + (48 - 117) * t);
          const b = Math.round(180 + (39 - 180) * t);
          color = `rgb(${r},${g},${b})`;
        }
      }

      if (text) {
        const textY = pt.y + 16;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(text, pt.x, textY);
        ctx.fillStyle = color;
        ctx.fillText(text, pt.x, textY);
      }
    });

    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ==================== LABEL DEI BLOCCHI (con collision-avoidance) ====================
// I blocchi con più membri vengono disegnati per primi nella loro posizione
// ideale (calcolata via mediana geometrica in alliances.js). I blocchi più
// piccoli, se la loro label si sovrappone a una già piazzata, vengono
// spostati verticalmente in step crescenti; se non si trova alcuna
// posizione libera, la label viene saltata piuttosto che disegnata
// sovrapposta e illeggibile.
function _drawBlocLabels(ctx, W, H) {
  const bboxes = [];
  if (!state.externalBlocsInfo.length) return bboxes;
  const zoom = state.map.getZoom();
  const fontSize = Math.max(28, Math.min(56, 32 * (1 + (zoom - 2) * 0.2)));
  ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  const MARGIN = 30;

  function intersects(a, b) {
    return !(b.xMin > a.xMax || b.xMax < a.xMin || b.yMin > a.yMax || b.yMax < a.yMin);
  }

  function makeBox(x, y, w) {
    return { xMin: x - w / 2 - MARGIN, xMax: x + w / 2 + MARGIN, yMin: y - fontSize / 2 - MARGIN, yMax: y + fontSize / 2 + MARGIN };
  }

  // Priorità ai blocchi con più membri: quelli piccoli, in caso di conflitto,
  // sono quelli che vengono spostati o eventualmente saltati.
  const sortedBlocs = [...state.externalBlocsInfo].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));

  // Offset verticali da provare in caso di sovrapposizione, in ordine crescente
  const OFFSETS = [0, fontSize * 1.3, -fontSize * 1.3, fontSize * 2.6, -fontSize * 2.6, fontSize * 3.9, -fontSize * 3.9];

  for (const bloc of sortedBlocs) {
    if (bloc.labelLng === null || bloc.labelLat === null) continue;
    const basePt = state.map.project([bloc.labelLng, bloc.labelLat]);
    if (basePt.x < -100 || basePt.x > W + 100 || basePt.y < -60 || basePt.y > H + 60) continue;

    const metrics = ctx.measureText(bloc.name);
    const textWidth = metrics.width;

    let placed = false;
    let finalPt = basePt;
    let finalBox = null;

    for (const dy of OFFSETS) {
      const candidatePt = { x: basePt.x, y: basePt.y + dy };
      const candidateBox = makeBox(candidatePt.x, candidatePt.y, textWidth);
      if (bboxes.some(b => intersects(candidateBox, b))) continue;
      finalPt = candidatePt;
      finalBox = candidateBox;
      placed = true;
      break;
    }

    // Se nessuna posizione è libera, salta il disegno di questa label
    // (evita comunque di sovrapporsi illeggibilmente ad un'altra)
    if (!placed) continue;

    bboxes.push(finalBox);

    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(bloc.name, finalPt.x, finalPt.y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = bloc.color;
    ctx.fillText(bloc.name, finalPt.x, finalPt.y);
  }
  return bboxes;
}

// ==================== ORIGINAL LABELS ====================
export function buildOriginalLabels() {
  if (!state.baseGeoJSON || !state.labelsData.length) return;

  const regionIndex = [];
  state.baseGeoJSON.features.forEach(f => {
    const initId = f.properties?.initialCountryId;
    if (!initId) return;
    const coords = flattenCoords(f.geometry);
    if (!coords.length) return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    coords.forEach(c => { minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]); minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]); });
    regionIndex.push({ initId, minLng, maxLng, minLat, maxLat, geometry: f.geometry, numCoords: coords.length });
  });

  function pointInPolygon(point, polygon) {
    const x = point[0],
      y = point[1];
    let inside = false;

    function processRing(ring) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0],
          yi = ring[i][1],
          xj = ring[j][0],
          yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
    }
    if (polygon.type === 'Polygon') processRing(polygon.coordinates[0]);
    else if (polygon.type === 'MultiPolygon') polygon.coordinates.forEach(poly => processRing(poly[0]));
    return inside;
  }

  const capitalMap = new Map();
  state.labelsData.forEach(label => {
    const coords = label.coordinates;
    if (!coords) return;
    for (const region of regionIndex) {
      if (coords[0] >= region.minLng && coords[0] <= region.maxLng && coords[1] >= region.minLat && coords[1] <= region.maxLat) {
        if (pointInPolygon(coords, region.geometry)) {
          const flagSize = label.properties.flagSize || 0;
          const existing = capitalMap.get(region.initId);
          if (!existing || flagSize > (existing.flagSize || 0)) capitalMap.set(region.initId, { coordinates: coords, flagSize, label });
          break;
        }
      }
    }
  });

  const centroidMap = new Map();
  regionIndex.forEach(region => {
    if (capitalMap.has(region.initId)) return;
    const best = centroidMap.get(region.initId);
    if (!best || region.numCoords > best.numCoords) {
      const coords = flattenCoords(region.geometry);
      let sumLng = 0,
        sumLat = 0;
      coords.forEach(c => { sumLng += c[0];
        sumLat += c[1]; });
      centroidMap.set(region.initId, { center: [sumLng / coords.length, sumLat / coords.length], numCoords: region.numCoords });
    }
  });

  state.originalLabelsData = [];
  capitalMap.forEach((data, initId) => {
    const nation = state.nationMap.get(initId);
    const lbl = data.label;
    state.originalLabelsData.push({
      coordinates: data.coordinates,
      properties: {
        countryId: initId,
        countryName: nation ? nation.name : lbl.properties.countryName,
        countryCode: (nation ? nation.code : lbl.properties.countryCode || '').toLowerCase(),
        flagSize: lbl.properties.flagSize,
        textSize: lbl.properties.textSize,
        textColor: lbl.properties.textColor,
        strokeColor: state.nationBaseColorMap.get(initId) || COLORS.DEFAULT_LAND,
      },
    });
  });
  centroidMap.forEach((data, initId) => {
    const nation = state.nationMap.get(initId);
    if (!nation) return;
    state.originalLabelsData.push({
      coordinates: data.center,
      properties: {
        countryId: initId,
        countryName: nation.name,
        countryCode: (nation.code || '').toLowerCase(),
        flagSize: 0.2,
        textSize: 10,
        textColor: '#cccccc',
        strokeColor: state.nationBaseColorMap.get(initId) || COLORS.DEFAULT_LAND,
      },
    });
  });
}