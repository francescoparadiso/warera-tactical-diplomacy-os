# 🗺️ WarEra Diplomacy OS

Mappa diplomatica interattiva per WarEra.io — visualizza alleanze, guerre, NAP e blocchi di alleanza.
https://francescoparadiso.github.io/warera-tactical-diplomacy-os/

---

## Struttura file

```
├── src/
│   ├── main.js        ← entry point, init e event listeners
│   ├── state.js       ← stato globale centralizzato
│   ├── config.js      ← costanti, colori, URL, blocchi hardcoded
│   ├── utils.js       ← CSV parser, toast, loading, hashColor
│   ├── map.js         ← setup MapLibre, renderMap, cerca, reset
│   ├── diplomacy.js   ← calcolo colori diplomazia
│   ├── blocs.js       ← caricamento blocchi alleanza
│   ├── naps.js        ← NAP manuali ed esterni
│   ├── labels.js      ← canvas labels e bandierine
│   ├── patterns.js    ← pattern striati multi-blocco
│   └── ui.js          ← legenda, stats, selected display
├── index.html         ← HTML + CSS
├── package.json
├── vite.config.js
└── .github/
    └── workflows/
        └── deploy.yml
```