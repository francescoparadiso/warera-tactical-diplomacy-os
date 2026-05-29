# WarEra Diplomacy OS - Roadmap & Ideas

Here's what I'm thinking for the next releases.  
Contributions, feedback, and pull requests are always welcome!

## 🧾 Dedicated Bloc Page (next priority)

A brand‑new page showing aggregated statistics for each alliance bloc:

- **Shared Treasury** – sum of all member nations' treasuries
- **Total Citizens** – active population of the whole bloc
- **Weekly Damage** – combined `weeklyCountryDamages` of all members
- **Total Allies** – number of mutual defense pacts inside the bloc
- **Active Wars** – how many conflicts the bloc is fighting
- **Damage Share** – which nation contributes the most (pie chart)
- **Bloc Map** – a mini map highlighting the bloc on the world

The bloc page would be accessible from the bloc legend or from a new "Bloc Stats" button.

## 🗓️ Timeline & History

- **Diplomacy timeline** – replay how alliances and wars have evolved day by day  
  (needs historical data – maybe from Metiou’s collector or external snapshots)
- **Map animations** – show border changes, alliance shifts over time

## ⚔️ Battle Overlay

- **Live battle indicators** – icons on the map where fights are happening  
- **Damage distribution pie** – for a selected nation, break down how much damage they've done for themselves vs. each ally  
  *(already partly implemented in `battles.js`, needs UI integration)*
- **Battle ranking** – per‑nation damage in each active battle

## 📊 More Heatmaps

- **Country Development** – heatmap based on `countryDevelopment.value`
- **Wealth per Citizen** – economic power of nations
- **Damage per Citizen** – highlight efficiency, not just raw numbers

## 🔧 Tool Improvements

- **Save & Load** – let users save their manual NAPs and preferences (localStorage)
- **Search filters** – filter nations by bloc, population, or weekly damage
- **Dark/Light persistence** – remember the theme choice across visits
- **Export map** – download the current map view as PNG

## 🌐 Community & Sharing

- **Share current view** – generate a link with selected nation, mode, and zoom
- **Embed widget** – allow other sites to embed a small diplomacy map
- **Discord bot** – query alliance data directly from Discord

---

*These are all ideas – some may take time, others might change depending on your feedback.  
Let me know what you'd like to see first!*

**– frappa10**