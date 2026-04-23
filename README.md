# 🗺️ WarEra Diplomacy OS

Mappa diplomatica interattiva per WarEra.io — visualizza alleanze, guerre, NAP e blocchi di alleanza.
https://francescoparadiso.github.io/warera-tactical-diplomacy-os/

## Setup iniziale (una sola volta)

### 1. Clona il repo in locale
```bash
git clone https://github.com/francescoparadiso/warera-tactical-diplomacy-os.git
cd warera-tactical-diplomacy-os
npm install
```

### 2. Avvia in locale per testare
```bash
npm run dev
```
Apri http://localhost:5173 nel browser.

### 3. Configura GitHub Pages
Nel tuo repo su GitHub:
- Vai su **Settings → Pages**
- In "Source" seleziona **"Deploy from a branch"**
- Branch: **`gh-pages`**, cartella: **`/ (root)`**
- Salva

### 4. Abilita le Actions
Vai su **Settings → Actions → General** e assicurati che i workflow abbiano il permesso di scrivere nel repo (spunta "Read and write permissions").

### 5. Fai il primo push
```bash
git add .
git commit -m "Migrazione a Vite"
git push origin main
```

Il sito si aggiorna automaticamente in ~1 minuto ad ogni push.

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

## ⚠️ Nota importante su vite.config.js

Assicurati che `base` corrisponda al nome ESATTO del tuo repository:

```js
export default {
  base: '/warera-tactical-diplomacy-os/',
}
```
