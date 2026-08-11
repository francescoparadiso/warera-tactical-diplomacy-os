// battleWall3D.js
// Overlay 3D "battle wall" — vista alternativa alla heatmap 2D. Si apre SOPRA
// la mappa tramite un pulsante dedicato nel tooltip battaglia (non sostituisce
// setBattleHeatmap, che resta la vista "chi ha fatto i danni").
//
// Dati reali: fetchBattleWallData()/fetchBattleWallPoll() in battleHeatmap.js
// (ranking + battle.getLiveBattleData sempre nello stesso POST batch, vedi
// warera-api-batching.md), aggiornati ogni secondo (POLL_MS).

import { state } from './state.js';
import { fetchBattleWallData, fetchBattleWallPoll } from './battleHeatmap.js';
import { hashColor } from './utils.js';
import { escapeHtml } from './utils.js';

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
// Stessa versione di Three usata sopra: OrbitControls dev'essere allineato,
// altrimenti importa un core Three duplicato e i controlli non agiscono sulla
// camera della scena.
const ORBIT_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/controls/OrbitControls.js';
// Intervallo base del polling. 1000ms faceva scattare il rate limit (429)
// quasi subito; 10000ms era stabile ma reattivo come un orologio fermo.
// 3500ms e' il compromesso, protetto dal backoff qui sotto: ad ogni poll
// fallito l'attesa raddoppia (fino a POLL_MAX_MS) e torna alla base al primo
// successo, cosi' un 429 occasionale non degenera in una raffica di retry.
const POLL_MS = 1500;
const POLL_MAX_MS = 20000;
// Oltre questo numero di poll falliti consecutivi si mostra "Connessione persa".
const POLL_FAIL_LIMIT = 4;
const MAX_NATIONS_PER_SIDE = 3;
// Rilevata una sola volta al caricamento del modulo: su schermi stretti
// dimezza truppe/alberi/pool degli effetti e riduce pixelRatio e area di
// render (vedi buildScene/ensureOverlay), perche' e' li' che si concentra
// il costo GPU su hardware mobile.
const IS_MOBILE = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) <= 760;
// Il campo e' un nastro largo e poco profondo visto quasi dall'alto: le truppe
// sono minuscole e si addensano sul fronte, come in una vera linea di battaglia.
// Era 140 (originariamente 280): ulteriore taglio per portare davvero giu'
// il carico CPU come richiesto — meno istanze = meno matrici da comporre e
// ricaricare in GPU ad ogni frame. Su mobile ulteriormente dimezzato.
// Questo e' ora il valore BASE (budgetScale=1): il numero effettivo di
// truppe segue i dati reali della battaglia, vedi BUDGET DINAMICO piu' sotto.
const TROOPS_PER_SIDE = IS_MOBILE ? 34 : 70;

// ==================== BUDGET DINAMICO ====================
// Il "peso" della scena (truppe, tracer, shell, esplosioni, vampe) non segue
// piu' solo mobile/desktop: segue i dati reali della battaglia — danno totale
// (totalDef+totalAtk) e numero di nazioni coinvolte. Battaglie piccole restano
// leggere (tetto minimo, che coincide col vecchio comportamento "silenzioso"),
// battaglie enormi ricevono un bonus contenuto, sempre dentro un tetto
// assoluto (BUDGET_MAX) cosi' anche lo scontro piu' grande della piattaforma
// non puo' far esplodere il costo GPU/CPU. mobile/desktop restano il punto di
// partenza (BUDGET_MIN/BUDGET_MAX sono piu' bassi su mobile), ma ora dentro
// quella fascia si muove in base a quanto la battaglia e' davvero grande.
const BUDGET_MIN = IS_MOBILE ? 0.55 : 0.72;
const BUDGET_MAX = IS_MOBILE ? 0.95 : 1.3;
// Riferimento in "danno totale" oltre il quale una battaglia e' gia' enorme
// per gli standard del gioco: usato solo per normalizzare la curva log qui
// sotto, non e' un tetto rigido.
const BUDGET_DAMAGE_REF = 2_000_000;
// Oltre questa soglia di nazioni-per-lato coinvolte il fattore "nazioni" e'
// gia' a saturazione: da 2 (normale) a 6 nazioni sullo stesso lato.
const BUDGET_NATIONS_REF = 6;
let budgetScale = BUDGET_MIN; // aggiornato ad ogni poll da computeBudgetScale()
// Derating aggiuntivo deciso in runtime dall'adaptive quality (vedi
// APPLICAZIONE ADAPTIVE QUALITY in renderLoop): 1 = nessun taglio extra, scende
// se il frame time medio resta alto per qualche secondo. Si applica SOPRA
// budgetScale, mai al posto suo: i dati reali restano il primo fattore.
let qualityDerate = 1;

// share 0..1 in scala log (le battaglie "grandi" crescono in fretta all'inizio
// e appiattiscono verso il tetto, non linearmente) + un fattore "quante
// nazioni" (le battaglie multi-nazione sono quelle piu' costose oggi, quindi
// contano anche da sole, non solo il danno totale).
function computeBudgetScale(totalDamage, nationCount) {
  const dmgFactor = Math.log10(1 + Math.max(0, totalDamage) / 1e4) / Math.log10(1 + BUDGET_DAMAGE_REF / 1e4);
  const nationFactor = Math.max(0, nationCount - 2) / (BUDGET_NATIONS_REF - 2);
  const t = Math.max(0, Math.min(1, Math.max(dmgFactor, nationFactor * 0.75)));
  return BUDGET_MIN + (BUDGET_MAX - BUDGET_MIN) * t;
}

// Capacita' ASSOLUTA (tetto massimo) del pool condiviso di fanteria per lato
// (vedi "InstancedMesh unico per lato" piu' sotto): dimensionata sul caso
// peggiore, budgetScale = BUDGET_MAX. E' un array allocato una volta sola:
// aumentarlo non ha lo stesso costo di crearne uno nuovo a runtime, quindi si
// alloca subito al tetto e poi si usa solo `.count` per renderizzare meno
// istanze nelle battaglie piu' piccole (vedi applySide/applyQualityTier).
// Include anche il caso limite di computeUnitMix (ogni nazione ha un minimo
// di 40 fanti indipendente dal budget, per non farla sparire): con
// MAX_NATIONS_PER_SIDE nazioni al minimo assoluto e' il vero worst-case da
// coprire, non solo TROOPS_PER_SIDE*BUDGET_MAX.
const TROOPS_PER_SIDE_ABS_MAX = Math.max(
  Math.ceil(TROOPS_PER_SIDE * BUDGET_MAX) + 8,
  MAX_NATIONS_PER_SIDE * 44,
);
const MAP_W = 96, MAP_D = 26;
// LOD legato allo zoom: sotto questa distanza dalla camera (camera.position.distanceTo(controls.target))
// si attiva l'animazione fine (bob/lean/sway/pitch); a inquadratura piu' larga
// quei dettagli sono comunque pochi pixel e vengono saltati (vedi lodFineDetail
// in renderLoop, letto da layoutSoldierGroup/layoutVehicles).
const LOD_NEAR_DIST = MAP_W * 0.5;
const HALF_RANGE = MAP_W / 2 - 8;
const REAR_DEFENDER = -MAP_W / 2 + 3;
const REAR_ATTACKER = MAP_W / 2 - 3;
// Colori territorio (il terreno stesso e' tinto per fazione, non con overlay)
const TERR_DEF = 0x3f6b2c;   // territorio difensore (verde)
const TERR_ATK = 0x7d2f26;   // territorio attaccante (rosso)
// Colori di schieramento: le truppe usano QUESTI, non il colore nazione.
// Con i colori nazione (gialli/blu/ciano mischiati) il fronte sembrava
// coriandoli e non si capiva chi stesse combattendo chi.
const SIDE_DEF = 0x5fd36a;   // verde brillante
const SIDE_ATK = 0xe8483f;   // rosso brillante

let THREE = null;
let overlayEl, canvasHost, closeBtn, hudDefVal, hudAtkVal, hudDefFlags, hudAtkFlags, hudMomentum, hudMomentumCard, liveDot;
let hudMom = {}, hudStatus = {};
let hudTitle, hudSplitBar, hudSplitDefPct, hudSplitAtkPct, hudUpdatedAt, hudDefRate, hudAtkRate, hudParticipants;
let minimapCanvas, minimapCtx, minimapTooltip, minimapSegments = [];
let renderer, scene, camera, wallGroup, wallCore, wallGlow;
let centerLineMesh = null;
let arrowDef = null, arrowAtk = null;
let wallSegCount = 0, _dWall = null;
let defenderGroups = [], attackerGroups = [];
// InstancedMesh UNICO di fanteria per lato, condiviso da tutte le nazioni di
// quel lato (vedi buildSharedBodyPools/applySide): sostituisce un mesh per
// nazione con un solo draw call per lato, indipendentemente da quante nazioni
// sono coinvolte. Il colore per-nazione viene applicato per-istanza con
// instanceColor invece che con un materiale dedicato per mesh.
let bodyMeshDef = null, bodyMeshAtk = null;
let flagBillboards = [];
let rafId = null, pollTimer = null, resizeHandler = null;
let pageHidden = false;
let wallX = 0, wallTargetX = 0;
let lodFineDetail = true; // ricalcolato una volta per frame in renderLoop dalla distanza camera-target
let dispDef = 0, dispAtk = 0, targetDef = 0, targetAtk = 0;
let currentBattleId = null;
let sceneReady = false;
let generatedTextures = [];   // texture create proceduralmente, da dispose alla chiusura
// Un AbortController per sessione: alla chiusura annulla in un colpo solo sia
// le fetch pendenti sia tutti i listener registrati con { signal }.
let sessionAbort = null;

function getSignal() {
  if (!sessionAbort) sessionAbort = new AbortController();
  return sessionAbort.signal;
}
let lastPollTime = 0, prevTotalDef = null, prevTotalAtk = null, lastUpdateTs = 0;
let lastGoodNations = null; // cache anti-flicker: un poll fallito/vuoto (429, rete) non deve azzerare la vista
let pollFailCount = 0;
let roundEnded = false; // round.isActive === false in battle.getLiveBattleData

function getNation(countryId) {
  return state.nationMap.get(countryId) || null;
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

// I colori base delle nazioni sono scuri (pensati per la mappa 2D): su questo
// campo, con soldati di pochi pixel, risultavano indistinguibili. Qui vengono
// schiariti e saturati per ottenere masse ben leggibili.
function vividFrom(cssColor) {
  const c = new THREE.Color(cssColor);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.7 + 0.3), Math.min(0.62, Math.max(0.42, hsl.l * 1.8)));
  return c.getHex();
}

function nationColorHex(countryId) {
  const c = state.nationBaseColorMap.get(countryId) || hashColor(countryId);
  return vividFrom(c);
}

// Colore truppe: parte dal colore dello schieramento e applica una piccola
// variazione derivata dall'id nazione (tinta +/-14 gradi, luminosita' +/-0.09).
// Cosi' il lato si legge a colpo d'occhio ma le nazioni restano distinguibili.
function sideUnitColor(side, countryId, idx) {
  const base = new THREE.Color(side === 'defender' ? SIDE_DEF : SIDE_ATK);
  const hsl = {};
  base.getHSL(hsl);
  let h = 0;
  const str = String(countryId || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  const hueShift = ((h % 100) / 100 - 0.5) * 0.078;      // ~ +/-14 gradi
  const lumShift = (idx % 3 - 1) * 0.09;
  base.setHSL(
    (hsl.h + hueShift + 1) % 1,
    Math.min(1, hsl.s * 0.95),
    Math.max(0.3, Math.min(0.72, hsl.l + lumShift))
  );
  return base.getHex();
}

function nationColorCss(countryId) {
  return state.nationBaseColorMap.get(countryId) || hashColor(countryId);
}

// ==================== OVERLAY DOM ====================
function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'battle-wall-3d-overlay';
  overlayEl.style.cssText = `
    position: fixed; inset: 0; z-index: 20000;
    background: #080b10;
    display: none;
    font-family: 'Sora', -apple-system, sans-serif;
  `;

  canvasHost = document.createElement('div');
  canvasHost.id = 'bw3d-canvasHost';
  canvasHost.style.cssText = 'position:absolute; inset:0;';
  overlayEl.appendChild(canvasHost);

  // ── Layout responsive ──
  // Il resto dell'HUD e' costruito con inline style pensati per desktop
  // (centerCol usava calc(100vw - 560px), che sotto ~950px di viewport
  // diventa negativo e fa collassare tutto il blocco centrale; defPanel/
  // atkPanel sono larghi 240px fissi e su schermi stretti si sovrappongono
  // a vicenda e al centro). Le regole qui sotto, con !important, sovrascrivono
  // quegli inline style sotto i 760px senza toccare il layout desktop.
  const responsiveStyle = document.createElement('style');
  responsiveStyle.textContent = `
    @media (max-width: 760px) {
      /* La mappa 3D vive in un riquadro contenuto, non piu' a schermo
         intero: getCanvasSize() legge le dimensioni reali di questo box e
         il renderer viene dimensionato di conseguenza, quindi e' anche una
         grossa ottimizzazione (meno pixel da riempire), non solo estetica. */
      #bw3d-canvasHost {
        inset: auto !important;
        top: 150px !important;
        bottom: 172px !important;
        left: 10px !important;
        right: 10px !important;
        border-radius: 16px !important;
        overflow: hidden !important;
        border: 1px solid rgba(255,255,255,0.14) !important;
        box-shadow: 0 10px 30px rgba(0,0,0,.5) !important;
      }
      #bw3d-centerCol {
        top: 8px !important;
        width: min(470px, calc(100vw - 90px)) !important;
        gap: 4px !important;
      }
      #bw3d-title #bw3d-titleMatch { font-size: 14px !important; }
      #bw3d-momentumCard { padding: 8px 12px 6px !important; }
      #bw3d-momentum { font-size: 15px !important; }
      #bw3d-participants { display: none; }
      #bw3d-live { display: none; }
      #bw3d-defPanel, #bw3d-atkPanel {
        top: auto !important;
        bottom: 92px !important;
        width: 44vw !important;
      }
      #bw3d-defPanel { left: 8px !important; }
      #bw3d-atkPanel { right: 8px !important; }
      #bw3d-defPanel #bw3d-defVal, #bw3d-atkPanel #bw3d-atkVal { font-size: 20px !important; }
      #bw3d-defPanel #bw3d-defFlags, #bw3d-atkPanel #bw3d-atkFlags { margin-top: 4px !important; }
      #bw3d-minimap-wrap { width: 94vw !important; bottom: 8px !important; }
      #bw3d-minimap { height: 62px !important; }
    }
  `;
  overlayEl.appendChild(responsiveStyle);

  const hudCss = 'position:absolute; z-index:2; pointer-events:none; text-shadow:0 2px 12px rgba(0,0,0,.6);';
  // Gli elementi centrali erano posizionati con top: assoluti (22/74/118/130/152)
  // e si sovrapponevano appena uno cresceva di altezza. Ora vivono in una
  // colonna flex: si impilano da soli, qualunque sia il loro contenuto.
  const centerCol = document.createElement('div');
  centerCol.id = 'bw3d-centerCol';
  centerCol.style.cssText = `
    position:absolute; z-index:2; pointer-events:none; top:18px; left:50%;
    transform:translateX(-50%); width:min(470px, calc(100vw - 560px));
    display:flex; flex-direction:column; align-items:center; gap:9px;
    text-shadow:0 2px 12px rgba(0,0,0,.6);
  `;
  overlayEl.appendChild(centerCol);
  const inCol = 'position:relative; width:100%; text-align:center;';

  // ── Titolo battaglia (regione + matchup) ──
  const title = document.createElement('div');
  title.id = 'bw3d-title';
  title.style.cssText = inCol;
  title.innerHTML = `
    <div id="bw3d-titleRegion" style="font-size:11px; letter-spacing:.18em; color:#8892a4; font-weight:600;">—</div>
    <div id="bw3d-titleMatch" style="font-family:'Playfair Display',Georgia,serif; font-size:18px; color:#e6edf3; margin-top:2px;">Loading…</div>
  `;
  centerCol.appendChild(title);

  const defPanel = document.createElement('div');
  defPanel.id = 'bw3d-defPanel';
  defPanel.style.cssText = hudCss + 'top:74px; left:20px; width:240px;';
  defPanel.innerHTML = `
    <div style="font-size:11px; letter-spacing:.18em; color:#8892a4; font-weight:600;">🛡️ DEFENDER DAMAGE</div>
    <div id="bw3d-defVal" style="font-family:'Playfair Display',Georgia,serif; font-size:34px; font-weight:700; color:#4d8dff;">0</div>
    <div id="bw3d-defRate" style="font-size:11px; color:#4d8dff; opacity:.75; min-height:14px;"></div>
    <div id="bw3d-defFlags" style="font-size:12px; margin-top:8px; display:flex; flex-direction:column; gap:3px;"></div>
  `;
  overlayEl.appendChild(defPanel);

  const atkPanel = document.createElement('div');
  atkPanel.id = 'bw3d-atkPanel';
  atkPanel.style.cssText = hudCss + 'top:74px; right:20px; width:240px; text-align:right;';
  atkPanel.innerHTML = `
    <div style="font-size:11px; letter-spacing:.18em; color:#8892a4; font-weight:600;">⚔️ ATTACKER DAMAGE</div>
    <div id="bw3d-atkVal" style="font-family:'Playfair Display',Georgia,serif; font-size:34px; font-weight:700; color:#ff4d6d;">0</div>
    <div id="bw3d-atkRate" style="font-size:11px; color:#ff4d6d; opacity:.75; min-height:14px;"></div>
    <div id="bw3d-atkFlags" style="font-size:12px; margin-top:8px; display:flex; flex-direction:column; gap:3px; align-items:flex-end;"></div>
  `;
  overlayEl.appendChild(atkPanel);

  // ── Barra split percentuale (sotto il titolo) ──
  const splitWrap = document.createElement('div');
  splitWrap.style.cssText = inCol + 'max-width:340px;';
  splitWrap.innerHTML = `
    <div style="height:6px; border-radius:3px; overflow:hidden; display:flex; background:rgba(255,255,255,0.06);">
      <div id="bw3d-splitDef" style="width:50%; background:#4d8dff; box-shadow:0 0 6px #4d8dff66;"></div>
      <div id="bw3d-splitAtk" style="width:50%; background:#ff4d6d; box-shadow:0 0 6px #ff4d6d66;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; margin-top:3px; font-size:10.5px; font-weight:700;">
      <span id="bw3d-splitDefPct" style="color:#4d8dff;">50%</span>
      <span id="bw3d-splitAtkPct" style="color:#ff4d6d;">50%</span>
    </div>
  `;
  centerCol.appendChild(splitWrap);

  // ── Pannello INERZIA: chi sta guadagnando, a che ritmo, e fra quanto
  //    sorpasserebbe l'avversario mantenendo il passo attuale. ──
  // E' l'aggiornamento principale della battaglia (rifatto a ogni frame),
  // quindi vive dentro una "card" con sfondo e bordo luminoso propri, non
  // piu' semplice testo fluttuante: deve saltare all'occhio prima di tutto
  // il resto dell'HUD.
  const momentumCard = document.createElement('div');
  momentumCard.id = 'bw3d-momentumCard';
  momentumCard.style.cssText = inCol + `
    background:rgba(10,14,22,0.62); border:1px solid rgba(255,255,255,0.14);
    border-radius:14px; padding:14px 18px 12px; backdrop-filter:blur(4px);
    box-shadow:0 0 0 1px rgba(255,255,255,0.03), 0 8px 30px rgba(0,0,0,.4);
    transition:box-shadow .3s ease;
  `;
  centerCol.appendChild(momentumCard);

  const momentum = document.createElement('div');
  momentum.id = 'bw3d-momentum';
  momentum.style.cssText = inCol + 'font-size:21px; letter-spacing:.05em; color:#e8c97a; font-weight:800; line-height:1.25;';
  momentum.textContent = 'LOADING BATTLE DATA…';
  momentumCard.appendChild(momentum);

  const momWrap = document.createElement('div');
  momWrap.style.cssText = inCol + 'margin-top:10px;';
  momWrap.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; justify-content:center; margin-bottom:6px;">
      <span style="font-size:10.5px; letter-spacing:.18em; color:#8892a4; font-weight:700;">MOMENTUM</span>
      <span id="bw3d-momWindow" style="font-size:10px; color:#5a6578;"></span>
    </div>
    <div style="position:relative; height:16px; border-radius:8px; background:rgba(255,255,255,0.07); overflow:hidden;">
      <div id="bw3d-momFill" style="position:absolute; top:0; bottom:0; left:50%; width:0%; background:#4d8dff; transition:none;"></div>
      <div style="position:absolute; left:50%; top:-2px; bottom:-2px; width:2px; background:rgba(255,255,255,.55);"></div>
    </div>
    <div id="bw3d-momLabel" style="font-size:14.5px; font-weight:700; margin-top:8px; color:#e8c97a;">—</div>
    <div id="bw3d-momEta" style="font-size:12.5px; color:#8892a4; margin-top:3px; min-height:17px;"></div>
    <div id="bw3d-momRates" style="font-size:11.5px; color:#5a6578; margin-top:4px; min-height:15px;"></div>
  `;
  momentumCard.appendChild(momWrap);
  hudMom = {
    fill: momWrap.querySelector('#bw3d-momFill'),
    label: momWrap.querySelector('#bw3d-momLabel'),
    eta: momWrap.querySelector('#bw3d-momEta'),
    rates: momWrap.querySelector('#bw3d-momRates'),
    window: momWrap.querySelector('#bw3d-momWindow'),
  };

  const participants = document.createElement('div');
  participants.id = 'bw3d-participants';
  participants.style.cssText = inCol + 'font-size:10px; color:#5a6578; letter-spacing:.06em; line-height:1.5; margin-top:8px;';
  centerCol.appendChild(participants);

  const live = document.createElement('div');
  live.id = 'bw3d-live';
  live.style.cssText = hudCss + 'bottom:20px; left:26px; font-size:10.5px; color:#5a6578; letter-spacing:.14em; display:flex; align-items:center; gap:6px;';
  live.innerHTML = `<span id="bw3d-livedot" style="width:6px;height:6px;border-radius:50%;background:#e8c97a;box-shadow:0 0 8px #e8c97a;"></span> <span id="bw3d-updatedAt">LIVE</span>`;
  overlayEl.appendChild(live);

  // ── Minimappa heatmap (barra segmentata per nazione) ──
  // Era 280x34px in un angolo: quasi invisibile. Ora è una barra larga e
  // alta, centrata in basso, con spazio per etichette bandiera+% dentro
  // ogni segmento abbastanza largo da contenerle.
  const minimapWrap = document.createElement('div');
  minimapWrap.id = 'bw3d-minimap-wrap';
  minimapWrap.style.cssText = `
    position:absolute; z-index:2; bottom:18px; left:50%; transform:translateX(-50%);
    width:min(760px, 82vw);
    pointer-events:auto; text-shadow:0 2px 12px rgba(0,0,0,.6);
  `;
  minimapWrap.innerHTML = `
    <div style="font-size:11px; letter-spacing:.18em; color:#8892a4; font-weight:600; margin-bottom:6px; text-align:center;">⚔️ DAMAGE FRONT MAP 🛡️</div>
    <canvas id="bw3d-minimap" width="1200" height="150" style="width:100%; height:110px; border-radius:10px; display:block; box-shadow:0 8px 28px rgba(0,0,0,.5); border:1px solid rgba(255,255,255,0.12);"></canvas>
  `;
  overlayEl.appendChild(minimapWrap);

  minimapTooltip = document.createElement('div');
  minimapTooltip.style.cssText = `
    position:absolute; z-index:4; pointer-events:none; display:none;
    background:rgba(8,11,16,0.95); border:1px solid rgba(255,255,255,0.15);
    border-radius:6px; padding:5px 9px; font-size:11px; color:#e6edf3;
    white-space:nowrap; text-shadow:none; box-shadow:0 6px 20px rgba(0,0,0,.5);
  `;
  overlayEl.appendChild(minimapTooltip);

  closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close (Esc)';
  // Era a top:22 left:50%, cioe' esattamente sopra al titolo. Spostato
  // nell'angolo in alto a destra, fuori da qualunque colonna.
  closeBtn.style.cssText = `
    position:absolute; top:18px; right:20px;
    z-index:4; pointer-events:auto; cursor:pointer;
    background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);
    color:#e6edf3; font-size:12px; font-weight:600; padding:8px 16px; border-radius:8px;
    backdrop-filter: blur(6px);
  `;
  closeBtn.addEventListener('click', closeBattleWall3D, { signal: getSignal() });
  overlayEl.appendChild(closeBtn);

  // ── Loading + errore di connessione ──
  const statusEl = document.createElement('div');
  statusEl.id = 'bw3d-status';
  statusEl.style.cssText = `
    position:absolute; inset:0; z-index:6; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:14px; pointer-events:auto;
    background:rgba(5,7,12,0.82); backdrop-filter:blur(3px);
    font-family:'Sora','Inter',sans-serif; color:#e6edf3;
  `;
  statusEl.innerHTML = `
    <div id="bw3d-spinner" style="width:34px; height:34px; border-radius:50%;
      border:3px solid rgba(255,255,255,0.14); border-top-color:#e8c97a;
      animation:bw3dSpin 0.9s linear infinite;"></div>
    <div id="bw3d-statusText" style="font-size:13px; letter-spacing:.08em; color:#c9d4e4;">Caricamento battaglia…</div>
    <button id="bw3d-retry" style="display:none; cursor:pointer; pointer-events:auto;
      background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);
      color:#e6edf3; font-size:12px; font-weight:600; padding:8px 18px; border-radius:8px;">Riprova</button>
    <style>@keyframes bw3dSpin { to { transform: rotate(360deg); } }</style>
  `;
  overlayEl.appendChild(statusEl);
  hudStatus = {
    root: statusEl,
    spinner: statusEl.querySelector('#bw3d-spinner'),
    text: statusEl.querySelector('#bw3d-statusText'),
    retry: statusEl.querySelector('#bw3d-retry'),
  };
  hudStatus.retry.addEventListener('click', () => {
    // Reset del backoff + un solo refresh: schedulePoll riparte da solo al
    // termine, quindi non si duplicano timer.
    pollFailCount = 0;
    showStatus('loading');
    if (currentBattleId) refreshBattleData(currentBattleId, false);
  }, { signal: getSignal() });

  document.body.appendChild(overlayEl);

  hudDefVal = defPanel.querySelector('#bw3d-defVal');
  hudDefFlags = defPanel.querySelector('#bw3d-defFlags');
  hudDefRate = defPanel.querySelector('#bw3d-defRate');
  hudAtkVal = atkPanel.querySelector('#bw3d-atkVal');
  hudAtkFlags = atkPanel.querySelector('#bw3d-atkFlags');
  hudAtkRate = atkPanel.querySelector('#bw3d-atkRate');
  hudMomentum = momentum;
  hudMomentumCard = momentumCard;
  hudParticipants = participants;
  hudTitle = { region: title.querySelector('#bw3d-titleRegion'), match: title.querySelector('#bw3d-titleMatch') };
  hudSplitDefPct = splitWrap.querySelector('#bw3d-splitDefPct');
  hudSplitAtkPct = splitWrap.querySelector('#bw3d-splitAtkPct');
  hudSplitBar = { def: splitWrap.querySelector('#bw3d-splitDef'), atk: splitWrap.querySelector('#bw3d-splitAtk') };
  liveDot = live.querySelector('#bw3d-livedot');
  hudUpdatedAt = live.querySelector('#bw3d-updatedAt');

  minimapCanvas = minimapWrap.querySelector('#bw3d-minimap');
  minimapCtx = minimapCanvas.getContext('2d');
  minimapCanvas.addEventListener('mousemove', (e) => {
    const rect = minimapCanvas.getBoundingClientRect();
    const scale = minimapCanvas.width / rect.width; // px CSS -> px canvas interni
    const px = (e.clientX - rect.left) * scale;
    const seg = minimapSegments.find(s => px >= s.x0 && px <= s.x1);
    if (!seg) { minimapTooltip.style.display = 'none'; return; }
    minimapTooltip.innerHTML = `<span style="color:${seg.colorCss}; font-weight:700;">${escapeHtml(seg.name)}</span> <span style="color:#8892a4;">· ${seg.sideLabel}</span><br>
      <span style="color:#c9d4e4;">${fmt(seg.damage)}</span> <span style="color:#8892a4;">· ${seg.pctOfSide.toFixed(2)}% of side · ${seg.pctOfTotal.toFixed(2)}% of battle</span>`;
    minimapTooltip.style.display = 'block';
    minimapTooltip.style.left = `${e.clientX - overlayEl.getBoundingClientRect().left}px`;
    minimapTooltip.style.top = `${rect.top - overlayEl.getBoundingClientRect().top - 40}px`;
    minimapTooltip.style.transform = 'translateX(-50%)';
  }, { signal: getSignal() });
  minimapCanvas.addEventListener('mouseleave', () => { minimapTooltip.style.display = 'none'; }, { signal: getSignal() });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl && overlayEl.style.display !== 'none') closeBattleWall3D();
  }, { signal: getSignal() });

  // Tab in background = RAF e polling fermi del tutto: senza il tab attivo
  // non c'e' nessun frame da disegnare, ma browser diversi continuano
  // comunque a chiamare requestAnimationFrame (throttled) e setTimeout,
  // quindi senza questo la scena gira a vuoto e le fetch continuano a
  // partire mentre l'utente sta guardando un'altra scheda.
  document.addEventListener('visibilitychange', onVisibilityChange, { signal: getSignal() });
}

// Stato dell'overlay di caricamento/errore.
// 'loading' -> spinner; 'error' -> messaggio + Riprova; 'hidden' -> nascosto.
function showStatus(mode) {
  if (!hudStatus.root) return;
  if (mode === 'hidden') { hudStatus.root.style.display = 'none'; return; }
  hudStatus.root.style.display = 'flex';
  const isError = mode === 'error';
  hudStatus.spinner.style.display = isError ? 'none' : 'block';
  hudStatus.text.textContent = isError ? 'Connessione persa' : 'Caricamento battaglia…';
  hudStatus.text.style.color = isError ? '#ff9c6b' : '#c9d4e4';
  hudStatus.retry.style.display = isError ? 'block' : 'none';
}

// ==================== THREE SCENE ====================
let OrbitControls = null;
let controls = null;
let userInteracting = false, lastInteractionMs = 0;
let idleBaseZ = null; // punto di partenza del micro-movimento cinematico quando la camera è ferma (sezione 13)

async function ensureThree() {
  if (THREE) return;
  THREE = await import(/* @vite-ignore */ THREE_CDN);
  try {
    OrbitControls = await loadOrbitControls();
  } catch (err) {
    // Senza OrbitControls la scena resta comunque usabile, solo non orbitabile.
    console.warn('battleWall3D: OrbitControls non disponibile', err);
    OrbitControls = null;
  }
}

// A partire da three@0.128 il bundle examples/jsm/controls/OrbitControls.js
// importa "three" come bare specifier (`import ... from 'three'`) invece di
// un percorso relativo: senza un import map il browser non riesce a
// risolverlo e lancia "Failed to resolve module specifier 'three'". Qui si
// scarica il sorgente come testo, si riscrive quel bare specifier con l'URL
// assoluto di THREE_CDN (lo stesso gia' importato sopra, quindi stessa
// istanza del modulo grazie alla cache dei moduli per URL) e si importa il
// risultato da un Blob URL: nessun import map globale necessario.
async function loadOrbitControls() {
  const res = await fetch(ORBIT_CDN);
  if (!res.ok) throw new Error(`OrbitControls fetch failed: ${res.status}`);
  let src = await res.text();
  src = src.replace(/from\s*(['"])three\1/g, `from '${THREE_CDN}'`);
  const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    return mod.OrbitControls;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// Dimensioni reali del contenitore del canvas (non della finestra): su
// desktop canvasHost riempie ancora tutto lo schermo (nessuna differenza),
// su mobile e' un riquadro piu' piccolo definito via CSS responsive.
function getCanvasSize() {
  const w = Math.max(1, Math.round(canvasHost.clientWidth));
  const h = Math.max(1, Math.round(canvasHost.clientHeight));
  return { w, h };
}

function buildScene() {
  if (sceneReady) return;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070a0e, 0.0085);
  scene.background = makeSkyTexture();

  // Dimensioni prese dal box reale di canvasHost, non dalla finestra: su
  // mobile canvasHost e' contenuto in un riquadro piu' piccolo (vedi stile
  // responsive in ensureOverlay), quindi il renderer lavora davvero su una
  // superficie ridotta invece di renderizzare a piena finestra e poi
  // tagliare il risultato con overflow:hidden (che non risparmierebbe nulla
  // in termini di fill-rate GPU).
  const initSize = getCanvasSize();

  // Camera prospettica: da' profondita' reale al campo, che con l'ortografica
  // risultava schiacciata.
  camera = new THREE.PerspectiveCamera(45, initSize.w / initSize.h, 0.5, 600);
  camera.position.set(0, 50, 40);
  camera.lookAt(0, 0, 0);

  // antialias:false + pixelRatio cap (1.5 desktop, 1 su mobile): il costo di
  // riempimento pixel scala col quadrato del pixel ratio, ed e' la voce piu'
  // pesante lato GPU su schermi retina/4K, ancora di piu' su mobile dove la
  // GPU e' molto piu' debole. La perdita di nitidezza e' minima con lo
  // shader fog/terreno gia' presente.
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1 : 1.5));
  renderer.setSize(initSize.w, initSize.h);
  // Ombre dinamiche COMPLETAMENTE disattivate: era ancora la voce piu'
  // pesante in assoluto (un depth-pass di tutta la scena, anche solo ogni
  // pochi frame, resta costoso). Il terreno/gli oggetti restano leggibili
  // grazie a luce ambientale + direzionale, senza il costo delle ombre.
  renderer.shadowMap.enabled = false;
  canvasHost.appendChild(renderer.domElement);

  // ── OrbitControls: rotazione e zoom, con limiti che impediscono di finire
  //    sotto il terreno o di perdere di vista il campo. ──
  if (OrbitControls) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    userInteracting = false; lastInteractionMs = 0;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.minDistance = 18;                 // non si entra dentro le unita'
    controls.maxDistance = MAP_W * 1.15;       // il campo resta sempre inquadrato
    controls.minPolarAngle = 0.15;             // quasi zenitale
    controls.maxPolarAngle = Math.PI / 2 - 0.12; // mai sotto l'orizzonte/terreno
    controls.update();

    // "Respiro" verso il fronte: se l'utente non sta orbitando/panning da un
    // po', il target segue pianissimo wallX (vedi renderLoop). Costo zero
    // (nessuna geometria, solo un lerp su un valore gia' aggiornato ogni
    // frame): da' l'impressione che la telecamera stessa "senta" l'avanzata,
    // senza mai strappare il controllo di mano a chi sta orbitando.
    controls.addEventListener('start', () => { userInteracting = true; });
    controls.addEventListener('end', () => {
      userInteracting = false;
      lastInteractionMs = performance.now();
    });
  }

  scene.add(new THREE.AmbientLight(0x8899bb, 0.6));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
  sun.position.set(20, 50, 26);
  // Niente piu' setup ombre (mapSize/shadow.camera/castShadow): con
  // renderer.shadowMap.enabled = false il motore le ignora comunque, quindi
  // configurarle sarebbe solo lavoro sprecato in fase di build scena.
  scene.add(sun);

  buildGround();
  addRoads();
  addLakes();
  addVillages();
  // Era 340, poi 160: ulteriormente dimezzato. Gli alberi sono statici (build
  // one-shot) ma pesano comunque sul draw-call/vertex count totale.
  addTrees(IS_MOBILE ? 32 : 80);

  // ── Linea del fronte: sottile e chiara, non piu' un muro luminoso ──
  wallGroup = new THREE.Group();
  // La linea del fronte e' segmentata e segue frontWobble(z), altrimenti
  // restava una barra dritta mentre il confine del terreno ondulava.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.5 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
  const nSeg = Math.floor(MAP_D / 0.6);
  const lineGeo = new THREE.BoxGeometry(0.1, 0.55, 0.62);
  const glowGeo = new THREE.PlaneGeometry(0.9, 0.62);
  glowGeo.rotateX(-Math.PI / 2);
  wallCore = new THREE.InstancedMesh(lineGeo, lineMat, nSeg);
  wallGlow = new THREE.InstancedMesh(glowGeo, glowMat, nSeg);
  wallSegCount = nSeg;
  _dWall = new THREE.Object3D();
  wallGroup.add(wallCore, wallGlow);
  addTrenches(wallGroup);
  scene.add(wallGroup);

  // ── Linea del centro mappa (50%) ──
  // A differenza della linea del fronte (wallGroup, che segue wallX ed e'
  // quindi la posizione ATTUALE della battaglia), questa e' fissa a x=0 per
  // tutta la durata della battaglia: da' un riferimento stabile per capire
  // a colpo d'occhio quanto terreno ciascun lato ha guadagnato rispetto al
  // punto di partenza neutro. Tratteggiata e di colore ambra per non essere
  // confusa con la linea del fronte (bianca, continua).
  buildCenterLine();

  // ── Frecce di momentum ──
  // Una per lato, sopra le rispettive truppe: puntano verso il nemico
  // quando quel lato sta avanzando, indietro verso casa quando sta
  // ripiegando. Dimensione e opacita' seguono la forza dello squilibrio
  // (vedi updateMomentumArrows nel render loop).
  buildMomentumArrows();

  // Polvere ambientale, sbuffi ai piedi e aerei rimossi del tutto (vedi note
  // sopra): meno pool da costruire e meno lavoro per frame.
  buildSharedBodyPools();
  buildTracerPool();
  buildFlashPool();
  buildExplosionPool();
  buildShellPool();

  resizeHandler = () => {
    const { w, h } = getCanvasSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', resizeHandler, { signal: getSignal() });

  sceneReady = true;
}

// ==================== TERRENO ====================
const RIDGE_H = 1.6, RIDGE_W = 9.0;
// Quota del terreno in un punto. Il terreno ondula fino a ~+/-1.6: qualunque
// oggetto posizionato a y fisso finiva sepolto dentro le colline. TUTTO
// (truppe, mezzi, alberi, case, strade, trincee, fronte, esplosioni) deve
// appoggiarsi qui. Se cambi la formula, cambiala anche nel vertexShader di
// buildGround, che deve restare identica.
function terrainHeight(x, z) {
  // Cresta centrale: rilievo gaussiano attorno a x=0, cosi' il fronte corre
  // lungo un crinale invece che su una piana.
  // NOTA: la geometria del terreno e' generata da questa stessa funzione in
  // buildGround(), e il vertexShader si limita a passare la posizione: quota
  // JS e quota shader restano quindi sincronizzate per costruzione.
  const ridge = RIDGE_H * Math.exp(-(x * x) / (2 * RIDGE_W * RIDGE_W))
    * (1 + Math.sin(z * 0.18) * 0.25);
  return Math.sin(x * 0.08) * Math.cos(z * 0.22) * 0.5
    + Math.sin(x * 0.031 + z * 0.05) * 0.9
    + Math.sin(x * 0.21 + z * 0.13) * 0.2
    + ridge;
}

// Il terreno e' tinto per fazione direttamente nel fragment shader in base
// alla posizione del fronte (uniform frontX): niente piani semitrasparenti
// sopra il suolo, il territorio conquistato cambia colore in modo netto e la
// linea di confine ha un bordo irregolare, non un taglio geometrico.
let groundMat = null;

function buildGround() {
  const geo = new THREE.PlaneGeometry(MAP_W, MAP_D, 200, 60);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const shade = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    // variazione di luminosita' del terreno (chiazze piu' chiare/scure)
    shade.push(0.86 + Math.sin(x * 0.17 + z * 0.29) * 0.1 + Math.sin(x * 0.05) * 0.06);
  }
  geo.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  geo.computeVertexNormals();

  groundMat = new THREE.ShaderMaterial({
    uniforms: {
      frontX: { value: 0 },
      // Tempo di scena, aggiornato ogni frame insieme a frontX (vedi
      // renderLoop): un solo sin() in piu' nel fragment shader esistente fa
      // "scorrere" la fascia bruciata lungo la cucitura, quasi a costo zero
      // (nessuna geometria/draw call aggiuntiva), per dare l'idea di fumo o
      // polvere che si muove lungo un fronte vivo anche quando wallX e'
      // momentaneamente fermo tra un poll e l'altro.
      uTime: { value: 0 },
      // Sezione 9 della richiesta ("front trail"): velocita' recente del
      // fronte, aggiornata ogni frame in renderLoop (vedi frontVelSmoothed).
      // Un fronte che si sta muovendo rapidamente allarga e scurisce un po'
      // la fascia di terreno battuto attorno alla linea di contatto, dando
      // l'idea di una scia appena lasciata dal passaggio del combattimento;
      // quando il fronte torna fermo la fascia si restringe da sola (nessun
      // oggetto/particella da creare o smaltire: e' lo stesso scar già
      // presente nel fragment shader, solo modulato da questo uniform).
      frontVel: { value: 0 },
      colDef: { value: new THREE.Color(TERR_DEF) },
      colAtk: { value: new THREE.Color(TERR_ATK) },
      lightDir: { value: new THREE.Vector3(20, 50, 26).normalize() },
    },
    vertexShader: [
      'attribute float shade;',
      'varying float vShade; varying vec3 vN; varying vec3 vWorld;',
      'void main(){',
      '  vShade = shade; vN = normalize(normalMatrix * normal);',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorld = wp.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float frontX; uniform float uTime; uniform float frontVel; uniform vec3 colDef; uniform vec3 colAtk; uniform vec3 lightDir;',
      'varying float vShade; varying vec3 vN; varying vec3 vWorld;',
      'void main(){',
      // confine irregolare: il fronte non e' una retta perfetta
      '  float wobble = sin(vWorld.z * 0.55) * 0.9 + sin(vWorld.z * 1.7) * 0.35;',
      '  float edge = frontX + wobble;',
      // transizione netta: prima era smoothstep(+/-0.7) con una cicatrice
      // larga 7 unita' al 55%, che sbiadiva completamente il confine
      '  float side = smoothstep(edge - 0.25, edge + 0.25, vWorld.x);',
      '  vec3 terr = mix(colDef, colAtk, side) * vShade;',
      // stretta fascia di terreno battuto attorno alla linea; la sua
      // larghezza ed intensita' seguono frontVel, cosi' un fronte che sta
      // avanzando/arretrando in fretta lascia dietro di se' una scia piu'
      // marcata di quella di una linea ferma (front trail, sez. 9)
      '  float trailW = 2.2 + min(2.6, frontVel * 3.2);',
      '  float scar = 1.0 - smoothstep(0.0, trailW, abs(vWorld.x - edge));',
      '  terr = mix(terr, vec3(0.20, 0.16, 0.12), scar * (0.42 + min(0.22, frontVel * 0.5)));',
      // flow: pattern che scorre lungo z dentro la sola fascia bruciata,
      // sfumato ai bordi cosi' non introduce un taglio netto
      '  float flow = sin(vWorld.z * 2.2 - uTime * 1.6) * 0.5 + 0.5;',
      '  terr = mix(terr, terr * (0.82 + flow * 0.3), scar);',
      // cucitura scura sulla linea di contatto, per staccare i due territori
      '  float seam = 1.0 - smoothstep(0.0, 0.45, abs(vWorld.x - edge));',
      '  terr = mix(terr, vec3(0.08, 0.06, 0.05), seam * 0.75);',
      '  float diff = max(dot(normalize(vN), normalize(lightDir)), 0.0);',
      // Chiazze procedurali: rompono l'aspetto piatto senza texture esterne
      '  float p = sin(vWorld.x * 0.9 + vWorld.z * 1.3) * sin(vWorld.x * 0.37 - vWorld.z * 0.71);',
      '  float p2 = sin(vWorld.x * 2.7 - vWorld.z * 1.9);',
      '  terr *= 0.93 + p * 0.07 + p2 * 0.025;',
      '  vec3 col = terr * (0.55 + 0.65 * diff);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });

  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
}

// Strade che attraversano il campo in orizzontale (come nella reference)
function addRoads() {
  const mk = (z, width, color) => {
    const g = new THREE.PlaneGeometry(MAP_W, width, 120, 1);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const zz = p.getZ(i) + z + Math.sin(x * 0.045) * 1.6;
      p.setZ(i, zz);
      p.setY(i, terrainHeight(x, zz) + 0.04);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    m.receiveShadow = true;
    scene.add(m);
  };
  mk(-1.5, 1.7, 0x4a4a4e);
  mk(6.5, 1.2, 0x53514c);
}

function addLakes() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f5fa8, roughness: 0.25, metalness: 0.3 });
  const sand = new THREE.MeshStandardMaterial({ color: 0xbfae86, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const x = (Math.random() - 0.5) * MAP_W * 0.85;
    const z = (Math.random() - 0.5) * MAP_D * 0.7;
    const r = 1.1 + Math.random() * 1.4;
    const beach = new THREE.Mesh(new THREE.CircleGeometry(r * 1.18, 16), sand);
    const gy = terrainHeight(x, z);
    beach.rotation.x = -Math.PI / 2; beach.position.set(x, gy + 0.05, z);
    beach.scale.set(1, 0.55, 1);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r, 14), mat);
    water.rotation.x = -Math.PI / 2; water.position.set(x, gy + 0.08, z);
    water.scale.set(1, 0.5, 1);
    scene.add(beach, water);
  }
}

// Era un Mesh singolo per edificio (corpo+tetto): con 5 villaggi da 3-6 case
// erano 30-60 draw call statici per pura scenografia. Costruito una sola
// volta l'elenco delle posizioni, poi DUE InstancedMesh globali (tutti i
// corpi, tutti i tetti) come gia' fatto per gli alberi: stesso risultato
// visivo, due draw call in tutto invece di decine.
function addVillages() {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9cba8, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x7d4a33, roughness: 0.85 });

  const plots = [];
  for (let v = 0; v < 5; v++) {
    const cx = (Math.random() - 0.5) * MAP_W * 0.9;
    const cz = (Math.random() - 0.5) * MAP_D * 0.75;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      plots.push({
        x: cx + (Math.random() - 0.5) * 3.5,
        z: cz + (Math.random() - 0.5) * 1.6,
      });
    }
  }
  if (!plots.length) return;

  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.5, 0.55), wallMat, plots.length);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.52, 0.34, 4), roofMat, plots.length);
  bodies.castShadow = true;
  roofs.castShadow = true;
  const d = new THREE.Object3D();
  plots.forEach((p, i) => {
    const gy = terrainHeight(p.x, p.z);
    d.position.set(p.x, gy + 0.25, p.z); d.rotation.set(0, 0, 0);
    d.updateMatrix(); bodies.setMatrixAt(i, d.matrix);
    d.position.set(p.x, gy + 0.67, p.z); d.rotation.set(0, Math.PI / 4, 0);
    d.updateMatrix(); roofs.setMatrixAt(i, d.matrix);
  });
  scene.add(bodies, roofs);
}

// Trincee: linee spezzate parallele al fronte, una per lato. Sono figlie di
// wallGroup, quindi scorrono insieme alla linea di battaglia.
// Oggetti figli di wallGroup che scorrono col fronte: la loro quota va
// ricalcolata ogni frame perche' si spostano su terreno ondulato.
let groundFollowers = [];

function addTrenches(parent) {
  // Linee sottili scavate nel terreno, una coppia per lato. Seguono la stessa
  // ondulazione del fronte (frontWobble) cosi' restano parallele al confine.
  // Prima erano box 0.85x0.16x1.0 con parapetto 0.3x0.28: a questa scala
  // apparivano come muraglioni marroni piu' grandi delle truppe.
  const dug = new THREE.MeshStandardMaterial({ color: 0x2c2318, roughness: 1 });
  const berm = new THREE.MeshStandardMaterial({ color: 0x4a3b26, roughness: 1 });
  const segs = Math.floor(MAP_D / 0.8);
  for (const [offset, dir] of [[-1.9, -1], [-3.6, -1], [1.9, 1], [3.6, 1]]) {
    for (let i = 0; i < segs; i++) {
      const z = -MAP_D / 2 + i * 0.8 + 0.4;
      const zig = (i % 2 === 0 ? 0.14 : -0.14);
      const baseX = offset + zig + frontWobble(z);

      const trench = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.78), dug);
      trench.position.set(baseX, 0, z);
      trench.userData.ground = { dx: baseX, z, dy: 0.03 };

      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.11, 0.78), berm);
      lip.position.set(baseX + dir * 0.22, 0, z);
      lip.userData.ground = { dx: baseX + dir * 0.22, z, dy: 0.06 };
      lip.castShadow = true;

      groundFollowers.push(trench, lip);
      parent.add(trench, lip);
    }
  }
}

function addTrees(count) {
  const trunkGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.22, 4);
  const leavesGeo = new THREE.ConeGeometry(0.2, 0.5, 5);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 }), count);
  const leaves = new THREE.InstancedMesh(leavesGeo, new THREE.MeshStandardMaterial({ color: 0x1f5b2b, roughness: 0.95 }), count);
  leaves.castShadow = true;
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * MAP_W * 0.97;
    const z = (Math.random() - 0.5) * MAP_D * 0.95;
    const s = 0.7 + Math.random() * 1.1;
    const gy = terrainHeight(x, z);
    d.position.set(x, gy + 0.11 * s, z); d.scale.setScalar(s); d.rotation.y = Math.random() * Math.PI;
    d.updateMatrix(); trunks.setMatrixAt(i, d.matrix);
    d.position.y = gy + 0.42 * s; d.updateMatrix(); leaves.setMatrixAt(i, d.matrix);
  }
  scene.add(trunks, leaves);
}

// Linea tratteggiata statica a x=0 (centro geografico della mappa, il 50%):
// costruita una sola volta, non segue mai wallX. Serve da metro di paragone
// per la linea del fronte (che invece si sposta con l'andamento reale della
// battaglia), cosi' si vede subito quanto ci si e' allontanati dal centro.
function buildCenterLine() {
  const dashLen = 0.55, gapLen = 0.4;
  const step = dashLen + gapLen;
  const count = Math.max(1, Math.floor(MAP_D / step));
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8c97a, transparent: true, opacity: 0.6 });
  const geo = new THREE.BoxGeometry(0.09, 0.5, dashLen);
  centerLineMesh = new THREE.InstancedMesh(geo, mat, count);
  centerLineMesh.frustumCulled = false;
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const z = -MAP_D / 2 + i * step + dashLen / 2;
    const gy = terrainHeight(0, z);
    d.position.set(0, gy + 0.28, z);
    d.rotation.set(0, 0, 0);
    d.updateMatrix();
    centerLineMesh.setMatrixAt(i, d.matrix);
  }
  centerLineMesh.instanceMatrix.needsUpdate = true;
  scene.add(centerLineMesh);
}

// Freccia 3D (asta + punta) costruita puntando verso +x per default: la
// direzione reale viene poi ottenuta ruotandola attorno a y in updateMomentumArrows.
function makeArrowMesh(colorHex) {
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex, transparent: true, opacity: 0.85, depthWrite: false,
  });
  const shaftGeo = new THREE.BoxGeometry(1.7, 0.16, 0.16);
  shaftGeo.translate(0.85, 0, 0);
  const headGeo = new THREE.ConeGeometry(0.36, 0.85, 8);
  headGeo.rotateZ(-Math.PI / 2);
  headGeo.translate(1.9, 0, 0);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shaftGeo, mat), new THREE.Mesh(headGeo, mat));
  group.userData.mat = mat;
  return group;
}

function buildMomentumArrows() {
  arrowDef = makeArrowMesh(SIDE_DEF);
  arrowAtk = makeArrowMesh(SIDE_ATK);
  scene.add(arrowDef, arrowAtk);
}

// Chiamata ad ogni frame dal render loop. push e' relativo al lato (>0 =
// quel lato sta avanzando, stessa convenzione usata per le truppe), quindi
// la freccia punta verso il nemico quando push>=0 e verso casa quando push<0.
function placeMomentumArrow(arrow, sign, push, wallX, z, t) {
  if (!arrow) return;
  const strength = Math.min(1, Math.abs(push));
  arrow.visible = strength > 0.04;
  if (!arrow.visible) return;

  const forwardFacing = sign > 0 ? Math.PI : 0;   // stessa convenzione di "facing" delle truppe
  arrow.rotation.y = forwardFacing + (push < 0 ? Math.PI : 0);

  // resta vicino al fronte, dentro il territorio del proprio lato, senza
  // mai superare i bordi mappa
  const homeX = sign > 0 ? REAR_ATTACKER - 6 : REAR_DEFENDER + 6;
  const x = sign > 0
    ? Math.min(homeX, wallX + 14)
    : Math.max(homeX, wallX - 14);
  const bob = Math.sin(t * 1.6 + (sign > 0 ? Math.PI : 0)) * 0.2;
  const gy = terrainHeight(x, z) + 3.4 + bob;
  arrow.position.set(x, gy, z);
  arrow.scale.setScalar(0.55 + strength * 0.75);
  arrow.userData.mat.opacity = 0.3 + strength * 0.55;
}

function updateMomentumArrows(dt, wallX, drive) {
  const t = performance.now() * 0.001;
  placeMomentumArrow(arrowDef, -1, drive, wallX, -MAP_D * 0.3, t);
  placeMomentumArrow(arrowAtk, 1, -drive, wallX, MAP_D * 0.3, t);
}

// Riallinea al terreno tutto cio' che scorre insieme al fronte.
// wallGroup trasla in x, quindi la x reale di ogni pezzo e' wallX + offset e
// la quota va ripresa da terrainHeight ad ogni frame.
// wallX e' un lerp verso wallTargetX: converge in modo asintotico e per la
// maggior parte del tempo (fronte "assestato" tra un poll e l'altro) resta
// fermo entro pochi millesimi. Sotto questa soglia si salta del tutto il
// ricalcolo di quota di tutta la linea del fronte + delle ~160 trincee, che
// altrimenti veniva rifatto incondizionatamente ad ogni frame anche a
// battaglia ferma.
const WALL_MOVE_EPS = 0.003;
let lastFollowerWallX = 1e9;

function updateGroundFollowers() {
  if (Math.abs(wallX - lastFollowerWallX) < WALL_MOVE_EPS) return;
  lastFollowerWallX = wallX;

  for (let i = 0; i < wallSegCount; i++) {
    const z = -MAP_D / 2 + i * 0.6 + 0.3;
    const wob = frontWobble(z);
    const gy = terrainHeight(wallX + wob, z);
    _dWall.position.set(wob, gy + 0.28, z);
    _dWall.updateMatrix(); wallCore.setMatrixAt(i, _dWall.matrix);
    _dWall.position.set(wob, gy + 0.05, z);
    _dWall.updateMatrix(); wallGlow.setMatrixAt(i, _dWall.matrix);
  }
  wallCore.instanceMatrix.needsUpdate = true;
  wallGlow.instanceMatrix.needsUpdate = true;

  for (const m of groundFollowers) {
    const g = m.userData.ground;
    m.position.y = terrainHeight(wallX + g.dx, g.z) + g.dy;
  }
}


// ==================== TRACERS (pool) ====================
// Brevi scie dal fucile verso il fronte. Puramente cosmetiche: non toccano
// nessun dato di combattimento.
// Era 120: updateTracers() ricompone la matrice di OGNI slot (attivo o no)
// e forza un upload GPU dell'intero buffer ad ogni frame, quindi la
// dimensione del pool e' un costo fisso per frame indipendente da quanti
// sono davvero in volo. 60 e' piu' che sufficiente per la densita' di fuoco.
// Ulteriormente ridotto (era 60): pool piu' piccolo = meno matrici da
// ricomporre ad ogni frame in updateTracers().
// MAX_TRACERS ecc. sono ora il tetto ASSOLUTO del pool (array allocato una
// sola volta, come TROOPS_PER_SIDE_ABS_MAX sopra): quante di quelle istanze
// sono davvero "attive" in un dato momento e' governato da un cap dinamico
// (tracerActiveCap ecc.), ricalcolato sia dal budget dati-reali sia
// dall'adaptive quality (vedi APPLICAZIONE BUDGET/QUALITA' piu' in basso).
// Con budgetScale/qualityDerate a 1 il comportamento coincide col vecchio
// MAX_* fisso.
const MAX_TRACERS = Math.ceil((IS_MOBILE ? 16 : 32) * BUDGET_MAX);
const TRACER_LIFE = 0.15;
let tracerMesh = null, tracerData = [], _dTracer = null;
let tracerActiveCap = IS_MOBILE ? 16 : 32;

function buildTracerPool() {
  const geo = new THREE.BoxGeometry(1, 0.02, 0.02); // scalata in x = lunghezza
  tracerMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffc04d, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }), MAX_TRACERS);
  tracerMesh.frustumCulled = false;
  tracerMesh.count = tracerActiveCap;
  tracerData = Array.from({ length: MAX_TRACERS }, () => ({ life: 0, x: 0, y: 0, z: 0, dir: 1, len: 1 }));
  _dTracer = new THREE.Object3D();
  scene.add(tracerMesh);
}

function spawnTracer(x, y, z, sign) {
  let t = null;
  for (let i = 0; i < tracerActiveCap; i++) { if (tracerData[i].life <= 0) { t = tracerData[i]; break; } }
  if (!t) return;
  t.life = TRACER_LIFE;
  t.x = x; t.y = y; t.z = z;
  t.dir = -sign;                    // verso il fronte
  t.len = 0.8 + Math.random() * 1.2;
}

function updateTracers(dt) {
  if (!tracerMesh) return;
  let any = false;
  for (let i = 0; i < tracerActiveCap; i++) {
    const t = tracerData[i];
    if (t.life <= 0) {
      _dTracer.position.set(0, -999, 0);
      _dTracer.scale.setScalar(0.0001);
    } else {
      t.life -= dt;
      const k = Math.max(0, t.life / TRACER_LIFE);
      const travel = (1 - k) * 2.2;
      _dTracer.position.set(t.x + t.dir * (travel + t.len / 2), t.y, t.z);
      _dTracer.rotation.set(0, 0, 0);
      _dTracer.scale.set(t.len, 1, 1);
      any = true;
    }
    _dTracer.updateMatrix();
    tracerMesh.setMatrixAt(i, _dTracer.matrix);
  }
  tracerMesh.instanceMatrix.needsUpdate = true;
  tracerMesh.visible = any;
}

// Polvere ai piedi RIMOSSA del tutto (pool + spawn + update ad ogni frame):
// puro dettaglio estetico, tagliato per alleggerire ulteriormente.

// Crateri RIMOSSI su richiesta (macchie nere sul terreno dopo ogni impatto).

// ==================== ESPLOSIONI (semplificate) ====================
// Pool ridotto (era 48) e update "pigro": gli slot inattivi che sono gia'
// stati nascosti non vengono piu' ritoccati ad ogni frame (prima si
// riscriveva l'intero pool, attivo o no, con relativo upload GPU completo).
const MAX_EXPLOSIONS = Math.ceil((IS_MOBILE ? 8 : 16) * BUDGET_MAX);
let explMesh = null, explData = [], _dExpl = null;
let explActiveCap = IS_MOBILE ? 8 : 16;

function buildExplosionPool() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,245,1)');
  grd.addColorStop(0.3, 'rgba(255,214,140,0.8)');
  grd.addColorStop(0.65, 'rgba(255,130,50,0.35)');
  grd.addColorStop(1, 'rgba(120,60,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.Texture(c); tex.needsUpdate = true;

  explMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    MAX_EXPLOSIONS
  );
  explMesh.frustumCulled = false;
  explMesh.count = explActiveCap;
  explData = Array.from({ length: MAX_EXPLOSIONS }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, size: 1, hidden: true }));
  _dExpl = new THREE.Object3D();
  scene.add(explMesh);
}

function spawnExplosion(x, z, size = 1) {
  let slot = null;
  for (let i = 0; i < explActiveCap; i++) { if (explData[i].life <= 0) { slot = explData[i]; break; } }
  if (!slot) return;
  slot.life = 0.001; slot.max = 0.45 + Math.random() * 0.35;
  slot.x = x; slot.y = terrainHeight(x, z) + 0.3; slot.z = z; slot.size = size * (1.4 + Math.random() * 1.2);
  slot.hidden = false;
}

function updateExplosions(dt) {
  if (!explMesh) return;
  let dirty = false;
  for (let i = 0; i < explActiveCap; i++) {
    const e = explData[i];
    // Slot inattivo e gia' fuori campo: niente da fare, si salta del tutto
    // (ne' calcolo ne' scrittura di matrice).
    if (e.life <= 0 && e.hidden) continue;

    if (e.life <= 0) {
      _dExpl.position.set(0, -999, 0); _dExpl.scale.setScalar(0.0001);
      e.hidden = true;
    } else {
      e.life += dt;
      const k = e.life / e.max;
      if (k >= 1) {
        e.life = 0; e.hidden = true;
        _dExpl.position.set(0, -999, 0); _dExpl.scale.setScalar(0.0001);
      } else {
        _dExpl.position.set(e.x, e.y + k * 1.1, e.z);
        _dExpl.quaternion.copy(camera.quaternion);
        _dExpl.scale.setScalar(e.size * (0.5 + k * 1.7));
      }
    }
    _dExpl.updateMatrix();
    explMesh.setMatrixAt(i, _dExpl.matrix);
    dirty = true;
  }
  if (dirty) explMesh.instanceMatrix.needsUpdate = true;
}

// ==================== ARTIGLIERIA (proiettili ad arco + scia) ====================
const MAX_SHELLS = Math.ceil((IS_MOBILE ? 6 : 12) * BUDGET_MAX);   // era 20: meno colpi in volo insieme = meno scie da ricalcolare
let shells = [];
let shellActiveCap = IS_MOBILE ? 6 : 12;

function buildShellPool() {
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
  const trailMat = () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  shells = Array.from({ length: MAX_SHELLS }, () => {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), headMat);
    head.visible = false;
    const pts = new Float32Array(TRAIL_LEN * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(g, trailMat());
    line.frustumCulled = false;
    line.visible = false;
    scene.add(head, line);
    return { head, line, pts, active: false, t: 0, dur: 1, x0: 0, z0: 0, x1: 0, z1: 0, peak: 8, trail: [] };
  });
}

const TRAIL_LEN = 26;

// originX/originZ opzionali: se passati, il colpo parte dal pezzo di
// artiglieria che ha sparato invece che da un punto casuale della retrovia.
function launchShell(fromSign, originX, originZ) {
  let s = null;
  for (let i = 0; i < shellActiveCap && i < shells.length; i++) { if (!shells[i].active) { s = shells[i]; break; } }
  if (!s) return;
  const rear = fromSign < 0 ? REAR_DEFENDER : REAR_ATTACKER;
  s.active = true; s.t = 0;
  s.dur = 1.6 + Math.random() * 1.2;
  s.x0 = originX != null ? originX : rear + fromSign * -1 * (Math.random() * 8);
  s.z0 = originZ != null ? originZ : (Math.random() - 0.5) * MAP_D * 0.8;
  s.x1 = wallX - fromSign * (0.5 + Math.random() * 4);
  s.z1 = s.z0 + (Math.random() - 0.5) * 5;
  s.peak = 7 + Math.random() * 6;
  s.trail = [];
  s.head.visible = true; s.line.visible = true;
}

function updateShells(dt) {
  for (const s of shells) {
    if (!s.active) continue;
    s.t += dt / s.dur;
    if (s.t >= 1) {
      s.active = false; s.head.visible = false; s.line.visible = false;
      spawnExplosion(s.x1, s.z1, 1.6);
      return;
    }
    const k = s.t;
    const x = s.x0 + (s.x1 - s.x0) * k;
    const z = s.z0 + (s.z1 - s.z0) * k;
    // parte e atterra a livello del suolo, non a quota fissa
    const groundY = terrainHeight(x, z);
    const y = groundY + 0.4 + Math.sin(k * Math.PI) * s.peak;
    s.head.position.set(x, y, z);

    s.trail.push(x, y, z);
    while (s.trail.length > TRAIL_LEN * 3) s.trail.splice(0, 3);
    for (let i = 0; i < TRAIL_LEN; i++) {
      const src = Math.min(i, s.trail.length / 3 - 1) * 3;
      s.pts[i * 3] = s.trail[src] ?? x;
      s.pts[i * 3 + 1] = s.trail[src + 1] ?? y;
      s.pts[i * 3 + 2] = s.trail[src + 2] ?? z;
    }
    s.line.geometry.attributes.position.needsUpdate = true;
  }
}

// Sistema aerei RIMOSSO del tutto (era un FX secondario: velivoli in volo +
// bombardamenti periodici) per tagliare ulteriormente il carico CPU come
// richiesto: niente piu' oggetti extra da muovere/testare ogni frame.

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0a1220');
  grad.addColorStop(0.45, '#141c2c');
  grad.addColorStop(0.75, '#1c2333');
  grad.addColorStop(1, '#26201a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
  return tex;
}

// Polvere ambientale (particelle fluttuanti) RIMOSSA del tutto: puro
// atmosfera senza funzione di leggibilita', ricalcolata punto per punto ad
// ogni frame — tagliata per alleggerire ulteriormente.

// ==================== VAMPE DI SPARO ====================
// Pool unico condiviso da tutte le unita': ogni frame le istanze non usate
// vengono spinte fuori campo, cosi' non serve creare/distruggere nulla.
// Era 260: finalizeFlashes() ripulisce ogni frame gli slot da flashCursor a
// MAX_FLASHES, quindi con pool grande e poco fuoco attivo si ricompone e
// riupload quasi tutto il buffer per niente. 130 basta anche con fronte
// "caldo". Ulteriormente tagliato per il giro di semplificazione richiesto.
const MAX_FLASHES = Math.ceil((IS_MOBILE ? 34 : 70) * BUDGET_MAX);
let flashMesh = null, flashCursor = 0, _dFlash = null;
let flashActiveCap = IS_MOBILE ? 34 : 70;

function buildFlashPool() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,240,190,1)');
  grd.addColorStop(0.4, 'rgba(255,180,80,0.55)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  const tex = new THREE.Texture(canvas); tex.needsUpdate = true;

  flashMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    MAX_FLASHES
  );
  flashMesh.frustumCulled = false;
  flashMesh.count = flashActiveCap;
  _dFlash = new THREE.Object3D();
  scene.add(flashMesh);
}

function setFlash(idx, x, y, z, intensity) {
  _dFlash.position.set(x, y, z);
  _dFlash.quaternion.copy(camera.quaternion);
  _dFlash.scale.setScalar(0.22 * intensity);
  _dFlash.updateMatrix();
  flashMesh.setMatrixAt(idx, _dFlash.matrix);
}

// nasconde le istanze non usate in questo frame
function finalizeFlashes() {
  if (!flashMesh) return;
  _dFlash.position.set(0, -999, 0);
  _dFlash.scale.setScalar(0.0001);
  _dFlash.updateMatrix();
  for (let i = flashCursor; i < flashActiveCap; i++) flashMesh.setMatrixAt(i, _dFlash.matrix);
  flashMesh.instanceMatrix.needsUpdate = true;
}

// ==================== APPLICAZIONE BUDGET/QUALITA' AI POOL EFFETTI ====================
// Un solo punto che traduce "quanto budget abbiamo ora" (dati reali della
// battaglia * eventuale derate dell'adaptive quality) nei cap attivi di ogni
// pool. I pool restano allocati al loro tetto assoluto (MAX_*): qui si tocca
// solo `.count` (economico, nessuna riallocazione GPU) e i cap usati da
// spawn/update per decidere quante istanze considerare.
let effectScale = 1;
function applyEffectCaps(scale) {
  effectScale = Math.max(0.35, Math.min(1, scale));
  const nextTracerCap = Math.max(6, Math.round(MAX_TRACERS * effectScale));
  const nextExplCap = Math.max(4, Math.round(MAX_EXPLOSIONS * effectScale));
  const nextShellCap = Math.max(3, Math.round(MAX_SHELLS * effectScale));
  const nextFlashCap = Math.max(12, Math.round(MAX_FLASHES * effectScale));

  // Se un cap CRESCE, gli slot appena "riattivati" potrebbero portarsi dietro
  // uno stato stantio (life > 0 ma mai aggiornato mentre erano fuori dal cap
  // precedente): azzerarli evita un lampo/tracciante fantasma alla riespansione.
  if (tracerData.length) {
    for (let i = tracerActiveCap; i < nextTracerCap; i++) tracerData[i].life = 0;
  }
  if (explData.length) {
    for (let i = explActiveCap; i < nextExplCap; i++) { explData[i].life = 0; explData[i].hidden = true; }
  }
  // Se un cap CALA, i colpi/pool gia' attivi oltre il nuovo limite vanno
  // spenti esplicitamente (i loro Mesh/Line restano nella scena finche' non
  // li si nasconde, a differenza degli InstancedMesh dove basta `.count`).
  for (let i = nextShellCap; i < shells.length; i++) {
    const s = shells[i];
    if (s && s.active) { s.active = false; s.head.visible = false; s.line.visible = false; }
  }

  tracerActiveCap = nextTracerCap;
  explActiveCap = nextExplCap;
  shellActiveCap = nextShellCap;
  flashActiveCap = nextFlashCap;

  if (tracerMesh) tracerMesh.count = tracerActiveCap;
  if (explMesh) explMesh.count = explActiveCap;
  if (flashMesh) flashMesh.count = flashActiveCap;
}

// Ondulazione del fronte: DEVE coincidere con quella del fragment shader del
// terreno (buildGround), altrimenti le truppe non si allineano con il confine
// colorato. Se cambi una, cambia anche l'altra.
function frontWobble(z) {
  return Math.sin(z * 0.55) * 0.9 + Math.sin(z * 1.7) * 0.35;
}
function frontAt(z) { return wallX + frontWobble(z); }

// ==================== SIMULAZIONE DI COMBATTIMENTO ====================
// Prima ogni soldato era fermo a una frazione fissa `u` tra retrovia e fronte,
// con solo un piccolo "bob" verticale: la scena sembrava statica. Ora ogni
// unita' ha una macchina a stati (avanza → combatte → ripiega / cade →
// rinforzo) e la spinta complessiva del lato dipende dal momentum reale dei
// dati, quindi il fronte si vede contendere.

const S_ADVANCE = 0, S_FIGHT = 1, S_RETREAT = 2, S_DOWN = 3;
// Sotto questa soglia il movimento non e' percettibile e la matrice d'istanza
// non viene riscritta.
const MOVE_EPS = 0.001;

// u = 0 retrovia, 1 fronte. La distribuzione e' fortemente sbilanciata verso
// il fronte (u^4): prima era uniforme su 0..0.75 e i soldati risultavano
// sparpagliati su tutto il campo invece di formare una linea.
function makeSoldier(spreadZ) {
  const u0 = 0.78 + Math.pow(Math.random(), 3) * 0.22;
  return {
    u: u0,
    // uPrev/u sono i due estremi dell'ultimo tick di simulazione (SIM_HZ,
    // vedi runSimulationTick): il render interpola tra loro ad ogni frame
    // (displayU in layoutSoldierGroup) cosi' il movimento resta fluido a
    // 60/120fps anche se la logica di stato avanza solo ~20 volte al secondo.
    uPrev: u0,
    z: (Math.random() - 0.5) * MAP_D * spreadZ,
    zDrift: (Math.random() - 0.5) * 0.25,
    phase: Math.random() * Math.PI * 2,
    jitter: (Math.random() - 0.5) * 0.5,
    speed: 0.035 + Math.random() * 0.045,
    state: Math.random() < 0.45 ? S_FIGHT : S_ADVANCE,
    stateT: Math.random() * 2,
    fightU: 0.972 + Math.random() * 0.028, // ingaggio a ridosso del fronte
    fire: Math.random() * 2,               // cooldown di fuoco
    flash: 0,                              // intensita' vampa di sparo
    fallen: 0,                             // 0..1 quanto e' a terra
    scale: 1,                              // assegnata in makeNationGroup (i % 7)
    px: 1e9, py: 1e9, pz: 1e9, pt: 1e9,    // ultima posa scritta (dirty check)
  };
}

function makeVehicleUnit(spreadZ, uMax, type = 'jeep') {
  const u0 = 0.8 + Math.pow(Math.random(), 2) * 0.2;
  return {
    type,
    u: u0,
    uPrev: u0, // vedi nota in makeSoldier: interpolato a render-rate tra i tick di simulazione
    z: (Math.random() - 0.5) * MAP_D * spreadZ,
    phase: Math.random() * Math.PI * 2,
    jitter: (Math.random() - 0.5) * 0.5,
    speed: 0.022 + Math.random() * 0.03,
    uMax,
    state: S_ADVANCE,
    stateT: Math.random() * 3,
    fire: Math.random() * 4,
    flash: 0,
    // stessa idea del dirty-check dei soldati (px/py/pz/pt): sotto soglia
    // MOVE_EPS la matrice non viene ricomposta ne' ricaricata in GPU.
    px: 1e9, py: 1e9, pz: 1e9, pt: 1e9,
  };
}

// push > 0 : questo lato sta guadagnando terreno (piu' unita' avanzano)
// push < 0 : sta cedendo (piu' unita' ripiegano)
function stepSoldier(d, dt, push) {
  d.stateT -= dt;
  d.fire -= dt;
  if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 6);

  switch (d.state) {
    case S_ADVANCE:
      d.u += d.speed * dt * (1 + push * 0.8);
      if (d.u >= d.fightU) { d.u = d.fightU; d.state = S_FIGHT; d.stateT = 1.5 + Math.random() * 3; }
      break;

    case S_FIGHT:
      // oscillazione ravvicinata sulla linea di contatto, spinta in avanti
      // o indietro dal momentum: un lato che sta guadagnando si vede
      // davvero premere oltre la linea di contatto nominale, uno che sta
      // perdendo arretra leggermente ancora prima di rompere in ritirata.
      d.u = d.fightU + push * 0.02 + Math.sin(d.stateT * 4 + d.phase) * 0.012;
      if (d.fire <= 0) {
        d.flash = 1;
        // Rallentata ancora su richiesta.
        d.fire = 0.9 + Math.random() * 2.2;
      }
      if (d.stateT <= 0) {
        const r = Math.random();
        // la probabilita' di cadere/ripiegare sale quando il lato sta perdendo
        const lossChance = 0.16 - push * 0.12;
        if (r < lossChance) { d.state = S_DOWN; d.stateT = 1.6 + Math.random() * 2.2; }
        else if (r < lossChance + 0.22 - push * 0.15) { d.state = S_RETREAT; d.stateT = 1 + Math.random() * 2; }
        else { d.stateT = 1.5 + Math.random() * 3; }
      }
      break;

    case S_RETREAT:
      // ripiegamento corto, restano nella fascia di trincea. Piu' rapido
      // quanto piu' il lato sta perdendo momentum (push molto negativo):
      // una ritirata sotto pressione si vede, non e' solo un rientro fiacco.
      d.u -= d.speed * dt * (0.8 + Math.max(0, -push) * 0.9);
      if (d.stateT <= 0 || d.u <= 0.86) {
        d.u = Math.max(0.86, d.u);
        d.state = S_ADVANCE;
      }
      break;

    case S_DOWN:
      d.fallen = Math.min(1, d.fallen + dt * 4);
      if (d.stateT <= 0) {
        // rimpiazzo: rientra come rinforzo fresco dalla retrovia
        d.fallen = 0;
        d.u = 0.8 + Math.random() * 0.12;  // rinforzo dalle retrovie vicine
        d.z = d.z + (Math.random() - 0.5) * 2;
        d.state = S_ADVANCE;
        d.fightU = 0.972 + Math.random() * 0.028;
      }
      break;
  }

  if (d.state !== S_DOWN && d.fallen > 0) d.fallen = Math.max(0, d.fallen - dt * 3);

  // leggera deriva laterale, cosi' la linea non resta un muro perfetto
  d.z += Math.sin(d.stateT * 0.7 + d.phase) * d.zDrift * dt * 0.5;
  d.z = Math.max(-MAP_D * 0.48, Math.min(MAP_D * 0.48, d.z));
  d.u = Math.max(0, Math.min(1, d.u));
}

function stepVehicle(d, dt, push) {
  d.stateT -= dt;
  d.fire -= dt;
  if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 5);

  if (d.state === S_ADVANCE) {
    d.u += d.speed * dt * (1 + push);
    if (d.u >= d.uMax) { d.u = d.uMax; d.state = S_FIGHT; d.stateT = 3 + Math.random() * 4; }
  } else if (d.state === S_FIGHT) {
    if (d.fire <= 0) { d.flash = 1; d.fire = 3.8 + Math.random() * 5; }
    if (d.stateT <= 0) {
      if (Math.random() < 0.3 - push * 0.2) { d.state = S_RETREAT; d.stateT = 2 + Math.random() * 2; }
      else d.stateT = 3 + Math.random() * 4;
    }
  } else {
    d.u -= d.speed * dt * 0.7;
    if (d.stateT <= 0 || d.u <= 0.72) { d.u = Math.max(0.72, d.u); d.state = S_ADVANCE; }
  }
  d.u = Math.max(0, Math.min(d.uMax, d.u));
}

// ==================== TICK DI SIMULAZIONE (frequenza fissa) ====================
// Architettura: API -> Battle State -> Simulation ~20Hz -> Interpolation ->
// Render 60/120fps. Il polling (POLL_MS) resta indipendente da questo: qui si
// parla del secondo stadio, l'avanzamento della macchina a stati di ogni
// singola unita' (stepSoldier/stepVehicle), che PRIMA girava una volta per
// ogni frame di render (fino a 120 volte al secondo su schermi ad alto
// refresh) ed e' il costo CPU per-unita' piu' ripetuto di tutta la scena
// (branch di stato, Math.random(), trig). Ora avanza a un ritmo fisso e
// molto piu' basso; il render (layoutSoldierGroup/layoutVehicles) interpola
// la sola posizione (uPrev -> u) per restare visivamente fluido a qualunque
// framerate. Se il tab resta indietro (tab in background, GC lungo...) il
// numero di tick per frame e' limitato per evitare la "spirale della morte".
const SIM_HZ_FULL = 20;
// Simulazione a frequenza variabile: se il fronte e' fermo (momentum vicino a
// zero) per un po', la frequenza scende a 8-10Hz — le posizioni interpolate a
// render-time (alpha) restano comunque fluide, solo la FSM/trig sottostante
// avanza meno spesso. Torna a piena frequenza IMMEDIATAMENTE (nessun ritardo)
// appena il momentum si risveglia, cosi' un cambio di ritmo non si "vede" mai
// in ritardo sull'azione vera.
const SIM_HZ_IDLE = 9;
const SIM_IDLE_MOMENTUM = 0.025;  // sotto questa soglia il fronte e' considerato fermo
const SIM_IDLE_HOLD_MS = 4000;    // quanto deve restare fermo prima di rallentare
const SIM_DT = 1 / SIM_HZ_FULL;   // usato come default/fallback (es. reset)
const SIM_MAX_STEPS_PER_FRAME = 4;
let simAccum = 0;
let simHz = SIM_HZ_FULL;
let simIdleSince = 0;

function tickGroupSim(groups, sign, dt, push) {
  for (const g of groups) {
    const inf = g.data;
    for (let i = 0; i < inf.length; i++) {
      const d = inf[i];
      d.uPrev = d.u;
      stepSoldier(d, dt, push);
    }
    const jeeps = g.jeepData, tanks = g.tankData;
    for (let i = 0; i < jeeps.length; i++) {
      const d = jeeps[i];
      d.uPrev = d.u;
      stepVehicle(d, dt, push);
    }
    for (let i = 0; i < tanks.length; i++) {
      const d = tanks[i];
      d.uPrev = d.u;
      stepVehicle(d, dt, push);
    }
  }
}

// Chiamata dal render loop con l'accumulator: avanza la simulazione di zero,
// uno o piu' step da `dt` secondi (SIM_HZ_FULL o SIM_HZ_IDLE a seconda del
// momentum, vedi updateSimHz in renderLoop), in modo che lo stato avanzi
// sempre alla stessa VELOCITA' REALE indipendentemente dalla frequenza a cui
// gira in quel momento (dt piu' grande a Hz piu' basso compensa i tick piu'
// radi, cosi' il fronte non rallenta percettibilmente quando si abbassa Hz).
function runSimulationTick(drive, dt) {
  tickGroupSim(defenderGroups, -1, dt, drive);
  tickGroupSim(attackerGroups, 1, dt, -drive);
}

// Decide se la simulazione deve girare a piena frequenza o rallentata, in
// base al momentum reale (lastMomentum, aggiornato ad ogni poll) e non a un
// valore per-frame rumoroso. Nessuna isteresi nel risveglio: il ritorno a
// SIM_HZ_FULL e' istantaneo appena il momentum supera la soglia.
function updateSimHz(nowMs) {
  const momentumFactorLive = Math.abs(lastMomentum?.balance || 0);
  if (momentumFactorLive < SIM_IDLE_MOMENTUM) {
    if (!simIdleSince) simIdleSince = nowMs;
    if (nowMs - simIdleSince > SIM_IDLE_HOLD_MS) simHz = SIM_HZ_IDLE;
  } else {
    simIdleSince = 0;
    simHz = SIM_HZ_FULL;
  }
}

// ==================== GEOMETRIE UNITA' ====================
// Soldati minuscoli (un solo mesh per uomo): a questa scala il dettaglio non
// si vede e servono migliaia di istanze, quindi niente torso+testa+fucile
// separati come prima — un solo InstancedMesso per nazione.
// Soldato composto da corpo + testa + fucile, tutti InstancedMesh: con
// TROOPS_PER_SIDE ridotto a 280 il costo e' sostenibile e le unita' non sono
// piu' semplici parallelepipedi.
const soldierBodyGeo = () => new THREE.BoxGeometry(0.12, 0.22, 0.10);
const soldierHeadGeo = () => new THREE.SphereGeometry(0.05, 4, 3);
const soldierRifleGeo = () => new THREE.CylinderGeometry(0.01, 0.01, 0.15);

// Fonde corpo+testa+fucile (posa fissa, non piu' animata separatamente) in UNA
// sola BufferGeometry, applicando a ciascuna parte una matrice di offset
// locale "cotta" dentro le posizioni. Niente BufferGeometryUtils (altro CDN
// da tenere allineato in versione, come OrbitControls sopra): basta
// concatenare a mano gli attributi position/normal.
// Alla scala quasi zenitale di questo campo (soldati grandi pochi pixel) la
// mira indipendente del fucile e il bob separato della testa non si vedono:
// il muzzle flash (pool a parte, invariato) resta il segnale di "sta
// sparando". In cambio: 1 InstancedMesh invece di 3 -> un terzo delle
// matrici da comporre e caricare in GPU ad ogni frame per la categoria di
// istanze piu' numerosa di tutta la scena.
function mergeLocalGeometries(parts) {
  let vertCount = 0;
  parts.forEach(p => { vertCount += p.geometry.attributes.position.count; });
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nMat = new THREE.Matrix3();
  let offset = 0;
  for (const { geometry, matrix } of parts) {
    nMat.getNormalMatrix(matrix);
    const pos = geometry.attributes.position, nor = geometry.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      positions[(offset + i) * 3] = v.x;
      positions[(offset + i) * 3 + 1] = v.y;
      positions[(offset + i) * 3 + 2] = v.z;
      n.fromBufferAttribute(nor, i).applyMatrix3(nMat).normalize();
      normals[(offset + i) * 3] = n.x;
      normals[(offset + i) * 3 + 1] = n.y;
      normals[(offset + i) * 3 + 2] = n.z;
    }
    offset += pos.count;
    geometry.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}
// Offset locali, nel sistema di riferimento del soldato PRIMA della
// rotazione "facing" (quella viene applicata una volta sola all'istanza
// intera a runtime, quindi non va ricalcolata qui): testa sopra il corpo,
// fucile imbracciato di traverso sul fianco, in una posa fissa plausibile.
// A questa scala (cilindro di raggio 0.01) e' un accessorio da poche decine
// di pixel: non serve replicare l'angolo esatto della vecchia animazione
// "aiming" per-frame, basta leggersi come "soldato con fucile" in silhouette.
const soldierGeo = () => mergeLocalGeometries([
  { geometry: soldierBodyGeo(), matrix: new THREE.Matrix4() },
  { geometry: soldierHeadGeo(), matrix: new THREE.Matrix4().makeTranslation(0, 0.15, 0) },
  { geometry: soldierRifleGeo(), matrix: new THREE.Matrix4()
      .makeRotationX(Math.PI / 2.6)
      .setPosition(0.07, 0.05, 0.02) },
]);

// Fonde le nazioni in UN SOLO InstancedMesh di fanteria per lato invece di un
// mesh per nazione: con MAX_NATIONS_PER_SIDE nazioni per lato erano fino a
// MAX_NATIONS_PER_SIDE draw call solo per i soldati (il grosso delle istanze
// della scena) proprio nelle battaglie con piu' nazioni, che sono quelle piu'
// costose oggi. Il materiale usa vertexColors: ogni nazione riceve un range
// contiguo di indici nel pool e il suo colore viene scritto per-istanza con
// setColorAt/instanceColor, non piu' con un materiale dedicato per nazione.
// Capacita' fissata al tetto assoluto (TROOPS_PER_SIDE_ABS_MAX): si usa poi
// `.count` per mostrare solo le istanze davvero occupate (vedi applySide).
function buildSharedBodyMesh() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.7, metalness: 0.05,
    emissive: 0x332211, emissiveIntensity: 0.35,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(soldierGeo(), mat, TROOPS_PER_SIDE_ABS_MAX);
  mesh.frustumCulled = false;
  // Ombra disattivata: stesso motivo di sempre, la fanteria a questa scala
  // non proietta un'ombra percepibile e il depth-pass costa comunque.
  mesh.castShadow = false;
  mesh.count = 0; // nessuna nazione ancora assegnata
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TROOPS_PER_SIDE_ABS_MAX * 3), 3);
  return mesh;
}

function buildSharedBodyPools() {
  bodyMeshDef = buildSharedBodyMesh();
  bodyMeshAtk = buildSharedBodyMesh();
  scene.add(bodyMeshDef, bodyMeshAtk);
}

// Mezzi: piccoli blocchi riconoscibili dall'alto
// Mezzi: chiaramente piu' grandi della fanteria, altrimenti dall'alto
// sparivano come puntini scuri indistinguibili dai soldati.
const jeepBodyGeo = () => new THREE.BoxGeometry(0.8, 0.2, 0.42);
const jeepCabGeo = () => new THREE.BoxGeometry(0.34, 0.22, 0.38);
const tankHullGeo = () => new THREE.BoxGeometry(1.25, 0.26, 0.7);
const tankTurretGeo = () => new THREE.BoxGeometry(0.6, 0.24, 0.5);
// La canna e' un cilindro (asse Y di default): viene pre-ruotata di -90° su Z
// UNA VOLTA in fase di creazione, cosi' il suo asse lungo e' gia' allineato a
// X (la direzione di marcia/mira). A runtime basta poi una singola rotazione
// su Y pari a "facing" per farla puntare avanti o indietro — stesso schema
// gia' usato per lo scafo, niente piu' composizioni X+Y+Z che mandavano la
// canna dalla parte sbagliata.
const tankBarrelGeo = () => {
  const g = new THREE.CylinderGeometry(0.05, 0.06, 0.95, 6);
  g.rotateZ(-Math.PI / 2);
  return g;
};
// Artiglieria: affusto (Box) + canna (Cylinder), stesso trattamento del
// cilindro della canna del carro (pre-ruotato, asse lungo = X).
const artyBaseGeo = () => new THREE.BoxGeometry(0.7, 0.24, 0.62);
const artyBarrelGeo = () => {
  const g = new THREE.CylinderGeometry(0.045, 0.06, 1.15, 6);
  g.rotateZ(-Math.PI / 2);
  return g;
};

// Composizione dell'esercito in base al peso della nazione sul danno del suo
// lato. Mix volutamente leggero: pochi mezzi ben visibili invece di decine di
// puntini. L'artiglieria segue la stessa scala ma resta sempre in retrovia.
// Soglie di comparsa, ricavate dagli arrotondamenti di computeUnitMix:
//   jeeps = round(share*4)   >= 1  ->  share >= 0.125
//   arty  = round(share*3)   >= 1  ->  share >= 0.1667
//   tanks = round(share*2.5) >= 1  ->  share >= 0.20
// Erano costanti separate (TIER_JEEP/TIER_TANK) rimaste orfane dopo la
// riscrittura del mix: tenerle derivate qui evita che divergano di nuovo.
const TIER_JEEP = 0.125;
const TIER_ARTY = 1 / 6;
const TIER_TANK = 0.20;

function computeUnitMix(share, troopCount) {
  const jeeps = Math.min(2, Math.round(share * 4));
  const tanks = Math.min(1, Math.round(share * 2.5));
  const arty = Math.min(2, Math.round(share * 3));
  // Il pavimento "non far sparire una nazione minore" e' gia' gestito a monte
  // da distributeTroopCounts (budget-aware, vedi applySide): qui basta un
  // pavimento di sicurezza minimo, altrimenti (come prima, con un fisso 40)
  // il totale per lato potrebbe superare il budget deciso dai dati reali.
  const infantry = Math.max(8, troopCount - jeeps * 2 - tanks * 4 - arty * 3);
  return { infantry, jeeps, tanks, arty };
}

function disposeNationGroup(g) {
  Object.values(g.mesh).forEach(m => {
    // Il pool di fanteria (mesh.body) e' CONDIVISO dal lato intero
    // (bodyMeshDef/bodyMeshAtk): non va mai disposto/rimosso qui, solo i
    // mezzi (jeep/carri/artiglieria), che restano per-nazione.
    if (!m || m === bodyMeshDef || m === bodyMeshAtk) return;
    m.geometry.dispose();
    m.material.dispose();
    scene.remove(m);
  });
  if (g.flag) {
    scene.remove(g.flag.pole, g.flag.plane, g.flag.board);
    flagBillboards = flagBillboards.filter(f => f !== g.flag.plane);
  }
}

function createFlagTexture(imgUrl, fallbackColorHex) {
  const tex = new THREE.Texture();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { tex.image = img; tex.needsUpdate = true; };
  img.onerror = () => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `#${new THREE.Color(fallbackColorHex).getHexString()}`;
    ctx.fillRect(0, 0, 128, 80);
    tex.image = c; tex.needsUpdate = true;
  };
  img.src = imgUrl;
  return tex;
}

// Cartello di fazione in retrovia, in stile "insegna" come nella reference:
// pannello colorato col nome della nazione su un palo.
function makeSignTexture(name, colorHex) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  const col = `#${new THREE.Color(colorHex).getHexString()}`;
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 62px Sora, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = (name || '').slice(0, 16);
  ctx.fillText(label, 256, 70);
  const tex = new THREE.Texture(c);
  tex.needsUpdate = true;
  return tex;
}

function addFlagCamp(colorHex, flagUrl, x, z, name) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.035, 1.9, 5),
    new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.8 })
  );
  const gy = terrainHeight(x, z);
  pole.position.set(x, gy + 0.95, z);
  pole.castShadow = true;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.5),
    new THREE.MeshBasicMaterial({ map: createFlagTexture(flagUrl, colorHex), transparent: true, side: THREE.DoubleSide })
  );
  plane.position.set(x + 0.4, gy + 1.55, z);

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshBasicMaterial({ map: makeSignTexture(name, colorHex), transparent: true, side: THREE.DoubleSide })
  );
  board.position.set(x, gy + 2.35, z);

  scene.add(pole, plane, board);
  flagBillboards.push(plane, board);
  return { pole, plane, board };
}

// sharedBody: { mesh, offset } — range [offset, offset+infantry) nel pool di
// fanteria condiviso del lato (bodyMeshDef/bodyMeshAtk), assegnato da
// applySide. Sostituisce il vecchio InstancedMesh dedicato per nazione: il
// colore per-nazione viene scritto qui una tantum sul range con setColorAt,
// non serve piu' un materiale/mesh separato.
function makeNationGroup(nationInfo, mix, rearX, campZ, sharedBody) {
  const { infantry, jeeps, tanks, arty } = mix;
  // Lo scafo usa il colore della nazione proprietaria (nationInfo.colorHex),
  // non una variante derivata: prima il multiplyScalar lo scuriva al punto da
  // renderlo indistinguibile da quello avversario.
  const vehicleMat = new THREE.MeshStandardMaterial({
    color: nationInfo.colorHex, roughness: 0.5, metalness: 0.45,
  });
  const vehicleDarkMat = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.45, metalness: 0.55 });

  // Corpo+testa+fucile: NON piu' un InstancedMesh dedicato a questa nazione,
  // ma un range di istanze dentro il pool condiviso del lato. Il colore di
  // ciascuna istanza nel range viene scritto qui una volta sola (non ad ogni
  // frame): finche' la composizione non cambia, resta invariato.
  const bodyColor = new THREE.Color(nationInfo.colorHex);
  for (let i = 0; i < infantry; i++) sharedBody.mesh.setColorAt(sharedBody.offset + i, bodyColor);
  sharedBody.mesh.instanceColor.needsUpdate = true;

  const mesh = { body: sharedBody.mesh };

  if (jeeps > 0) {
    mesh.jeepBody = new THREE.InstancedMesh(jeepBodyGeo(), vehicleMat, jeeps);
    mesh.jeepCab = new THREE.InstancedMesh(jeepCabGeo(), vehicleDarkMat, jeeps);
  }
  if (tanks > 0) {
    mesh.tankHull = new THREE.InstancedMesh(tankHullGeo(), vehicleMat, tanks);
    mesh.tankTurret = new THREE.InstancedMesh(tankTurretGeo(), vehicleMat, tanks);
    mesh.tankBarrel = new THREE.InstancedMesh(tankBarrelGeo(), vehicleDarkMat, tanks);
  }
  if (arty > 0) {
    mesh.artyBase = new THREE.InstancedMesh(artyBaseGeo(), vehicleMat, arty);
    mesh.artyBarrel = new THREE.InstancedMesh(artyBarrelGeo(), vehicleDarkMat, arty);
  }

  // La fanteria (body/head/rifle) e' di gran lunga la piu' numerosa
  // (centinaia di istanze per nazione) e a quella scala minuscola l'ombra
  // proiettata e' quasi invisibile: NON proietta ombra (gia' impostato una
  // volta sola su bodyMeshDef/bodyMeshAtk in buildSharedBodyMesh). I mezzi
  // (jeep/carri/artiglieria), molto meno numerosi e visivamente piu' grandi,
  // restano a proiettare ombra. Il pool condiviso di fanteria e' gia' in
  // scena (aggiunto una sola volta in buildSharedBodyPools): qui si aggiungono
  // solo i mezzi, che restano per-nazione.
  Object.values(mesh).forEach(m => { if (m !== sharedBody.mesh) { m.castShadow = true; scene.add(m); } });

  // Scala variabile per rompere l'uniformita' delle istanze.
  const data = Array.from({ length: infantry }, (_, i) => {
    const sol = makeSoldier(0.96);
    sol.scale = 0.85 + (i % 7) * 0.05;
    return sol;
  });
  const jeepData = Array.from({ length: jeeps }, () => makeVehicleUnit(0.85, 0.85, 'jeep'));
  const tankData = Array.from({ length: tanks }, () => makeVehicleUnit(0.8, 0.85, 'tank'));
  // L'artiglieria non avanza mai: nasce gia' in S_FIGHT in retrovia.
  const artyData = Array.from({ length: arty }, () => {
    const u = makeVehicleUnit(0.7, 0.85, 'arty');
    u.state = S_FIGHT;
    u.fire = Math.random() * 3;
    return u;
  });

  const flag = addFlagCamp(nationInfo.signColor ?? nationInfo.colorHex, nationInfo.flagUrl, rearX, campZ, nationInfo.name);

  return { ...nationInfo, mesh, data, jeepData, tankData, artyData, mix, flag, rearX, bodyOffset: sharedBody.offset };
}

let _dTorso, _dVeh;

// Corpo+testa+fucile sono ormai un'unica geometria fusa (soldierGeo): un
// solo updateMatrix()/setMatrixAt() per soldato per frame invece di tre.
// La "posa" (chino in caduta, teso in avanzata) e' un'unica rotazione
// rigida X applicata a tutta la sagoma, non piu' scomposta parte per parte.
function layoutSoldierGroup(group, wallX, sign, dt, push, alpha) {
  const { body } = group.mesh;
  const facing = sign > 0 ? Math.PI : 0;
  const rearX = group.rearX;
  const t = performance.now() * 0.001;
  const cosF = Math.cos(facing), sinF = Math.sin(facing);
  const data = group.data;
  const n = data.length;
  const bodyOffset = group.bodyOffset;
  let dirty = false;

  for (let i = 0; i < n; i++) {
    const d = data[i];
    // La macchina a stati (stepSoldier) NON gira piu' qui: avanza a parte, a
    // ritmo fisso SIM_HZ, dentro runSimulationTick(). Qui, ad ogni frame di
    // render, si interpola solo la posizione (du) tra l'ultimo e il
    // penultimo valore simulato di u, cosi' il movimento resta fluido a
    // 60/120fps senza ripetere stato/trig/random per ogni soldato ad ogni frame.
    const du = d.uPrev + (d.u - d.uPrev) * alpha;

    const edge = frontAt(d.z);
    const stop = edge - sign * 0.3;
    let x = rearX + (stop - rearX) * du + d.jitter * 0.18;
    x = sign < 0 ? Math.min(x, stop) : Math.max(x, stop);
    x = sign < 0 ? Math.max(x, rearX) : Math.min(x, rearX);

    const fallen = d.fallen;
    const moving = d.state === S_ADVANCE || d.state === S_RETREAT;
    // LOD legato allo zoom (lodFineDetail, ricalcolato una volta per frame in
    // renderLoop dalla distanza camera-target): a inquadratura larga il bob/lean
    // per-soldato non si vede comunque (gia' il motivo per cui non e' mai
    // stata replicata l'animazione "aiming" separata, vedi soldierGeo) e
    // saltare i trig qui sotto riduce sia il costo CPU sia le probabilita'
    // che il dirty-check MOVE_EPS sotto scatti per un movimento invisibile.
    let bob = 0, lean = 0;
    if (lodFineDetail) {
      const stride = moving ? Math.sin(t * 9 + d.phase) : Math.sin(t * 3 + d.phase);
      bob = moving ? Math.abs(stride) * 0.04 : stride * 0.015;
      lean = moving ? (d.state === S_ADVANCE ? 0.14 : -0.12) : Math.sin(t * 5 + d.phase) * 0.06;
    }

    const gy = terrainHeight(x, d.z);
    const y = gy + (0.14 + bob) * (1 - fallen) + 0.05 * fallen;
    const tilt = lean * (1 - fallen) + (Math.PI / 2) * fallen;
    const scale = d.scale;

    // Aggiorna la matrice solo se il soldato si e' mosso in modo percettibile:
    // sotto soglia l'istanza resta invariata e si evita di ricaricare
    // l'intero instanceMatrix sulla GPU.
    if (Math.abs(x - d.px) < MOVE_EPS &&
        Math.abs(y - d.py) < MOVE_EPS &&
        Math.abs(d.z - d.pz) < MOVE_EPS &&
        Math.abs(tilt - d.pt) < MOVE_EPS) {
      continue;
    }
    d.px = x; d.py = y; d.pz = d.z; d.pt = tilt;
    dirty = true;

    _dTorso.position.set(x, y, d.z);
    _dTorso.rotation.set(tilt, facing, 0);
    _dTorso.scale.setScalar(scale);
    _dTorso.updateMatrix();
    body.setMatrixAt(bodyOffset + i, _dTorso.matrix);

    if (d.flash > 0.55) {
      if (flashCursor < flashActiveCap) {
        setFlash(flashCursor++, x - cosF * 0.22, y + 0.08, d.z - sinF * 0.22, d.flash * 0.55);
      }
      if (d.flash > 0.9) spawnTracer(x - cosF * 0.24, y + 0.08, d.z - sinF * 0.24, sign);
    }
  }

  if (dirty) body.instanceMatrix.needsUpdate = true;

  layoutVehicles(group, wallX, facing, dt, push, sign, alpha);
}

function layoutVehicles(group, wallX, facing, dt, push, sign, alpha) {
  const rearX = group.rearX;
  const t = performance.now() * 0.001;
  const { jeepBody, jeepCab, tankHull, tankTurret, tankBarrel } = group.mesh;

  if (jeepBody && group.jeepData.length) {
    let jeepDirty = false;
    for (let i = 0; i < group.jeepData.length; i++) {
      const d = group.jeepData[i];
      // stepVehicle avanza a ritmo fisso in runSimulationTick(); qui si
      // interpola solo la posizione, stesso schema della fanteria sopra.
      const du = d.uPrev + (d.u - d.uPrev) * alpha;
      const edge = frontAt(d.z);
      const stop = edge - sign * 1.1;   // i mezzi restano piu' arretrati
      let x = rearX + (stop - rearX) * du + d.jitter * 0.3;
      x = sign < 0 ? Math.min(x, stop) : Math.max(x, stop);
      const moving = d.state !== S_FIGHT;
      // Stesso LOD zoom-based della fanteria: a inquadratura larga niente
      // sway/pitch (illeggibili comunque a quella distanza).
      const sway = lodFineDetail ? Math.sin(t * (moving ? 5 : 1.6) + d.phase) * (moving ? 0.045 : 0.02) : 0;
      const pitch = lodFineDetail && moving ? Math.sin(t * 7 + d.phase) * 0.045 : 0;

      const gy = terrainHeight(x, d.z + sway);

      if (d.flash > 0.5 && flashCursor < flashActiveCap) {
        setFlash(flashCursor++, x - Math.cos(facing) * 0.4, gy + 0.35, d.z, d.flash);
      }

      // dirty-check identico a quello dei soldati: sotto soglia le due
      // matrici (scafo+cabina) non vengono ricomposte ne' ricaricate.
      if (Math.abs(x - d.px) < MOVE_EPS && Math.abs(gy - d.py) < MOVE_EPS &&
          Math.abs(sway - d.pz) < MOVE_EPS && Math.abs(pitch - d.pt) < MOVE_EPS) {
        continue;
      }
      d.px = x; d.py = gy; d.pz = sway; d.pt = pitch;
      jeepDirty = true;

      _dVeh.position.set(x, gy + 0.2, d.z + sway);
      _dVeh.rotation.set(pitch, facing, 0);
      _dVeh.scale.setScalar(1);
      _dVeh.updateMatrix();
      jeepBody.setMatrixAt(i, _dVeh.matrix);

      _dVeh.position.set(x + Math.cos(facing) * -0.16, gy + 0.4, d.z + sway);
      _dVeh.updateMatrix();
      jeepCab.setMatrixAt(i, _dVeh.matrix);
    }
    if (jeepDirty) {
      jeepBody.instanceMatrix.needsUpdate = true;
      jeepCab.instanceMatrix.needsUpdate = true;
    }
  }

  // ── ARTIGLIERIA ──
  // Resta in retrovia rispetto alla fanteria ma DENTRO la mappa: rearX e'
  // gia' vicino al bordo campo (REAR_DEFENDER/REAR_ATTACKER, a soli 3 unita'
  // dall'edge), quindi l'arretramento va verso il CENTRO (rearX - sign*8),
  // non oltre il bordo (rearX + sign*8 mandava i pezzi fuori mappa). Il suo
  // fuoco e' collegato a launchShell(): niente simulazione separata, usa gli
  // stessi proiettili gia' presenti.
  const { artyBase, artyBarrel } = group.mesh;
  if (artyBase && group.artyData.length) {
    const artyX = group.rearX - sign * 8;
    let artyDirty = false;
    for (let i = 0; i < group.artyData.length; i++) {
      const d = group.artyData[i];
      d.state = S_FIGHT;
      d.fire -= dt;
      if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 4);
      if (d.fire <= 0) {
        d.flash = 1;
        // cadenza legata al momentum: piu' spinta, piu' fuoco di supporto.
        // Rallentata ancora su richiesta.
        d.fire = 5.4 - Math.min(2.2, Math.abs(push) * 2.4) + Math.random() * 3.2;
        launchShell(sign, artyX, d.z);
      }
      const recoil = d.flash * 0.3;
      const gy = terrainHeight(artyX, d.z);

      if (d.flash > 0.6 && flashCursor < flashActiveCap) {
        setFlash(flashCursor++, artyX + Math.cos(facing) * 0.9, gy + 0.7, d.z, d.flash * 2.6);
      }

      // Il pezzo non avanza mai (posizione fissa): tra un colpo e l'altro
      // l'unico valore che cambia e' il rinculo, quindi per gran parte del
      // tempo questo dirty-check azzera del tutto il costo di rendering.
      if (Math.abs(recoil - d.pt) < MOVE_EPS) continue;
      d.pt = recoil;
      artyDirty = true;

      _dVeh.position.set(artyX + Math.cos(facing) * recoil, gy + 0.22, d.z);
      _dVeh.rotation.set(0, facing, 0);
      _dVeh.scale.setScalar(1);
      _dVeh.updateMatrix();
      artyBase.setMatrixAt(i, _dVeh.matrix);

      // Stesso schema pulito del carro: geometria canna pre-ruotata (asse
      // lungo = X), quindi punta correttamente col solo "facing", con una
      // elevazione fissa via rotation.z (tiltZ, segno dipendente dal lato
      // cosi' punta sempre verso l'alto su entrambi i fronti).
      const tiltZ = -sign * 0.55;
      _dVeh.position.set(artyX + Math.cos(facing) * (0.45 - recoil), gy + 0.55, d.z);
      _dVeh.rotation.set(0, facing, tiltZ);
      _dVeh.updateMatrix();
      artyBarrel.setMatrixAt(i, _dVeh.matrix);
    }
    if (artyDirty) {
      artyBase.instanceMatrix.needsUpdate = true;
      artyBarrel.instanceMatrix.needsUpdate = true;
    }
  }

  if (tankHull && group.tankData.length) {
    let tankDirty = false;
    for (let i = 0; i < group.tankData.length; i++) {
      const d = group.tankData[i];
      // idem: avanzamento di stato gia' fatto a ritmo fisso, qui solo interpolazione
      const du = d.uPrev + (d.u - d.uPrev) * alpha;
      const edge = frontAt(d.z);
      const stop = edge - sign * 3.0;
      let x = rearX + (stop - rearX) * du + d.jitter * 0.35;
      x = sign < 0 ? Math.min(x, stop) : Math.max(x, stop);
      const recoil = d.flash * 0.22;
      const gy = terrainHeight(x, d.z);

      if (d.flash > 0.5 && flashCursor < flashActiveCap) {
        setFlash(flashCursor++, x + Math.cos(facing) * 1.15, gy + 0.6, d.z, d.flash * 2.2);
      }

      // d.z e' fisso per un carro (stepVehicle non lo tocca): x cambia solo
      // avanzando/ripiegando, recoil solo mentre spara. Fuori da questi due
      // eventi (la maggior parte del tempo) le tre matrici restano ferme.
      if (Math.abs(x - d.px) < MOVE_EPS && Math.abs(recoil - d.pt) < MOVE_EPS) continue;
      d.px = x; d.pt = recoil;
      tankDirty = true;

      _dVeh.position.set(x, gy + 0.26, d.z);
      _dVeh.rotation.set(0, facing, 0);
      _dVeh.scale.setScalar(1);
      _dVeh.updateMatrix();
      tankHull.setMatrixAt(i, _dVeh.matrix);

      // Torretta: nessuna oscillazione autonoma (meno trig per frame),
      // allineata allo scafo. La canna, con geometria pre-ruotata, punta
      // sempre correttamente verso il fronte grazie alla sola rotazione Y
      // ("facing"): niente piu' seconda rotazione su Z che la mandava dalla
      // parte sbagliata.
      _dVeh.position.set(x + Math.cos(facing) * recoil, gy + 0.52, d.z);
      _dVeh.rotation.set(0, facing, 0);
      _dVeh.updateMatrix();
      tankTurret.setMatrixAt(i, _dVeh.matrix);

      // tiltZ: leggera elevazione della canna, con segno dipendente dal lato
      // cosi' punta sempre un po' verso l'alto (non verso il basso) su
      // entrambi i fronti.
      const tiltZ = -sign * 0.12;
      _dVeh.position.set(x + Math.cos(facing) * (0.7 - recoil), gy + 0.55, d.z);
      _dVeh.rotation.set(0, facing, tiltZ);
      _dVeh.updateMatrix();
      tankBarrel.setMatrixAt(i, _dVeh.matrix);
    }
    if (tankDirty) {
      tankHull.instanceMatrix.needsUpdate = true;
      tankTurret.instanceMatrix.needsUpdate = true;
      tankBarrel.instanceMatrix.needsUpdate = true;
    }
  }
}

// Ricostruisce i gruppi truppe/mezzi/bandiere SOLO se cambia la composizione
// delle nazioni (le top MAX_NATIONS_PER_SIDE) o il loro "tier" di esercito
// (fanteria / +blindati / +carri): così un cambio di equilibrio nel danno si
// vede davvero sul campo, ma senza ricostruire le mesh ad ogni poll.
function tierOf(share) {
  if (share >= TIER_TANK) return 3;
  if (share >= TIER_ARTY) return 2;
  if (share >= TIER_JEEP) return 1;
  return 0;
}
function sideCompositionKey(top, total) {
  // Include un bucket grezzo di budgetScale (10 fasce): senza questo, un
  // cambio di budgetScale (battaglia che cresce/si placa) non farebbe MAI
  // ricalcolare i troop count finche' nazioni/tier restano gli stessi — che
  // e' esattamente lo scenario piu' comune (stessa battaglia che cresce nel
  // tempo). Il bucket e' grezzo apposta: piccole oscillazioni di budgetScale
  // non devono ricostruire le mesh ad ogni poll, solo i cambi che contano.
  const budgetBucket = Math.round(budgetScale * 10);
  return top.map(n => `${n.countryId}:${tierOf(n.totalDamage / (total || 1))}`).join(',') + `|b${budgetBucket}`;
}
let lastDefKey = '', lastAtkKey = '';

// Ripartisce il budget di fanteria del lato (TROOPS_PER_SIDE * budgetScale,
// vedi BUDGET DINAMICO) fra le nazioni in proporzione al loro danno, con un
// piccolo pavimento per non far sparire le nazioni minori — ma, a differenza
// di prima, il pavimento e' vincolato a non far MAI superare il budget totale
// del lato: prima ogni nazione aveva un minimo assoluto indipendente (fino a
// 3x80=240 istanze con 3 nazioni), che e' esattamente il tipo di crescita
// scoordinata che il pool condiviso (capacita' fissa, TROOPS_PER_SIDE_ABS_MAX)
// non puo' permettersi. Ritorna un array di interi che sommano al massimo al
// budget del lato.
function distributeTroopCounts(top, total, sideBudget) {
  const floor = Math.max(10, Math.round(sideBudget / (top.length * 2.2)));
  let counts = top.map(n => {
    const share = n.totalDamage / (total || 1);
    return Math.max(floor, Math.round(sideBudget * share));
  });
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum > sideBudget && sum > 0) {
    const k = sideBudget / sum;
    counts = counts.map(c => Math.max(8, Math.round(c * k)));
  }
  return counts;
}

function applySide(side, ranked, total, rearX) {
  const top = ranked.slice(0, MAX_NATIONS_PER_SIDE);
  const key = sideCompositionKey(top, total);
  const groups = side === 'defender' ? defenderGroups : attackerGroups;
  const lastKey = side === 'defender' ? lastDefKey : lastAtkKey;

  if (key === lastKey && groups.length) {
    // stessa composizione e stessi tier: le posizioni dipendono da u
    // individuale, non dal peso, quindi non serve ricostruire nulla.
    return groups;
  }

  groups.forEach(disposeNationGroup);
  if (!top.length) {
    const bodyMesh = side === 'defender' ? bodyMeshDef : bodyMeshAtk;
    if (bodyMesh) bodyMesh.count = 0;
    if (side === 'defender') { defenderGroups = []; lastDefKey = key; }
    else { attackerGroups = []; lastAtkKey = key; }
    return [];
  }

  const bodyMesh = side === 'defender' ? bodyMeshDef : bodyMeshAtk;
  const sideBudget = Math.max(24, Math.min(TROOPS_PER_SIDE_ABS_MAX, Math.round(TROOPS_PER_SIDE * budgetScale)));
  const troopCounts = distributeTroopCounts(top, total, sideBudget);

  let cursor = 0;
  const newGroups = top.map((n, idx) => {
    const nation = getNation(n.countryId);
    const code = nation?.code?.toLowerCase() || '';
    const share = n.totalDamage / (total || 1);
    const troopCount = troopCounts[idx];
    const mix = computeUnitMix(share, troopCount);
    const campZ = (idx - (top.length - 1) / 2) * 7.5;
    const offset = cursor;
    cursor += mix.infantry;
    return makeNationGroup({
      countryId: n.countryId,
      name: nation?.name || n.countryId,
      code: code.toUpperCase(),
      colorHex: sideUnitColor(side, n.countryId, idx),
      signColor: nationColorHex(n.countryId),
      flagUrl: code ? `https://app.warera.io/images/map/${code}.png?v=21` : '',
    }, mix, rearX, campZ, { mesh: bodyMesh, offset });
  });

  // Solo le istanze davvero assegnate ad una nazione vengono renderizzate:
  // il resto del pool (fino a TROOPS_PER_SIDE_ABS_MAX) resta a costo zero.
  if (bodyMesh) bodyMesh.count = Math.min(cursor, TROOPS_PER_SIDE_ABS_MAX);

  if (side === 'defender') { defenderGroups = newGroups; lastDefKey = key; }
  else { attackerGroups = newGroups; lastAtkKey = key; }
  return newGroups;
}

// ==================== MINIMAPPA HEATMAP ====================
// Barra segmentata: a sinistra i difensori (ordinati per danno decrescente
// verso il centro), a destra gli attaccanti. La larghezza di ogni segmento
// è proporzionale al danno della nazione sul totale della battaglia, così
// la minimappa riflette sia lo split difesa/attacco sia il peso di ogni
// singola nazione — coerente con lo stesso dato usato dalla heatmap 2D.
function drawMinimap(defenderRanked, totalDef, attackerRanked, totalAtk) {
  if (!minimapCtx) return;
  const w = minimapCanvas.width, h = minimapCanvas.height;
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, w, h);

  // Sfondo base + cornice, sempre visibili anche a totale zero
  ctx.fillStyle = '#12151b';
  ctx.fillRect(0, 0, w, h);

  const totalAll = totalDef + totalAtk;
  minimapSegments = [];

  if (totalAll <= 0) {
    ctx.fillStyle = '#5a6578';
    ctx.font = `600 ${Math.round(h * 0.16)}px Sora, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NO DAMAGE RECORDED YET', w / 2, h / 2);
    return;
  }

  const defWidth = (totalDef / totalAll) * w;
  const MIN_LABEL_W = w * 0.055; // sotto questa larghezza il segmento è troppo stretto per il testo

  function drawSegment(n, x0, x1, side, sideTotal) {
    const segW = x1 - x0;
    const color = nationColorCss(n.countryId);
    const nation = getNation(n.countryId);
    const pct = totalAll > 0 ? (n.totalDamage / totalAll * 100) : 0;

    // Riempimento con leggero gradiente verticale per dare profondità
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, shadeColor(color, -0.28));
    ctx.fillStyle = grad;
    ctx.fillRect(x0, 0, segW, h);

    // Etichetta: codice nazione + percentuale, solo se il segmento è abbastanza largo
    if (segW >= MIN_LABEL_W) {
      const code = (nation?.code || '').toUpperCase();
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = `700 ${Math.round(h * 0.22)}px Sora, sans-serif`;
      ctx.fillText(code || '?', x0 + segW / 2 + 1, h * 0.42 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(code || '?', x0 + segW / 2, h * 0.42);
      ctx.font = `600 ${Math.round(h * 0.15)}px Sora, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(`${pct.toFixed(2)}%`, x0 + segW / 2, h * 0.72);
      ctx.restore();
    }

    minimapSegments.push({
      x0, x1, colorCss: color, damage: n.totalDamage, pctOfTotal: pct,
      pctOfSide: sideTotal > 0 ? n.totalDamage / sideTotal * 100 : 0,
      sideLabel: side === 'defender' ? '🛡️ Defender' : '⚔️ Attacker',
      name: nation?.name || n.countryId,
    });
  }

  // Difensori: dal centro verso sinistra, i più forti vicino al fronte (muro)
  let cursor = defWidth;
  defenderRanked.forEach(n => {
    const segW = totalAll > 0 ? (n.totalDamage / totalAll) * w : 0;
    drawSegment(n, cursor - segW, cursor, 'defender', totalDef);
    cursor -= segW;
  });

  // Attaccanti: dal centro verso destra
  cursor = defWidth;
  attackerRanked.forEach(n => {
    const segW = totalAll > 0 ? (n.totalDamage / totalAll) * w : 0;
    drawSegment(n, cursor, cursor + segW, 'attacker', totalAtk);
    cursor += segW;
  });

  // Bordi tra segmenti: più spessi e opachi. Il canvas è renderizzato a
  // risoluzione doppia rispetto allo spazio CSS (1200x150 vs ~600x110 a
  // schermo), quindi uno stroke "sottile" in coordinate canvas finiva quasi
  // invisibile a schermo. Ora è ben marcato indipendentemente dallo scaling.
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 4;
  minimapSegments.forEach(s => {
    ctx.beginPath(); ctx.moveTo(s.x1, 0); ctx.lineTo(s.x1, h); ctx.stroke();
  });

  // Linea del fronte (allineata al muro 3D): contorno bianco netto sotto il
  // glow dorato, così resta leggibile anche su segmenti chiari/dorati che
  // altrimenti la mimetizzerebbero.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(defWidth, 0);
  ctx.lineTo(defWidth, h);
  ctx.stroke();

  ctx.shadowColor = '#e8c97a';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#e8c97a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(defWidth, 0);
  ctx.lineTo(defWidth, h);
  ctx.stroke();
  ctx.restore();

  // Cornice esterna
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

// Scurisce/schiarisce un colore CSS di una frazione (-1..1)
function shadeColor(cssColor, amount) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = cssColor;
  const hex = c.fillStyle;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (amount < 0 ? v * amount : (255 - v) * amount))));
  return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
}

// NOTA: l'overlay colorato per-nazione a terra e' stato rimosso.
// Le fasce semitrasparenti sul terreno erano poco leggibili e sporcavano la
// scena; la stessa informazione (quota di danno per nazione) e' gia' resa in
// modo molto piu' chiaro dalla minimappa segmentata in basso e dalle liste HUD.

function tierIcon(share) {
  if (share >= TIER_TANK) return '🪖'; // fanteria + blindati + artiglieria + carri
  if (share >= TIER_ARTY) return '🎯'; // fanteria + blindati + artiglieria
  if (share >= TIER_JEEP) return '🚙'; // fanteria + blindati
  return '👤';                          // solo fanteria
}

function updateHudNationList(el, rankedTop, sideTotal, align) {
  el.innerHTML = rankedTop.map(n => {
    const nation = getNation(n.countryId);
    const name = nation?.name || n.countryId;
    const code = nation?.code?.toLowerCase() || '';
    const flagUrl = code ? `https://app.warera.io/images/map/${code}.png?v=21` : '';
    const share = sideTotal > 0 ? n.totalDamage / sideTotal : 0;
    const pct = share * 100;
    return `
      <div style="display:flex; align-items:center; gap:6px; ${align === 'right' ? 'flex-direction:row-reverse;' : ''}">
        ${flagUrl ? `<img src="${flagUrl}" title="${escapeHtml(name)}" style="height:13px; border-radius:2px;" onerror="this.style.display='none'">` : ''}
        <span style="color:#c9d1d9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:98px;">${escapeHtml(name)}</span>
        <span title="unità schierate">${tierIcon(share)}</span>
        <span style="color:#8892a4; font-variant-numeric:tabular-nums;">${pct.toFixed(2)}% · ${fmt(n.totalDamage)}</span>
      </div>`;
  }).join('');
}

// ==================== FETCH + STATO BATTAGLIA ====================
// Titolo (regione + nazioni) impostato una sola volta, alla prima fetch
// (fetchBattleWallData), che arriva in un unico POST batch insieme a
// ranking e dati live — non è più una richiesta separata.
function applyTitle(details) {
  if (!details) return;
  const atkNation = getNation(details?.attacker?.country);
  const defNation = getNation(details?.defender?.country);
  hudTitle.region.textContent = (details?.region || 'Battle').toUpperCase();
  hudTitle.match.innerHTML = `🛡️ ${escapeHtml(defNation?.name || 'Defender')} <span style="color:#5a6578; font-size:14px;">vs</span> ${escapeHtml(atkNation?.name || 'Attacker')} ⚔️`;
}

function formatRate(deltaPerSec) {
  if (deltaPerSec == null || deltaPerSec <= 0) return '';
  return `+${fmt(deltaPerSec)}/s`;
}


// ==================== ANALISI INERZIA ====================
// Tiene uno storico (timestamp, danno difensore, danno attaccante) e ne ricava:
//  - il ritmo di ciascun lato su una finestra scorrevole (regressione lineare,
//    piu' stabile della semplice differenza tra due poll consecutivi);
//  - chi sta guadagnando terreno, cioe' chi ha il ritmo maggiore ORA, che puo'
//    essere diverso da chi e' in vantaggio nel totale;
//  - il tempo stimato al sorpasso, se chi insegue sta recuperando.
// Finestra corta: 3 minuti rendevano il momentum lentissimo a reagire — un
// cambio di ritmo impiegava minuti a comparire. 45s con pesi esponenziali
// (meta' peso ogni HALF_LIFE_MS) reagisce in pochi secondi restando stabile.
const MOMENTUM_WINDOW_MS = 45000;
const MOMENTUM_HALF_LIFE_MS = 12000;
const MIN_SAMPLES = 2;
let damageHistory = [];

function pushDamageSample(totalDef, totalAtk) {
  const now = Date.now();
  damageHistory.push({ t: now, def: totalDef, atk: totalAtk });
  while (damageHistory.length && now - damageHistory[0].t > MOMENTUM_WINDOW_MS) {
    damageHistory.shift();
  }
}

// Pendenza (danno al secondo) via minimi quadrati PESATI: i campioni recenti
// contano di piu' (peso 0.5^(eta/HALF_LIFE)), cosi' un'accelerazione improvvisa
// si vede subito invece di essere diluita su tutta la finestra.
function slopePerSec(samples, key) {
  const n = samples.length;
  if (n < 2) return 0;
  const t0 = samples[0].t;
  const tEnd = samples[n - 1].t;
  let sw = 0, sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const s of samples) {
    const w = Math.pow(0.5, (tEnd - s.t) / MOMENTUM_HALF_LIFE_MS);
    const x = (s.t - t0) / 1000;
    const y = s[key];
    sw += w; sx += w * x; sy += w * y; sxy += w * x * y; sxx += w * x * x;
  }
  const denom = sw * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (sw * sxy - sx * sy) / denom;
}

function computeMomentum(totalDef, totalAtk) {
  const samples = damageHistory;
  const spanSec = samples.length >= 2 ? (samples[samples.length - 1].t - samples[0].t) / 1000 : 0;
  if (samples.length < MIN_SAMPLES || spanSec < 3) {
    return { ready: false, spanSec };
  }

  const rateDef = Math.max(0, slopePerSec(samples, 'def'));
  const rateAtk = Math.max(0, slopePerSec(samples, 'atk'));

  const leader = totalDef >= totalAtk ? 'defender' : 'attacker';
  const lead = Math.abs(totalDef - totalAtk);
  const leadRate = leader === 'defender' ? rateDef : rateAtk;
  const trailRate = leader === 'defender' ? rateAtk : rateDef;
  const gain = trailRate - leadRate;   // >0 = chi insegue sta recuperando

  // Tempo al sorpasso: distacco diviso il ritmo di recupero. Ha senso solo se
  // il recupero e' significativo (>0.5% del ritmo del leader) e la finestra
  // temporale e' abbastanza lunga da non amplificare il rumore.
  let etaSec = null;
  if (gain > 0 && gain > leadRate * 0.005 && lead > 0) {
    etaSec = lead / gain;
    if (etaSec > 86400) etaSec = null;   // oltre 24h non e' un'informazione utile
  }

  // Indice di inerzia -1..1: quota del ritmo totale presa da ciascun lato.
  const rateSum = rateDef + rateAtk;
  const balance = rateSum > 0 ? (rateDef - rateAtk) / rateSum : 0;

  return {
    ready: true, spanSec, rateDef, rateAtk,
    leader, lead, trailer: leader === 'defender' ? 'attacker' : 'defender',
    gain, etaSec, balance,
  };
}

function fmtDuration(sec) {
  if (sec == null) return '';
  if (sec < 90) return `${Math.round(sec)}s`;
  const m = sec / 60;
  if (m < 90) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 36) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

let lastMomentum = null;
let momentumAt = 0;

// Bagliore della card momentum: colore + intensita' cambiano col segno e la
// forza dello squilibrio, cosi' lo stato della battaglia si percepisce anche
// senza leggere il testo.
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function setMomentumGlow(colorHex, intensity) {
  if (!hudMomentumCard) return;
  const rgb = hexToRgb(colorHex);
  hudMomentumCard.style.boxShadow =
    `0 0 0 1px rgba(255,255,255,0.03), 0 8px 30px rgba(0,0,0,.4), 0 0 ${28 * intensity}px rgba(${rgb},${intensity})`;
  hudMomentumCard.style.borderColor = `rgba(${rgb},${Math.min(0.6, 0.25 + intensity * 0.5)})`;
}

// Chiamata ad ogni poll: ricalcola i ritmi e memorizza l'istante.
function updateMomentumHud(totalDef, totalAtk) {
  if (!hudMom.fill) return;
  const m = computeMomentum(totalDef, totalAtk);
  lastMomentum = m.ready ? m : null;
  momentumAt = Date.now();
  renderMomentumHud();
}

// Chiamata ad OGNI FRAME dal render loop: fra un poll e l'altro il distacco e
// il tempo al sorpasso vengono estrapolati dai ritmi misurati, cosi' i numeri
// scorrono di continuo invece di scattare una volta ogni POLL_MS.
function renderMomentumHud() {
  if (!hudMom.fill) return;
  const m = lastMomentum;

  if (!m) {
    hudMom.window.textContent = 'gathering data…';
    hudMom.fill.style.width = '0%';
    hudMom.label.textContent = 'MEASURING MOMENTUM';
    hudMom.label.style.color = '#5a6578';
    hudMom.eta.textContent = '';
    hudMom.rates.textContent = '';
    return;
  }

  // Estrapolazione dall'ultimo poll: il distacco si muove al ritmo misurato.
  const elapsed = Math.max(0, (Date.now() - momentumAt) / 1000);
  const leadNow = Math.max(0, m.lead - m.gain * elapsed);
  const etaNow = (m.gain > 0 && leadNow > 0) ? leadNow / m.gain : null;

  hudMom.window.textContent = `${fmtDuration(m.spanSec)} window · live`;

  // Barra bidirezionale attorno al centro: verso sinistra = difensori,
  // verso destra = attaccanti.
  const pct = Math.min(50, Math.abs(m.balance) * 50);
  const towardDef = m.balance > 0;
  hudMom.fill.style.width = pct + '%';
  hudMom.fill.style.left = towardDef ? (50 - pct) + '%' : '50%';
  hudMom.fill.style.background = towardDef ? '#4d8dff' : '#ff4d6d';
  hudMom.fill.style.boxShadow = `0 0 10px ${towardDef ? '#4d8dff' : '#ff4d6d'}88`;

  const leaderIsDef = m.leader === 'defender';
  const leaderName = leaderIsDef ? '🛡️ DEFENDERS' : '⚔️ ATTACKERS';
  const trailerName = leaderIsDef ? '⚔️ ATTACKERS' : '🛡️ DEFENDERS';
  const leaderColor = leaderIsDef ? '#4d8dff' : '#ff4d6d';
  const trailerColor = leaderIsDef ? '#ff4d6d' : '#4d8dff';

  if (m.gain > 0) {
    // chi insegue sta recuperando
    hudMom.label.innerHTML =
      `<span style="color:${leaderColor}">${leaderName}</span> lead ${fmt(leadNow)}` +
      ` · <span style="color:${trailerColor}">${trailerName} closing</span>`;
    hudMom.label.style.color = '';
    if (leadNow <= 0.5) {
      hudMom.eta.innerHTML = `<span style="color:${trailerColor}; font-weight:700;">OVERTAKE IMMINENT</span>`;
    } else if (etaNow != null && etaNow < 86400) {
      hudMom.eta.innerHTML =
        `at this pace, <span style="color:${trailerColor}; font-weight:700;">overtake in ${fmtDuration(etaNow)}</span>` +
        ` <span style="color:#5a6578;">(−${fmt(m.gain)}/s gap)</span>`;
    } else {
      hudMom.eta.innerHTML = 'closing very slowly — no realistic overtake at this pace';
    }
  } else {
    hudMom.label.innerHTML =
      `<span style="color:${leaderColor}">${leaderName}</span> lead ${fmt(leadNow)}` +
      ` · <span style="color:${leaderColor}">extending</span>`;
    hudMom.label.style.color = '';
    hudMom.eta.innerHTML =
      `gap growing by <span style="color:${leaderColor}; font-weight:700;">${fmt(-m.gain)}/s</span> — ` +
      `<span style="color:#5a6578;">no comeback at current pace</span>`;
  }

  hudMom.rates.innerHTML =
    `🛡️ ${fmt(m.rateDef)}/s <span style="color:#3a4150;">vs</span> ⚔️ ${fmt(m.rateAtk)}/s`;
}

async function refreshBattleData(battleId, isInitial = false) {
  // Sia all'apertura che ad ogni poll, ranking e dati live del round
  // (battle.getLiveBattleData) viaggiano SEMPRE nello stesso POST batch
  // (fetchBattleWallData / fetchBattleWallPoll in battleHeatmap.js).
  let nations, live, details;
  if (isInitial) {
    const res = await fetchBattleWallData(battleId);
    nations = res.nations; live = res.live; details = res.details;
  } else {
    const res = await fetchBattleWallPoll(battleId);
    nations = res.nations; live = res.live;
  }
  // La fetch è asincrona: se nel frattempo l'utente ha chiuso l'overlay o
  // aperto un'altra battaglia, questi dati sono obsoleti e non vanno applicati.
  if (currentBattleId !== battleId) return;

  if (isInitial) applyTitle(details);

  if (!nations || !nations.length) {
    // Poll vuoto: può essere un vero "nessun danno" (battaglia appena
    // iniziata) oppure un 429/errore di rete transitorio. Prima lo si
    // trattava allo stesso modo e la vista veniva azzerata ogni 10s,
    // dando l'impressione che i dati non si aggiornassero mai. Ora, se
    // abbiamo già un dato buono in cache, lo riusiamo e ritentiamo al
    // giro successivo senza toccare la UI.
    pollFailCount++;
    if (lastGoodNations && lastGoodNations.length) {
      nations = lastGoodNations;
      if (liveDot) liveDot.style.background = '#5a6578';
      hudUpdatedAt.textContent = `Retrying… (last good data, ${pollFailCount}x)`;
      // Superato il backoff massimo si passa allo stato di errore esplicito
      // invece di continuare a mostrare dati vecchi senza spiegazione.
      if (pollFailCount >= POLL_FAIL_LIMIT) showStatus('error');
    } else {
      hudMomentum.textContent = 'NO DAMAGE RECORDED YET';
      hudMomentum.style.color = '#5a6578';
      setMomentumGlow('#5a6578', 0.12);
      drawMinimap([], 0, [], 0);
      if (pollFailCount >= POLL_FAIL_LIMIT) showStatus('error');
      return;
    }
  } else {
    pollFailCount = 0;
    lastGoodNations = nations;
    if (liveDot) liveDot.style.background = '#e8c97a';
    // Primo dato valido: via il loading. lastGoodNations e' il riferimento.
    showStatus('hidden');
  }

  const defenderRanked = nations.filter(n => n.side === 'defender').sort((a, b) => b.totalDamage - a.totalDamage);
  const attackerRanked = nations.filter(n => n.side === 'attacker').sort((a, b) => b.totalDamage - a.totalDamage);

  // Totali: se disponibili, usa i danni ufficiali del round live
  // (battle.getLiveBattleData -> round.attackerDamages/defenderDamages),
  // più precisi e aggiornati della somma dei ranking per-nazione. Fallback
  // sulla somma se i dati live non sono arrivati (errore/429 transitorio).
  const rankedSumDef = defenderRanked.reduce((s, n) => s + n.totalDamage, 0);
  const rankedSumAtk = attackerRanked.reduce((s, n) => s + n.totalDamage, 0);
  const round = live?.round || null;
  const totalDef = round?.defenderDamages != null ? round.defenderDamages : rankedSumDef;
  const totalAtk = round?.attackerDamages != null ? round.attackerDamages : rankedSumAtk;

  // ── Budget dinamico: dati reali della battaglia, non solo mobile/desktop ──
  // totalDef+totalAtk (danno totale) e numero di nazioni coinvolte guidano
  // sia il numero di truppe (usato subito sotto in applySide) sia i pool di
  // effetti (tracer/shell/esplosioni/vampe), sempre dentro il tetto assoluto
  // BUDGET_MAX. L'adaptive quality (renderLoop) puo' solo tagliare ULTERIORMENTE
  // (qualityDerate <= 1) sopra questo valore, mai aumentarlo.
  const nationCount = defenderRanked.length + attackerRanked.length;
  budgetScale = computeBudgetScale(totalDef + totalAtk, nationCount);
  applyEffectCaps(budgetScale * qualityDerate);

  applySide('defender', defenderRanked, totalDef, REAR_DEFENDER);
  applySide('attacker', attackerRanked, totalAtk, REAR_ATTACKER);

  updateHudNationList(hudDefFlags, defenderRanked.slice(0, MAX_NATIONS_PER_SIDE), totalDef, 'left');
  updateHudNationList(hudAtkFlags, attackerRanked.slice(0, MAX_NATIONS_PER_SIDE), totalAtk, 'right');

  drawMinimap(defenderRanked, totalDef, attackerRanked, totalAtk);

  // ── Rate (danno/sec dall'ultimo poll) ──
  const now = performance.now();
  if (prevTotalDef != null && lastPollTime > 0) {
    const dt = (now - lastPollTime) / 1000;
    if (dt > 0) {
      hudDefRate.textContent = formatRate((totalDef - prevTotalDef) / dt);
      hudAtkRate.textContent = formatRate((totalAtk - prevTotalAtk) / dt);
    }
  }
  prevTotalDef = totalDef; prevTotalAtk = totalAtk; lastPollTime = now;

  // ── Split % ──
  const totalAll = totalDef + totalAtk;
  const defShare = totalAll > 0 ? totalDef / totalAll : 0.5;
  const defPct = defShare * 100;
  hudSplitBar.def.style.width = defPct + '%';
  hudSplitBar.atk.style.width = (100 - defPct) + '%';
  hudSplitDefPct.textContent = defPct.toFixed(2) + '%';
  hudSplitAtkPct.textContent = (100 - defPct).toFixed(2) + '%';

  // ── Partecipanti + timestamp ──
  let participantsText = `${defenderRanked.length + attackerRanked.length} nations involved · ${defenderRanked.length} defending / ${attackerRanked.length} attacking`;
  if (round) {
    // Punti tick dal round live: quanto manca al prossimo tick e i punti
    // accumulati da ciascun lato (dato più preciso della sola % danni).
    participantsText += ` · tick ${round.actualTickPoints ?? 0} · 🛡️${round.defenderPoints ?? 0} / ⚔️${round.attackerPoints ?? 0} pts`;
  }
  hudParticipants.textContent = participantsText;
  if (pollFailCount === 0) {
    lastUpdateTs = Date.now();
    hudUpdatedAt.textContent = 'Updated just now';
  }
  // Il messaggio di momentum viene ricalcolato ad ogni frame in renderLoop();
  // se il round live risulta terminato, quel calcolo lascia il posto a
  // "ROUND ENDED" tramite questo flag.
  roundEnded = !!(round && round.isActive === false);

  // ── Inerzia della battaglia ──
  // Solo su dati freschi: i poll falliti riusano la cache e falserebbero i ritmi.
  if (pollFailCount === 0) pushDamageSample(totalDef, totalAtk);
  updateMomentumHud(totalDef, totalAtk);

  targetDef = totalDef;
  targetAtk = totalAtk;
  wallTargetX = (defShare - 0.5) * 2 * HALF_RANGE;
}

// ==================== ADAPTIVE QUALITY REALE ====================
// Non piu' solo il flag IS_MOBILE statico deciso una volta al caricamento:
// qui si misura il frame time medio a runtime e, se il dispositivo fatica
// DAVVERO (non solo "e' mobile"), si taglia pixelRatio e i cap dei pool
// effetti in automatico. Isteresi volutamente asimmetrica: si scende svelti
// (2.5s sotto soglia) per non far durare gli scatti, si risale piano (8s
// sopra soglia) per non oscillare avanti e indietro ad ogni micro-variazione.
const QUALITY_TIERS = 3; // 0 = piena qualita', QUALITY_TIERS-1 = minima
const QUALITY_BAD_MS = 33;   // ~30fps: sopra questa soglia di frame time si considera "in affanno"
const QUALITY_GOOD_MS = 20;  // ~50fps: sotto questa soglia si considera "comodo"
const QUALITY_DOWN_HOLD_MS = 2500;
const QUALITY_UP_HOLD_MS = 8000;
let frameTimeEma = 16.7;
let qualityTier = 0;
let qualityBadSince = 0, qualityGoodSince = 0;

function pixelRatioForTier(tier) {
  const base = IS_MOBILE ? 1 : 1.5;
  const steps = IS_MOBILE ? [1, 0.85, 0.7] : [1.5, 1.1, 0.85];
  return Math.min(window.devicePixelRatio, steps[tier] ?? base);
}

function applyQualityTier(tier) {
  qualityTier = Math.max(0, Math.min(QUALITY_TIERS - 1, tier));
  if (renderer) renderer.setPixelRatio(pixelRatioForTier(qualityTier));
  // qualityDerate scende insieme al tier: 1 / 0.75 / 0.55 sopra il budget
  // gia' deciso dai dati reali (budgetScale), mai al posto suo.
  qualityDerate = qualityTier === 0 ? 1 : qualityTier === 1 ? 0.75 : 0.55;
  applyEffectCaps(budgetScale * qualityDerate);
}

function updateAdaptiveQuality(nowMs, frameMs) {
  frameTimeEma += (frameMs - frameTimeEma) * 0.05;

  if (frameTimeEma > QUALITY_BAD_MS) {
    qualityGoodSince = 0;
    if (!qualityBadSince) qualityBadSince = nowMs;
    if (nowMs - qualityBadSince > QUALITY_DOWN_HOLD_MS && qualityTier < QUALITY_TIERS - 1) {
      applyQualityTier(qualityTier + 1);
      qualityBadSince = nowMs; // da tempo anche al prossimo eventuale ulteriore taglio
    }
  } else if (frameTimeEma < QUALITY_GOOD_MS) {
    qualityBadSince = 0;
    if (!qualityGoodSince) qualityGoodSince = nowMs;
    if (nowMs - qualityGoodSince > QUALITY_UP_HOLD_MS && qualityTier > 0) {
      applyQualityTier(qualityTier - 1);
      qualityGoodSince = nowMs;
    }
  } else {
    qualityBadSince = 0; qualityGoodSince = 0;
  }
}

// ==================== RENDER LOOP ====================
let _lastFrameMs = 0;
let shellTimer = 1.5, momHudTimer = 0;
let prevWallXForVel = 0, frontVelSmoothed = 0; // per il front trail (sez. 9), vedi uniform frontVel
function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);
  const nowMs = performance.now();
  const t = nowMs * 0.001;
  // dt reale (clampato): la simulazione delle truppe deve avanzare alla stessa
  // velocita' anche se il framerate cala.
  const dt = Math.min(0.05, (nowMs - _lastFrameMs) / 1000 || 0.016);
  _lastFrameMs = nowMs;

  wallX += (wallTargetX - wallX) * 0.035;
  wallGroup.position.x = wallX;
  // La linea del fronte pulsa nel colore di chi sta guadagnando inerzia,
  // con intensita' proporzionale allo squilibrio: colpo d'occhio immediato.
  if (lastMomentum) {
    const b = lastMomentum.balance;
    const towardDef = b > 0;
    wallCore.material.color.setHex(
      Math.abs(b) < 0.04 ? 0xf2f6ff : (towardDef ? 0x7fb6ff : 0xff8095)
    );
    const pulse = 0.4 + Math.min(0.45, Math.abs(b) * 0.9);
    wallCore.material.opacity = pulse + Math.sin(t * (2 + Math.abs(b) * 6)) * 0.12;
  } else {
    wallCore.material.opacity = 0.42 + Math.sin(t * 3) * 0.1;
  }
  wallGlow.material.opacity = 0.16 + Math.sin(t * 2.4) * 0.06;

  // Spinta: >0 se il lato sta guadagnando terreno. Deriva dalla differenza fra
  // la posizione target del fronte (dati reali) e quella attuale, cosi' quando
  // una fazione prende il sopravvento le sue truppe avanzano davvero e quelle
  // avversarie ripiegano. Pesata assieme al vero momentum (lastMomentum.balance,
  // il ritmo di danno recente, stessa convenzione di segno: >0 = difensori
  // avanti): senza questo, una volta che il fronte "raggiungeva" il target
  // cumulato la spinta tornava a zero anche se un lato continuava a guadagnare
  // terreno, e le truppe smettevano di muoversi pur essendo ancora in vantaggio.
  const posDrive = Math.max(-1, Math.min(1, (wallTargetX - wallX) / 3));
  const momDrive = lastMomentum ? lastMomentum.balance : 0;
  const drive = Math.max(-1, Math.min(1, posDrive * 0.4 + momDrive * 0.6));
  updateMomentumArrows(dt, wallX, drive);

  // ── Simulazione a frequenza variabile (simHz: SIM_HZ_FULL o SIM_HZ_IDLE) ──
  // Avanza lo stato di ogni unita' a passi di simDt secondi (indipendenti dal
  // refresh rate dello schermo), poi il render sotto interpola la sola
  // posizione tra l'ultimo e il penultimo stato simulato (alpha). Il limite
  // sui passi per frame evita che un tab rimasto in background a lungo
  // debba "recuperare" centinaia di step tutti insieme al ritorno.
  updateSimHz(nowMs);
  const simDt = 1 / simHz;
  simAccum = Math.min(simAccum + dt, simDt * SIM_MAX_STEPS_PER_FRAME);
  let simSteps = 0;
  while (simAccum >= simDt && simSteps < SIM_MAX_STEPS_PER_FRAME) {
    runSimulationTick(drive, simDt);
    simAccum -= simDt;
    simSteps++;
  }
  const simAlpha = Math.max(0, Math.min(1, simAccum / simDt));

  // ── LOD legato allo zoom ──
  // Ricalcolato una volta per frame (non per-soldato): sotto LOD_NEAR_DIST si
  // attiva il dettaglio fine (bob/lean/sway/pitch in layoutSoldierGroup/
  // layoutVehicles), a inquadratura larga viene saltato del tutto.
  // getDistance() non e' presente in tutte le build di OrbitControls (non lo
  // e' in r128, la versione usata qui, vedi THREE_CDN/ORBIT_CDN in testa al
  // file): calcolata a mano, stesso valore, senza dipendere dal metodo.
  lodFineDetail = !controls || camera.position.distanceTo(controls.target) < LOD_NEAR_DIST;

  // ── Adaptive quality reale ──
  // Frame time medio (EMA): se resta alto (fps basso) per qualche secondo, si
  // scende un gradino di qualita' (pixelRatio + cap dei pool effetti) PRIMA
  // che l'utente se ne accorga da solo; se il frame time torna basso a lungo,
  // si risale con piu' calma (isteresi asimmetrica: si scende in fretta, si
  // risale piano, per non oscillare). Aggiorna qualityDerate, che si combina
  // con budgetScale (dati reali) in applyEffectCaps.
  updateAdaptiveQuality(nowMs, dt * 1000);

  // il terreno si ricolora seguendo il fronte: il territorio conquistato
  // cambia fazione senza bisogno di overlay sopra il suolo. uTime alimenta
  // il flow animato nella fascia bruciata (vedi shader in buildGround).
  // Velocita' visiva del fronte (front trail, sez. 9): differenza di wallX
  // pesata su dt, smorzata con un EMA cosi' non scatta a ogni micro-jitter
  // ma segue comunque gli sbandamenti rapidi (piccoli sfondamenti).
  const rawFrontVel = dt > 0 ? Math.abs(wallX - prevWallXForVel) / dt : 0;
  frontVelSmoothed += (rawFrontVel - frontVelSmoothed) * 0.12;
  prevWallXForVel = wallX;
  if (groundMat) {
    groundMat.uniforms.frontX.value = wallX;
    groundMat.uniforms.uTime.value = t;
    groundMat.uniforms.frontVel.value = frontVelSmoothed;
  }

  // Pannello momentum ridisegnato di continuo (10Hz) con i valori estrapolati:
  // e' il refresh "veloce" percepito, indipendente dal ritmo di rete.
  momHudTimer -= dt;
  if (momHudTimer <= 0) { momHudTimer = 0.1; renderMomentumHud(); }
  updateGroundFollowers();

  // artiglieria: il lato che sta spingendo tira piu' spesso
  // Frequenza degli effetti proporzionale al momentum: battaglia in stallo =
  // pochi colpi (e meno lavoro per frame), battaglia in movimento = fuoco fitto.
  const momentumFactor = Math.abs(lastMomentum?.balance || 0);
  const hot = momentumFactor > 0.2;

  shellTimer -= dt;
  if (shellTimer <= 0 && !roundEnded) {
    // Rallentata ancora su richiesta rispetto al giro precedente.
    const shellDelay = Math.max(1.4, 1.6 - momentumFactor * 0.3);
    shellTimer = hot
      ? shellDelay + Math.random() * 0.9
      : 3.4 + Math.random() * 3.8;
    launchShell(Math.random() < 0.5 + drive * 0.25 ? -1 : 1);
  }
  updateShells(dt);
  updateExplosions(dt);
  updateTracers(dt);

  flashCursor = 0;
  defenderGroups.forEach(g => layoutSoldierGroup(g, wallX, -1, dt, drive, simAlpha));
  attackerGroups.forEach(g => layoutSoldierGroup(g, wallX, 1, dt, -drive, simAlpha));
  finalizeFlashes();
  flagBillboards.forEach(f => f.quaternion.copy(camera.quaternion));

  dispDef += (targetDef - dispDef) * 0.08;
  dispAtk += (targetAtk - dispAtk) * 0.08;
  hudDefVal.textContent = fmt(dispDef);
  hudAtkVal.textContent = fmt(dispAtk);

  // Il colore dello stato pilota anche il bagliore della card: cosi' lo
  // stato della battaglia si legge anche in periferia, senza dover fissare
  // il testo.
  if (roundEnded) {
    hudMomentum.textContent = 'ROUND ENDED';
    hudMomentum.style.color = '#5a6578';
    setMomentumGlow('#5a6578', 0.12);
  } else {
    // Il testo di stato usa l'inerzia misurata sui dati (chi sta accumulando
    // danno piu' in fretta ORA), non solo lo scarto residuo del fronte, che
    // dice soltanto quanto manca all'animazione per assestarsi.
    const m = lastMomentum;
    if (!m) {
      hudMomentum.textContent = 'MEASURING MOMENTUM…';
      hudMomentum.style.color = '#5a6578';
      setMomentumGlow('#5a6578', 0.12);
    } else if (Math.abs(m.balance) < 0.04) {
      hudMomentum.textContent = '⚖️ EVENLY MATCHED — FRONT HOLDING';
      hudMomentum.style.color = '#e8c97a';
      setMomentumGlow('#e8c97a', 0.3);
    } else {
      const defGaining = m.balance > 0;
      const comeback = m.gain > 0;
      const who = defGaining ? '🛡️ DEFENDERS' : '⚔️ ATTACKERS';
      hudMomentum.textContent = comeback
        ? `${who} CLOSING THE GAP`
        : `${who} EXTENDING THEIR LEAD`;
      const glowColor = defGaining ? '#4d8dff' : '#ff4d6d';
      hudMomentum.style.color = glowColor;
      // Intensita' proporzionale allo squilibrio, con un pulsare morbido:
      // piu' netto e' il momentum, piu' la card "respira".
      const intensity = 0.28 + Math.min(0.4, Math.abs(m.balance) * 0.7);
      const pulse = intensity + Math.sin(t * (comeback ? 4.5 : 2.2)) * 0.08;
      setMomentumGlow(glowColor, Math.max(0.15, pulse));
    }
  }

  if (lastUpdateTs) {
    const secs = Math.floor((Date.now() - lastUpdateTs) / 1000);
    hudUpdatedAt.textContent = secs < 2 ? 'Updated just now' : `Updated ${secs}s ago`;
  }

  if (controls) {
    // Dopo qualche secondo di inattivita' il target scivola pianissimo
    // verso il fronte reale (wallX): solo se l'utente non sta orbitando ORA
    // e non l'ha appena fatto, altrimenti si strapperebbe il controllo di
    // mano nel bel mezzo di un gesto.
    if (!userInteracting && nowMs - lastInteractionMs > 2500) {
      controls.target.x += (wallX - controls.target.x) * 0.006;
    }
    // Micro-movimento cinematico quando la camera è ferma da un po': un
    // respiro laterale lentissimo e di ampiezza minima (+/-0.12 unita'),
    // non un "inseguimento" del fronte. Si attiva solo dopo un'inattivita'
    // piu' lunga di quella che fa scivolare il target (sopra), cosi' i due
    // movimenti non si sovrappongono in modo percettibile; si disattiva
    // all'istante al primo tocco dell'utente.
    if (!userInteracting && nowMs - lastInteractionMs > 4000) {
      if (idleBaseZ === null) idleBaseZ = controls.target.z;
      controls.target.z = idleBaseZ + Math.sin(t * 0.15) * 0.12;
    } else {
      idleBaseZ = null;
    }
    // Il target resta dentro i confini della mappa: senza questo il pan
    // permetteva di allontanarsi fino a perdere del tutto il campo.
    controls.target.x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, controls.target.x));
    controls.target.z = Math.max(-MAP_D, Math.min(MAP_D, controls.target.z));
    controls.target.y = 0;
    controls.update();
  }
  renderer.render(scene, camera);
}

// ==================== API PUBBLICA ====================
// Azzera lo stato animato e smonta le unità/overlay della battaglia
// precedente. Senza questo, riaprendo l'overlay su un'altra battaglia i
// contatori partivano dai valori vecchi e il muro "scivolava" dalla posizione
// della battaglia precedente.
function resetBattleState() {
  defenderGroups.forEach(disposeNationGroup);
  attackerGroups.forEach(disposeNationGroup);
  defenderGroups = []; attackerGroups = [];
  lastDefKey = ''; lastAtkKey = '';
  // Pool condiviso di fanteria: nessuna nazione ancora assegnata sulla nuova
  // battaglia, si riparte da zero istanze visibili (vedi applySide).
  if (bodyMeshDef) bodyMeshDef.count = 0;
  if (bodyMeshAtk) bodyMeshAtk.count = 0;

  wallX = 0; wallTargetX = 0;
  simAccum = 0; simHz = SIM_HZ_FULL; simIdleSince = 0; // riparte a piena frequenza sulla nuova battaglia
  lodFineDetail = true;
  prevWallXForVel = 0; frontVelSmoothed = 0;
  lastFollowerWallX = 1e9; // forza il primo ricalcolo di fronte/trincee sulla nuova battaglia
  dispDef = 0; dispAtk = 0; targetDef = 0; targetAtk = 0;
  prevTotalDef = null; prevTotalAtk = null; lastPollTime = 0; lastUpdateTs = 0;
  lastGoodNations = null; pollFailCount = 0;
  damageHistory = []; lastMomentum = null; momentumAt = 0;
  roundEnded = false;
  minimapSegments = [];
  // Budget/qualita': si riparte dal minimo e si lascia che i dati reali della
  // nuova battaglia (primo refreshBattleData) e l'adaptive quality la
  // riportino dove serve, invece di ereditare lo stato della battaglia
  // precedente.
  budgetScale = BUDGET_MIN;
  qualityDerate = 1; qualityTier = 0; frameTimeEma = 16.7;
  qualityBadSince = 0; qualityGoodSince = 0;
  applyEffectCaps(budgetScale);
  if (renderer) renderer.setPixelRatio(pixelRatioForTier(0));
  if (hudDefRate) hudDefRate.textContent = '';
  if (hudAtkRate) hudAtkRate.textContent = '';
  if (hudDefFlags) hudDefFlags.innerHTML = '';
  if (hudAtkFlags) hudAtkFlags.innerHTML = '';
}

export async function openBattleWall3D(battleId) {
  // closeBattleWall3D() smonta tutto: qui si ricostruisce overlay e scena.
  ensureOverlay();
  overlayEl.style.display = 'block';
  showStatus('loading');
  document.body.style.overflow = 'hidden';
  currentBattleId = battleId;

  await ensureThree();
  if (!_dTorso) {
    _dTorso = new THREE.Object3D(); _dVeh = new THREE.Object3D();
  }
  buildScene();
  resetBattleState();

  hudMomentum.textContent = 'LOADING BATTLE DATA…';
  hudMomentum.style.color = '#e8c97a';
  setMomentumGlow('#e8c97a', 0.2);
  hudTitle.region.textContent = '—';
  hudTitle.match.textContent = 'Loading…';
  // Titolo, ranking e dati live del round arrivano tutti insieme in un solo
  // POST batch (fetchBattleWallData), invece di due richieste separate.
  await refreshBattleData(battleId, true);

  schedulePoll(battleId);

  if (!rafId) renderLoop();
}

// Polling adattivo: setTimeout ricorsivo invece di setInterval, cosi'
// l'intervallo puo' allungarsi in caso di 429 senza accodare richieste.
// Ad ogni fallimento l'attesa raddoppia (max POLL_MAX_MS) e torna alla base
// al primo successo, perche' pollFailCount viene azzerato in refreshBattleData.
function schedulePoll(battleId) {
  if (pollTimer) clearTimeout(pollTimer);
  const delay = Math.min(POLL_MAX_MS, POLL_MS * Math.pow(2, Math.min(pollFailCount, 3)));
  pollTimer = setTimeout(async () => {
    if (currentBattleId !== battleId) return;
    await refreshBattleData(battleId, false);
    if (currentBattleId === battleId) schedulePoll(battleId);
  }, delay);
}

// Scheda in background: ferma del tutto RAF e polling (nessun frame verra'
// mostrato comunque); al ritorno in primo piano li fa ripartire da zero,
// azzerando _lastFrameMs cosi' il primo dt calcolato in renderLoop non
// includa l'intero tempo passato fuori schermo (che farebbe scattare truppe
// e proiettili in avanti di colpo).
function onVisibilityChange() {
  if (document.hidden) {
    pageHidden = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    return;
  }
  if (!pageHidden) return;
  pageHidden = false;
  _lastFrameMs = performance.now();
  if (!rafId) renderLoop();
  if (currentBattleId && !pollTimer) schedulePoll(currentBattleId);
}

// Libera ricorsivamente geometrie e materiali di un sottoalbero.
function disposeObject3D(root) {
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of mats) {
      // le texture generate sono nel registro globale, qui solo quelle inline
      if (m.map && !generatedTextures.includes(m.map)) m.map.dispose();
      m.dispose();
    }
  });
}

export function closeBattleWall3D() {
  // 1) fermo tutto cio' che gira
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  pageHidden = false;

  // 2) abort di fetch pendenti e di TUTTI i listener registrati con { signal }
  //    (resize, keydown, mousemove/mouseleave minimappa, click su close/retry)
  if (sessionAbort) { sessionAbort.abort(); sessionAbort = null; }

  // 3) OrbitControls
  if (controls) { controls.dispose(); controls = null; }

  // 4) scena: dispose di geometrie, materiali e texture generate
  if (scene) {
    disposeObject3D(scene);
    scene.clear ? scene.clear() : (scene.children.length = 0);
  }
  for (const t of generatedTextures) t.dispose();
  generatedTextures = [];

  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement?.remove();
    renderer = null;
  }

  // 5) svuoto i pool e azzero lo stato della scena, cosi' la prossima apertura
  //    ricostruisce tutto da zero invece di riusare riferimenti morti
  scene = null; camera = null;
  wallGroup = wallCore = wallGlow = null; _dWall = null; wallSegCount = 0;
  groundMat = null; groundFollowers = [];
  explMesh = null; explData = [];
  shells = [];
  tracerMesh = null; tracerData = [];
  centerLineMesh = null;
  arrowDef = null; arrowAtk = null;
  flashMesh = null; flashCursor = 0;
  bodyMeshDef = null; bodyMeshAtk = null;
  defenderGroups = []; attackerGroups = []; flagBillboards = [];
  lastDefKey = ''; lastAtkKey = '';
  simHz = SIM_HZ_FULL; simIdleSince = 0; simAccum = 0;
  lodFineDetail = true;
  qualityTier = 0; qualityDerate = 1; frameTimeEma = 16.7;
  qualityBadSince = 0; qualityGoodSince = 0;
  budgetScale = BUDGET_MIN;
  sceneReady = false;

  // 6) l'overlay DOM viene rimosso: i suoi listener sono gia' stati abortiti
  //    al punto 2, quindi va ricreato alla prossima apertura
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  minimapCanvas = minimapCtx = minimapTooltip = null;
  minimapSegments = [];
  hudMom = {}; hudStatus = {};

  document.body.style.overflow = '';
  currentBattleId = null;
}

export function isBattleWall3DOpen() {
  return !!overlayEl && overlayEl.style.display !== 'none';
}