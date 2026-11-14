# Aniwa: Ghana Forest Watch

**Deforestation, tracked before it’s irreversible.**

Aniwa is a live forest-monitoring platform for all 16 regions of Ghana, built for the NASA Space Apps Challenge 2026. It uses only real satellite and survey data: no mock-ups.

Ghana had **6.96 million hectares** of tree cover in 2000 and lost **25%** of it by 2024 (Global Forest Watch). Aniwa shows where that loss happened, where clearing is happening right now, and where it is likely to happen next.

> **This repository is a public preview.** It contains the full landing page and a small part of the dashboard (the overview figures, the loss map and the yearly trend). The rest of the dashboard is kept private (see [What’s not included](#whats-not-included)).

---

## What’s in this repository

### 1. Landing page (`/`)
- **3D hero:** a satellite model over Earth (Three.js).
- **Scroll walkthrough:** seven chapters in 3D. The camera flies from a globe down onto a 3D map of Ghana whose regions rise by their real forest loss, then shows the regions with the most clearing right now, live NASA fires and recommended restoration sites. Every point comes from live data.
- **Who it’s for** and **Built on open data** sections.

### 2. Dashboard preview (`/dashboard`)
- **Forest lost since 2000:** the national share of 2000 tree cover lost, with the change from the previous year.
- **Forest being cleared (30 days):** satellite clearing alerts (GLAD-S2 and RADD, via Global Forest Watch).
- **NASA fires in forest regions:** active fires from the last 5 days (NASA FIRMS). Savanna fires are shown but not counted, because grass burns there every dry season.
- **Loss map:** Ghana’s 16 regions shaded by tree-cover loss since 2001, with NASA fires on top.
- **Tree-cover loss per year:** 2001 to 2024. Hover the chart, or focus it and use the arrow keys, to read each year.

## What’s not included

The full Aniwa dashboard also has these tools, which are **not** in this repository:

- **Predict:** a risk model that ranks Ghana’s 10 likeliest clearing hotspots and names the nearest town.
- **Check with satellites:** compares any spot now with a year ago using Sentinel-2 images and Sentinel-1 radar (through cloud).
- **Chainsaw listener:** turns a phone into an on-device chainsaw detector, with SMS, Telegram and email alerts.
- **Fire-weather forecast**, **climate impact**, **reforestation planning** and an **AI analyst**.

---

## Run it yourself

### Requirements
- **Node.js 20 or newer** and npm
- Two free API keys (below). Without them the pages still load, but the live figures show as unavailable.

### 1. Install
```bash
git clone https://github.com/awuni1/Aniwa.git
cd Aniwa
npm install
```

### 2. Add your API keys
Copy the example file and fill in your keys:
```bash
cp .env.example .env.local
```

| Variable | What it’s for | How to get it |
|---|---|---|
| `GFW_API_KEY` | Tree-cover loss, the 2000 baseline and clearing alerts | Create a free account and key at [data-api.globalforestwatch.org](https://data-api.globalforestwatch.org). Allow the domain `localhost` when you create the key. |
| `NASA_FIRMS_MAP_KEY` | Active fires | Free at [firms.modaps.eosdis.nasa.gov/api/map_key](https://firms.modaps.eosdis.nasa.gov/api/map_key) |
| `ADMIN_KEY` | Optional. Lets you force a data refresh | Any long random string. Send it as the `x-admin-key` header to `/api/region-loss?refresh=1`. |

`.env.local` is git-ignored, so your keys are never committed.

### 3. Start the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) for the landing page, and [http://localhost:3000/dashboard](http://localhost:3000/dashboard) for the dashboard preview. If port 3000 is busy, Next.js picks another one and prints it.

### 4. Production build (optional)
```bash
npm run build
npm start
```

### Other commands
```bash
npm run lint
```

---

## How it works

```
Browser ──► /api/region-loss ──► Global Forest Watch Data API (cached 24 h in data/)
        ──► /api/fires       ──► NASA FIRMS (cached 30 min)
        ──► /public/*.json   ──► region outlines, place names
```

- **`/api/region-loss`** queries Global Forest Watch for every region: yearly tree-cover loss 2001–2024 (Hansen/UMD, at least 30% canopy), the 2000 tree-cover baseline, loss drivers and 30-day clearing alerts. Results are cached for 24 hours in `data/`.
- **`/api/fires`** fetches the last 5 days of VIIRS and MODIS fire detections over Ghana from NASA FIRMS and tags each with its region.
- API keys stay on the server and are never sent to the browser. Error messages to the browser are generic; details go to the server log.

### Project structure
```
src/
  app/
    page.tsx              Landing page
    dashboard/page.tsx    Dashboard preview
    api/region-loss/      Forest loss, 2000 baseline, alerts (Global Forest Watch)
    api/fires/            Active fires (NASA FIRMS)
    layout.tsx, globals.css, icons
  components/
    HeroScene.tsx         3D satellite hero (Three.js)
    PlatformStory.tsx     Scroll walkthrough text and live data
    StoryScene.tsx        3D walkthrough scene (Three.js)
    OverviewWidgets.tsx   Cards, trend chart and other dashboard pieces
    PublicMap.tsx         Loss map with fires (MapLibre)
  lib/
    server/               Server-only API clients (GFW, FIRMS)
    *.ts                  Shared types and helpers
public/
  ghana_regions.geojson   Region outlines (geoBoundaries)
  ghana_places.json       Named places (OpenStreetMap)
  sentinel.glb            3D satellite model
  logo.png
```

### Tech stack
Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Three.js, MapLibre GL, Framer Motion.

---

## Data sources

| Source | Used for |
|---|---|
| [Global Forest Watch](https://www.globalforestwatch.org) (Hansen/UMD; GLAD-S2 and RADD alerts) | Tree-cover loss, the 2000 baseline, loss drivers, 30-day clearing alerts |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | Active fires, last 5 days |
| [geoBoundaries](https://www.geoboundaries.org) | Ghana’s 16 region outlines |
| [OpenStreetMap](https://www.openstreetmap.org) contributors (ODbL) | Names of cities, towns and villages |
| Esri World Imagery | Map background |

## Known limits
- Global Forest Watch publishes the **2000 baseline only for Ghana’s 10 regions from before the 2018 split**, so the 2000-vs-today comparison is made at that level.
- Yearly loss runs to **2024**, the latest year Global Forest Watch has published.
- Fire detections show heat, not cause. Only fires in forest-belt regions are counted as possible clearing.
- The data cache is a JSON file in `data/`, which does not persist on serverless hosts. Use a database there.

## License
All rights reserved. Contact the team for permission to use this code.

---

Built for the NASA Space Apps Challenge 2026.
