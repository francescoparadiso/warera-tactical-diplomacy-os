import { state } from './state.js';
import { parseCSV, showToast } from './utils.js';
import { EXTERNAL_NAPS_URL } from './config.js';
import { renderMap } from './map.js';
import { updateExternalNapsUI, updateNapBadge } from './ui.js';

// ==================== NAP ESTERNI ====================
export async function loadExternalNaps() {
  try {
    const resp = await fetch(EXTERNAL_NAPS_URL + `?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csv = await resp.text();
    const napsData = parseCSV(csv);

    state.externalNapsList = [];
    state.externalNapsSet.clear();

    for (const row of napsData) {
      const nationACode = row.nazione_A?.trim().toUpperCase();
      const napConStr   = row.nap_con?.trim();
      if (!nationACode || !napConStr) continue;

      const countryA = state.nazioniGlobal.find(n => n.code?.toUpperCase() === nationACode);
      if (!countryA) continue;

      for (const targetCode of napConStr.split(',').map(c => c.trim().toUpperCase())) {
        const countryB = state.nazioniGlobal.find(n => n.code?.toUpperCase() === targetCode);
        if (!countryB) continue;
        const key    = `${countryA._id}-${countryB._id}`;
        const revKey = `${countryB._id}-${countryA._id}`;
        if (!state.externalNapsSet.has(key) && !state.externalNapsSet.has(revKey)) {
          state.externalNapsSet.add(key);
          state.externalNapsList.push({ fromId: countryA._id, toId: countryB._id, fromName: countryA.name, toName: countryB.name });
        }
      }
    }

    updateExternalNapsUI();
    renderMap();
    showToast(`${state.externalNapsList.length} external NAPs loaded`, 'success');
  } catch (err) {
    console.error('Errore NAP esterni:', err);
    showToast('External NAPs unavailable.', 'warning');
  }
}

// ==================== NAP MANUALI ====================
export function aggiungiNap() {
  const input = document.getElementById('napInput');
  const val   = input.value.trim();
  if (!val) { showToast('Enter a nation name', 'error'); return; }

  const found = state.nazioniGlobal.find(n => n.name.toLowerCase() === val.toLowerCase());
  if (!found)                              { showToast(`Nation "${val}" not found`, 'error'); return; }
  if (state.customNaps.includes(found._id)){ showToast(`${found.name} already in NAP`, 'error'); return; }
  if (state.selectedCountryId === found._id){ showToast('Cannot add selected nation', 'error'); return; }

  state.customNaps.push(found._id);
  input.value = '';
  updateNapListUI();
  renderMap();
  showToast(`Added ${found.name} to NAP`, 'success');
}

export function rimuoviNap(id) {
  state.customNaps = state.customNaps.filter(n => n !== id);
  updateNapListUI();
  renderMap();
}

export function updateNapListUI() {
  const container = document.getElementById('napList');
  updateNapBadge(state.customNaps.length);

  if (!state.customNaps.length) {
    container.innerHTML = '<div class="empty-state">No manual NAPs set</div>';
    return;
  }
  container.innerHTML = state.customNaps
    .map(id => {
      const n = state.nationMap.get(id);
      return n ? `<div class="nap-item"><span style="font-weight:600">${n.name}</span><span class="remove-nap" data-id="${id}">✕</span></div>` : '';
    })
    .join('');

  container.querySelectorAll('.remove-nap').forEach(btn => {
    btn.addEventListener('click', () => rimuoviNap(btn.dataset.id));
  });
}
