<p align="center">
  <img src="public/logo.png" alt="Aniwa logo" width="96" height="96">
</p>

<h1 align="center">Aniwa</h1>

<p align="center"><b>Deforestation, tracked before it’s irreversible.</b><br>
A live forest-monitoring platform for all 16 regions of Ghana, built on real satellite, sensor and survey data.</p>

<p align="center">NASA Space Apps Challenge 2026</p>

---

## Contents

1. [Why Aniwa](#why-aniwa)
2. [What it does](#what-it-does)
3. [How it works](#how-it-works)
4. [Getting started](#getting-started)
5. [Configuration](#configuration)
6. [Using Aniwa](#using-aniwa)
7. [API reference](#api-reference)
8. [Data sources](#data-sources)
9. [Security](#security)
10. [Known limits](#known-limits)
11. [Project structure](#project-structure)
12. [Troubleshooting](#troubleshooting)
13. [Roadmap](#roadmap)
14. [License and credits](#license-and-credits)

---

## Why Aniwa

Ghana had **6.96 million hectares** of tree cover in 2000. By 2024 it had lost **1.75 million hectares, about 25%** (Global Forest Watch). Yearly loss has more than doubled since the early 2000s, and about **97% of it is classed as shifting agriculture**: small farms moving into forest, field by field.

Three gaps let this happen unseen:

- **Statistics arrive late.** Official loss figures come out once a year, long after the trees are gone.
- **Clouds hide the forest belt.** Over Western North there was 1 cloud-free optical satellite image in 6 months, but 23 radar passes in 3 months.
- **Clearing happens out of sight.** Chainsaws and fires deep in the forest are rarely seen in time.

Aniwa closes these gaps in one live map that **sees, predicts, verifies and acts**.

---

## What it does

### Landing page (`/`)
- A 3D satellite hero (Three.js).
- A seven-chapter scroll walkthrough in 3D: from a globe down onto a map of Ghana whose regions rise by their real forest loss, then the riskiest hotspots, live NASA fires, the latest chainsaw detection and recommended restoration sites. Every point on screen comes from live data.
- “Who it’s for” and “Built on open data” sections.

### Dashboard (`/dashboard`)

| Section | What it shows | Key data |
|---|---|---|
| **Overview** | Forest lost since 2000, clearing in the last 30 days, NASA forest fires, chainsaws heard, the loss map with callouts pinned to real places, and the yearly loss trend | Global Forest Watch, NASA FIRMS |
| **Deforestation** | Loss for all 16 regions (2001–2024), each region’s 2000 forest vs today, drivers of loss and CO2e | Global Forest Watch |
| **Predict** | Risk at any point you click, the 10 riskiest spots in Ghana with the nearest real town, and **Check with satellites** | Risk model, ESA WorldCover, Sentinel-1/2 |
| **Live threats** | Chainsaw detections, the 3-day fire-weather forecast, NASA fires and clearing alerts, each named by nearest town | Phones, Meteomatics, NASA FIRMS, GFW |
| **Climate** | Loss trend to 2035 and its CO2e, heat records since 1991, threatened species nearby | NASA POWER, GBIF |
| **Reforestation** | Scored replanting sites, a Gemini planting plan, Ghana’s tree crops | Aniwa scoring, Google Gemini, FAO |

An **AI analyst** (Google Gemini) answers questions and writes briefings from the live data.

### Phone chainsaw listener (`/listen`)
Turns any phone into a forest listening post. An audio AI model runs **on the phone itself** and classifies 10-second clips. When it hears a chainsaw, it sends only the location, a confidence score and the time. **Audio never leaves the phone.** Detections reach the dashboard within 15 seconds; ones made without signal are queued and sent when the phone reconnects.

### Alerts
Email (Brevo), SMS (Africa’s Talking) and Telegram alerts for chainsaw detections and new forest-region fires, each naming the nearest town.

### The risk model (Predict)
A logistic regression that turns three kinds of evidence into a probability:

1. **Past loss nearby:** regions that lost more forest, and closer ones, raise the score.
2. **Real tree cover:** the share of trees around the point, from a 10 m forest map, so towns and farmland don’t rank as hotspots.
3. **Live evidence:** chainsaws heard within 5 km, NASA forest fires within 10 km, the region’s clearing alerts, and the fire-weather forecast.

The weights are set from published research rather than trained; the app says so next to the model.

### Check with satellites
Compares a 1 km box around a point over the last 90 days with the same 90 days a year earlier (same season, so dry-season browning isn’t mistaken for clearing). It uses Sentinel-2 photos when the sky is clear and Sentinel-1 radar, which sees through cloud, and returns *Clearing likely*, *Possible thinning* or *No clear change* with before-and-after images, in about 4 seconds.

---

## How it works

```
                        ┌──────────────────────────────┐
  Browser               │  Next.js server (API routes) │            External data
 ─────────              │──────────────────────────────│           ───────────────
  Landing page  ──────► │ /api/region-loss   (24 h)    │ ───────►  Global Forest Watch
  Dashboard     ──────► │ /api/fires         (30 min)  │ ───────►  NASA FIRMS
                        │ /api/fire-weather  (1 h)     │ ───────►  Meteomatics
                        │ /api/clearing-check (6 h)    │ ───────►  Microsoft Planetary Computer
                        │ /api/climate, /api/species,  │ ───────►  NASA POWER, GBIF, FAO, WDPA
                        │ /api/ai ...                  │ ───────►  Google Gemini
  Phone /listen ──────► │ /api/acoustic                │ ───────►  Email / SMS / Telegram alerts
                        └──────────────────────────────┘
  Static data (public/): region outlines, 6,652 named places, 2 km tree-cover grid
```

- **API keys stay on the server.** The browser only talks to Aniwa’s own routes.
- **Caching** keeps external calls low: region loss for 24 hours (in `data/`), fires for 30 minutes, fire weather for an hour, satellite checks for 6 hours.
- **Static data files** in `public/` are prebuilt from open data and can be rebuilt with the scripts in `scripts/`.

### Tech stack
Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS 4 · MapLibre GL · Three.js · Framer Motion · transformers.js (on-device audio) · Google Gemini

---

## Getting started

### Requirements
- **Node.js 20 or newer** (tested on 22) and npm
- API keys for the features you want (see [Configuration](#configuration)). Only `GFW_API_KEY` is needed for the core figures; everything else is optional and degrades gracefully.

### 1. Install
```bash
git clone https://github.com/awuni1/Aniwa.git aniwa
cd aniwa
npm install
```

### 2. Configure
Create `.env.local` (git-ignored) with your keys. The minimum:
```bash
GFW_API_KEY=your-global-forest-watch-key
NASA_FIRMS_MAP_KEY=your-firms-key
```
See [Configuration](#configuration) for every option.

### 3. Run
```bash
npm run dev
```
- Landing page: <http://localhost:3000>
- Dashboard: <http://localhost:3000/dashboard>
- Phone listener: <http://localhost:3000/listen> (needs HTTPS on a phone; see [Setting up a listening phone](#setting-up-a-listening-phone))

If port 3000 is busy, Next.js picks another and prints it.

### 4. Production
```bash
npm run build
npm start
```

### Other commands
```bash
npm run lint                       # lint the code
node scripts/build-tree-cover.mjs  # rebuild the 2 km tree-cover grid (ESA WorldCover)
node scripts/build-places.mjs      # rebuild the list of named places (OpenStreetMap)
```

---

## Configuration

All settings go in `.env.local`. Never commit this file.

### Data

| Variable | Needed for | How to get it |
|---|---|---|
| `GFW_API_KEY` | Forest loss, 2000 baseline, clearing alerts, protected areas | Free at [data-api.globalforestwatch.org](https://data-api.globalforestwatch.org). Allow the domain `localhost` when you create it. |
| `NASA_FIRMS_MAP_KEY` | Active fires | Free at [firms.modaps.eosdis.nasa.gov/api/map_key](https://firms.modaps.eosdis.nasa.gov/api/map_key) |
| `METEOMATICS_USERNAME`, `METEOMATICS_PASSWORD` | 3-day fire-weather forecast | Account at [meteomatics.com](https://www.meteomatics.com) |
| `GEMINI_API_KEY` | AI analyst and planting plans | Free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

Satellite checks (Microsoft Planetary Computer), heat history (NASA POWER), satellite imagery (NASA GIBS), species (GBIF) and place search (OpenStreetMap) need **no key**.

### Database (recommended for deployment)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (for example Supabase: Project Settings › Database › Connection string). Stores chainsaw detections and the alert logs. Encode special characters in the password (`@` becomes `%40`). Without it, the same data is kept in JSON files in `data/`, which don’t persist on serverless hosts. |
| `DATABASE_CA_CERT_PATH` (or `DATABASE_CA_CERT`) | The database’s CA certificate, so the connection is verified. For Supabase, download it from Project Settings › Database › SSL Configuration and give its file path. **Required in production**; in development Aniwa connects without verification and logs a warning. |

Tables (`acoustic_detections`, `app_state`) are created automatically on first use, with row-level security on so Supabase’s public API can’t read them.

### Phone listener and admin

| Variable | Purpose |
|---|---|
| `ACOUSTIC_DEVICE_KEY` | Phones must send this key to report a chainsaw. **Required in production**: without it the server refuses detections, so nobody can post fake ones. |
| `ADMIN_KEY` | Unlocks setup endpoints (alert tests, Telegram chat list, forced data refresh) via the `x-admin-key` header. Without it they only work under `npm run dev`. |

### Alerts (all optional)

| Channel | Variables | Provider |
|---|---|---|
| Email | `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | [Brevo](https://www.brevo.com) SMTP |
| SMS | `AT_USERNAME`, `AT_API_KEY`, `ALERT_SMS_TO` | [Africa’s Talking](https://africastalking.com) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (comma-separated for several chats) | [@BotFather](https://t.me/BotFather) |
| Demo mode | `ALERT_DEMO_MODE=1` sends SMS/Telegram after a single detection with a 1-minute cooldown. Leave it `0` in the field. | — |

**Normal alert rules:** an email goes out for every chainsaw detection; SMS and Telegram go out when a saw is heard again within 2 km and 10 minutes, then not again for the same area for 30 minutes. New forest-region fires are emailed when the fire data refreshes.

**Scheduled fire checks:** fire alerts are sent when Aniwa fetches new NASA FIRMS data, so a scheduler fetches it every 30 minutes even when nobody has the dashboard open:
- **`npm run dev` / `npm start`:** a built-in timer starts with the server (log line: “fire alerts: checking NASA FIRMS every 30 minutes”). Set `FIRE_ALERT_SCHEDULE=off` to disable it.
- **Vercel:** `vercel.json` calls `/api/cron/fires` every 30 minutes. Set `CRON_SECRET` in Vercel; it’s sent automatically as `Authorization: Bearer …`. Vercel’s free Hobby plan only allows daily cron jobs, so on Hobby use an external scheduler (for example cron-job.org) to call `GET /api/cron/fires` with the header `x-admin-key: <ADMIN_KEY>` every 30 minutes.

**Telegram commands:** the bot also answers questions about deforestation, using the same live data and prediction model as the dashboard:

| Command | Reply |
|---|---|
| `/predict` | The 5 places most likely to be cleared next, with risk %, the reasons (clearing alerts, chainsaws, fires, tree cover left) and map links |
| `/predict Ashanti` | The same within one region |
| `/forest` | Ghana's tree-cover loss since 2000, last year's loss and this month's most active clearing regions |
| `/forest Western` | One region's loss and recent clearing alerts |
| `/chainsaw` | Chainsaws heard in the last 24 hours, possible illegal logging (only in chats listed in `TELEGRAM_CHAT_ID`, since it reveals where listening phones are) |
| `/fires` | Fires in the forest belt over the last 24 hours, which usually mean land being cleared; add a region to narrow it |
| `/status` | Whether forest-loss and NASA data are up to date and when the automatic fire check last ran |
| `/myid` | That chat's ID, to add it to `TELEGRAM_CHAT_ID` |
| `/help` | What Aniwa and the bot do |

In groups it only reacts to commands. Locally the server polls Telegram for messages, so no public URL is needed (`TELEGRAM_POLLING=off` disables it; only one server can poll a bot at a time). When deployed, register the webhook instead, choosing a random `TELEGRAM_WEBHOOK_SECRET`:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

To go back to local polling, call `deleteWebhook` with the same token.

---

## Using Aniwa

### Read the situation (Overview)
Open `/dashboard`. The headline shows the share of Ghana’s 2000 forest lost so far. The cards show clearing in the last 30 days, forest fires in the last 5 days and chainsaws heard. Callouts on the map point to where clearing is happening right now. Hover the trend chart, or focus it and use the arrow keys, to read any year.

### Find and verify hotspots (Predict)
1. Press **Predict where clearing is happening**. Aniwa scores a ~17 km grid across Ghana and lists the 10 riskiest spots with the nearest town.
2. Pick a hotspot, or click anywhere on the map, to see its risk and why.
3. Press **Compare this spot now vs a year ago** to check it with Sentinel-2 and Sentinel-1.
4. A *Clearing likely* result is a lead to check on the ground with forest officers.

### Watch live threats
**Live threats** lists chainsaw detections, NASA forest fires and the fire-weather forecast per region, each named by the nearest town. Click any item to fly the map there.

### Setting up a listening phone
Browsers only allow the microphone on secure (`https://`) pages.

**Option A: phone near your computer.** Put both on the same Wi-Fi (or use the phone’s hotspot), then:
```bash
npx next dev --experimental-https -H <your-computer-IP>
```
Trust the local certificate on the phone (send it `rootCA.pem` from the folder printed by `mkcert -CAROOT`; on iPhone install it in Settings › General › VPN & Device Management, then enable it in Settings › General › About › Certificate Trust Settings). Open `https://<your-computer-IP>:3000/listen`. Never share `rootCA-key.pem`.

**Option B: phone anywhere.** Expose the server through a tunnel:
```bash
npx cloudflared tunnel --url http://localhost:3000
```
Open the printed `https://….trycloudflare.com/listen`. Anyone with that address can reach the app, so set `ACOUSTIC_DEVICE_KEY` and enter the same key on the phone.

On the phone, enter a name and the device key, tap **Start listening**, and allow the microphone and location. In the field: set Auto-Lock to Never (iOS stops the microphone when the screen locks), keep the phone on a charger and leave the page open.

### Test your alerts
```bash
curl -X POST "http://localhost:3000/api/alerts/test?channel=telegram" -H "x-admin-key: $ADMIN_KEY"
```
Use `channel=sms`, `channel=telegram`, or no channel for email. To find a Telegram chat ID, message your bot, then:
```bash
curl "http://localhost:3000/api/alerts/telegram-chats" -H "x-admin-key: $ADMIN_KEY"
```

### Ask the AI analyst
Open the analyst bar, type a question (for example *“Which region should we patrol first this week?”*) or press **Brief me**. Answers are written by Google Gemini from Aniwa’s live data.

---

## API reference

All routes live under `src/app/api/`. Responses are JSON.

| Route | Method | Purpose | Notes |
|---|---|---|---|
| `/api/region-loss` | GET | Loss per region 2001–2024, 2000 baseline, drivers, 30-day alerts | Cached 24 h. `?refresh=1` needs `x-admin-key` |
| `/api/fires` | GET | NASA fires, last 5 days, tagged by region | Cached 30 min |
| `/api/fire-weather` | GET | 3-day forest fire index per forest region | Cached 1 h |
| `/api/clearing-check?lat=&lng=` | GET | Satellite comparison, now vs a year ago | Ghana only. 10 per minute per address |
| `/api/site-check?lat=&lng=` | GET | Is the point inside a protected area (WDPA) | |
| `/api/climate?region=` | GET | Heat history for a region | NASA POWER |
| `/api/species?name=` | GET | Records of a tracked species | GBIF |
| `/api/biodiversity?lat=&lng=&radiusKm=` | GET | Threatened species near a point | GBIF |
| `/api/tree-crops` | GET | Ghana’s tree-crop production | FAO |
| `/api/geocode?q=` | GET | Place search inside Ghana | OpenStreetMap Nominatim |
| `/api/ai` | POST | AI analyst: `{ question?, mode?: "plant" \| "crops", plan? }` | 6 per minute per address, 500 per day in total |
| `/api/acoustic` | GET / POST | List detections / report one from a phone | POST needs `x-device-key`; 30 per minute per address |
| `/api/telegram/webhook` | POST | Receives Telegram messages when deployed | `X-Telegram-Bot-Api-Secret-Token` |
| `/api/cron/fires` | GET | Check NASA fires now and send alerts for new forest fires | `Authorization: Bearer <CRON_SECRET>` or `x-admin-key` |
| `/api/alerts/test?channel=` | POST | Send a test alert | Admin only |
| `/api/alerts/telegram-chats` | GET | List chats that messaged the bot | Admin only |

---

## Data sources

| Source | Used for |
|---|---|
| [Global Forest Watch](https://www.globalforestwatch.org) (Hansen/UMD; GLAD-S2 and RADD alerts; WRI/Google drivers; WDPA) | Tree-cover loss, the 2000 baseline, loss drivers, 30-day clearing alerts, protected areas |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) (VIIRS, MODIS) | Active fires |
| [NASA POWER](https://power.larc.nasa.gov) | Daily maximum temperature since 1991 |
| [NASA GIBS](https://gibs.earthdata.nasa.gov) | Yesterday’s satellite imagery map layer |
| [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com) (Copernicus Sentinel-1 and Sentinel-2) | Satellite clearing checks |
| [ESA WorldCover 2021](https://esa-worldcover.org) | 10 m tree-cover map behind the risk model |
| [Meteomatics](https://www.meteomatics.com) | Forest fire index forecast |
| [GBIF](https://www.gbif.org) | Species records and photos |
| [FAO](https://www.fao.org/faostat) | Tree-crop production |
| [OpenStreetMap](https://www.openstreetmap.org) contributors (ODbL) | 6,652 named places, place search |
| [geoBoundaries](https://www.geoboundaries.org) | Ghana’s 16 region outlines |
| [Google Gemini](https://ai.google.dev) | AI analyst and planting plans |
| Esri World Imagery | Map background |

---

## Security

- API keys are server-side only; the browser never sees them.
- Chainsaw reports need a device key (required in production) and are rate-limited.
- Setup endpoints need `ADMIN_KEY`.
- The AI analyst and satellite checks are rate-limited so quotas can’t be run up.
- Errors sent to the browser are generic; details go to the server log.
- Rate limits are held in server memory. That suits a single server (`npm start`); on a serverless host each instance counts separately, so use a shared store such as Redis.

---

## Known limits

Aniwa states these in the app, next to the feature each one affects.

- **Risk model:** weights come from published research, not training data.
- **Tree-cover map:** ESA WorldCover is a 2021 snapshot, so forest cleared since then still counts as forest.
- **2000 baseline:** Global Forest Watch publishes it only for Ghana’s 10 regions before the 2018 split, so that comparison is made at that level.
- **Loss data** runs to 2024, the latest year published.
- **Satellite checks:** the thresholds are Aniwa’s judgment; treat a result as a lead to check on the ground.
- **Chainsaw model:** it isn’t trained on Ghanaian forest recordings and can confuse motorbikes or generators with saws. The pin marks the phone, not the saw; the ~1 km circle is the search area.
- **Fires** show heat, not cause; only fires in forest-belt regions count as possible clearing.
- **Storage:** with `DATABASE_URL` set, detections and alert logs are kept in Postgres. Data caches are still JSON files in `data/`; on serverless hosts they simply rebuild.

---

## Project structure

```
Aniwa/
├── README.md
├── public/
│   ├── ghana_regions.geojson   Region outlines
│   ├── ghana_places.json       6,652 named places (OpenStreetMap)
│   ├── ghana_tree_cover.json   2 km tree-cover grid (ESA WorldCover)
│   ├── images/                 Landing-page photos
│   ├── sentinel.glb            3D satellite model
│   └── logo.png
├── scripts/
│   ├── build-places.mjs        Rebuilds ghana_places.json
│   └── build-tree-cover.mjs    Rebuilds ghana_tree_cover.json
├── data/                       Runtime caches and detections (git-ignored)
└── src/
    ├── app/
    │   ├── page.tsx            Landing page
    │   ├── dashboard/page.tsx  Dashboard
    │   ├── listen/page.tsx     Phone chainsaw listener
    │   └── api/                Server routes (see API reference)
    ├── components/             Map, panels, 3D scenes, widgets
    └── lib/
        ├── server/             Server-only clients (GFW, FIRMS, Meteomatics,
        │                       Planetary Computer, alerts, security)
        ├── deforestationModel.ts  Risk model
        └── …                   Shared types and helpers

```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Figures show “Live data unavailable” | Check `GFW_API_KEY` is set and allows the domain `localhost`, then restart `npm run dev`. |
| No fires | Check `NASA_FIRMS_MAP_KEY`. FIRMS accepts 1–5 days only. |
| Fire weather says “not configured” | Set `METEOMATICS_USERNAME` and `METEOMATICS_PASSWORD`. Trial accounts expire. |
| AI analyst “isn’t set up” | Set `GEMINI_API_KEY`. |
| Phone can’t use the microphone | The page must be `https://`. Use Option A or B in [Setting up a listening phone](#setting-up-a-listening-phone). |
| Phone reports are rejected (401) | The phone’s device key must match `ACOUSTIC_DEVICE_KEY`. |
| Build fails with a `next/font/google` error | A temporary Google Fonts download failure. Run the build again. |
| Old favicon still shows | Your browser cached it. Hard-refresh, or in Safari clear `~/Library/Safari/Favicon Cache`. |

---

## Roadmap

- Train the risk model on pixel-level loss data.
- Record chainsaws, motorbikes and generators in Ghana’s forests to retrain the sound model.
- Pilot with forest guards in Western North.
- Re-enable and refine the full set of dashboard sections.

---

## License and credits

Licensed under the MIT License. See [LICENSE](./LICENSE).

Built for the **NASA Space Apps Challenge 2026**. Data courtesy of Global Forest Watch, NASA, ESA/Copernicus, Microsoft Planetary Computer, Meteomatics, GBIF, FAO and OpenStreetMap contributors.
