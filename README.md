# STRATA · Mine Operations Intelligence

A complete, offline **desktop application** for monitoring an open-pit mine. It covers the fleet,
production, sensors, fuel, cameras (live and recorded), a 360° view, alerts, reports and admin.
Every machine, sensor and camera is **simulated** on your computer, so it looks and behaves like a live
production system with no hardware. Everything runs offline; when the computer is online, the live map also shows real satellite imagery.

STRATA is an original product. It shares the concepts of PLRMS-style systems, but none of their branding, logos or layouts.

---

## 1. Quick start

**You need:** Node.js 20.11 or newer (tested on 24), pnpm 9 or newer, and Rust (stable) for the desktop shell.
On Windows, WebView2 is already part of Windows 10 and 11.

```bash
cd Desktop/plrms-demo
pnpm install
pnpm run dev          # opens STRATA as a desktop app window
```

- The **first run** compiles the small Rust desktop shell. This takes about 1–3 minutes, and later runs are instant.
- The first run also **creates the database** and **simulates the last 7 days** of mine operation, which takes about 15 s. That gives every report, chart and recording real history from the first minute.
- Afterwards, whenever STRATA starts, it simulates any hours it was closed, so there are never gaps.

### Build an installer (share it or demo on any PC)

```bash
pnpm run build
```

This produces installers in `src-tauri/target/release/bundle/`, for example `nsis/STRATA_1.0.0_x64-setup.exe`.
The installed app is **self-contained**: it carries its own Node.js runtime, database engine, simulator and
user interface. The target PC needs **nothing else installed and no internet connection**. Data is kept per user, in
`%APPDATA%\com.winteg.strata` on Windows, together with `engine.log`.

### Other ways to run it

| Command | What it does |
|---|---|
| `pnpm dev` | Desktop app with hot reload (Tauri window plus engine) |
| `pnpm dev:web` | The same app in a normal browser at http://127.0.0.1:5180 |
| `pnpm build` | Desktop installer (runs `desktop:prepare` first) |
| `pnpm build:web` then `pnpm start` | Optimised web build served on port 5180 |
| `pnpm db:seed` | Create the database and history now (if empty) |
| `pnpm db:reset` | Delete all data and generate a fresh fleet and week of history |
| `pnpm typecheck` | TypeScript check of the server and UI |
| `DB_PATH=./data/stress.db pnpm sim:stress 7` | 7-day robustness test of the simulator with forced faults (separate DB file) |

Settings are optional: copy `.env.example` to `.env` to change the port, admin login, history days or start speed.

---

## 2. Logins

| Role | Email | Password |
|---|---|---|
| **Administrator** | `aritradatt39@gmail.com` | `Aritradutta@2005` |
| Supervisor | `supervisor@strata.demo` | `Demo@1234` |
| Operator | `operator@strata.demo` | `Demo@1234` |
| Viewer (read-only) | `viewer@strata.demo` | `Demo@1234` |

Passwords are stored as **bcrypt hashes**, never in plain text. Sessions use an HTTP-only signed cookie
(HS256, 12 h). The signing secret is generated on first run into the data folder.

> These credentials are for the demo. Change the admin password in **Account menu → Change password** before
> handing the app to anyone, and remove the defaults from `.env`/README if this becomes a real deployment.

---

## 3. Feature tour

| Screen | What you can show |
|---|---|
| **Command** | Live KPIs (TPH vs target, tonnes today, availability, utilisation, fuel burn, cycle time, alerts) with sparklines; live site map; 24 h production; fleet status; loading units; camera spotlight; shift target; activity feed. **Customise**: drag to reorder, resize, add or remove widgets (saved per user). |
| **Live map** | **Real satellite imagery** (Esri World Imagery) of an open-pit iron-ore mining area in eastern India. The simulator's haul roads, faces, crusher, ROM pad, dump, fuel bay and workshop are traced onto the real pit, so 38 machines drive along the haul roads you see in the imagery. It has trails, zoom and pan (sharper tiles as you zoom), layers (satellite on or off, roads, labels, trails, IDs), filters by type and status, and a click-for-details card with *follow*. Offline, it falls back to a drawn site plan automatically. |
| **Fleet** | **Machines** (searchable virtualised table, add, edit, delete, take out of service, CSV export) · **Dispatch** (trucks per loader, match factor, move trucks, route change, auto-dispatch when a loader breaks down) · **Crews & shifts** (operators, 7-day performance, roster per shift) · **Maintenance** (work orders: schedule, start, complete, cancel; planned work actually takes machines out of production) · **Downtime** (lost-time chart by reason, log and close records). |
| **Machine page** | Overview (live stats, map, today's hours, fuel, tonnes, assignment, crew, specs), live sensors, all cameras, 360°, production events, fuel history, maintenance, downtime and alerts for one machine. |
| **Production** | TPH per hour against target, ore and waste, TPH per loader, routes against target cycle, truck performance, shifts and top operators, cycle analysis (distribution, passes per load, payload bands, stage breakdown per route). |
| **Sensors** | Per-machine gauges with warning and critical bands, sparklines, tyre pressure and temperature diagram, boom, stick, arm and swing diagram; a fleet **sensor matrix** coloured by threshold; history charts. |
| **Cameras** | **Real mining footage** with STRATA overlays: OSD, REC, payload and bucket readouts, driver-monitoring box, parking guides and proximity lines. Feeds follow the machine: driving cameras freeze when it stops, the tray camera fills with the payload, and work cameras run only while the machine works. Night vision applies after 19:00. **Live wall** (one machine, or a fleet wall of 4, 9 or 16 feeds; snapshot, record, full screen, focus view) · **Playback DVR** (pick machine, camera, date and time; play, pause, 1–32× speed, ±10 s steps, 24 h, 2 h or 20 min timeline coloured by machine status, alert markers, jump to next or previous event, 4-camera synced view, snapshot, export clip) · **Event clips** (every alert opens the camera that saw it, 15 s before) · **Snapshots & recordings** gallery with an in-app video player. |
| **360° view** | Built from the machine's **own four surround cameras**. **360° cameras** stitches the front, right, rear and left feeds into one ring you drag to look around, with nearby machines tagged at their real bearing and distance, auto-pan and field-of-view zoom. **Bird's-eye** warps the ground part of each feed into a top-down around-view with proximity zones. **3D twin** is a model driven by live sensor values, with camera-coverage cones. |
| **Fuel** | Live burn rate, litres per tonne against target, idle fuel, refuel log, efficiency per machine, theft and leak anomalies, *Log refuel*. |
| **Alerts** | Real-time list with severity, bulk acknowledge and resolve, detail drawer (timeline, notes, event clip, locate on map), history with CSV export, analytics. Pop-ups for new alerts can be muted. |
| **Reports** | Shift, daily and weekly reports with KPIs, charts and tables. **PDF** includes charts. **CSV** is available per section. |
| **Admin** | Users and roles, sensor definitions and thresholds (live), KPI targets, alert behaviour, display units (°C/°F, psi/bar/kPa, km/h/mph, t/st, L/gal), site and shift pattern, haul routes, machines and cameras, appearance (dark and light), audit log, data and retention. |

**Global:** Ctrl/⌘ K search (machines, cameras, operators, alerts, pages, actions) · `?` shortcuts · `g` then a
letter to jump to a page (g d, g m, g f, g p, g s, g c, g v, g u, g a, g r, g x) · Shift T theme · `[` sidebar.

### The hidden Demo Control panel

Press **Ctrl + Shift + D**, or use *Account menu → Demo control* (supervisor and admin only).

- **Clock:** pause, or run at **1×, 2×, 5×, 10×, 30× or 60×** speed.
- **Scenarios**, on a chosen or automatic machine: truck overload, engine overheat, breakdown, low fuel,
  fuel theft, operator fatigue, phone use, collision risk, overspeed, tyre leak, camera offline, and shift change.
- **Reset data** (admin) regenerates the fleet and a fresh week of history.

---

## 4. Ten-minute client demo script

1. **Sign in** as the administrator. *"This is the control room view for the whole site."*
2. **Command:** point at the KPI row. Throughput is compared with target, availability and utilisation are live, and the sparklines move.
   Hover the map to show machines moving twice a second. Click **Customise**, drag a widget, then **Done**.
3. **Live map:** this is real satellite imagery of a mine. Filter to *Haul truck*, click a truck, then **Follow** and zoom in to watch it drive the real haul road.
4. **Fleet → Dispatch:** show the trucks per shovel and the match factor. Move a truck to another loader and watch it re-route on the map.
5. Open **Demo Control** (Ctrl + Shift + D), pick a shovel and trigger **Breakdown**. A critical alert pops up, the
   shovel turns red, and its trucks are auto-dispatched. Open **Fleet → Maintenance** to show the work order raised automatically.
6. **Sensors:** choose a truck. Show the gauges, tyre diagram and thresholds. Trigger **Engine overheat** and watch the
   gauge go amber, then red, and raise an alert.
7. **Cameras → Live wall:** open the fleet wall, hover a feed, and take a **Snapshot** and a short **Recording**.
8. Trigger **Operator fatigue**, then open **Alerts**. Click the alert, then **Event clip**: the cabin camera plays from
   15 s before the event, showing the driver-monitoring box turning red. Acknowledge and resolve it with a note.
9. **Cameras → Playback:** pick yesterday 14:00 on a truck. Press play at 8×, jump between events, switch to the 4-camera view, and **Export clip**.
10. **360° view:** pick an excavator, drag around the **360° cameras** ring (nearby trucks are tagged at their distance), switch to **Bird's-eye**, then show the **3D twin**.
11. **Production → Cycle analysis**, then **Fuel**: show litres per tonne against target and the fuel theft anomaly (trigger **Fuel theft** first).
12. **Reports → Daily**, then **PDF report**. Open the PDF. *"Shift and weekly reports are one click too."*
13. **Admin → Sensors & thresholds:** lower the engine-temperature warning limit and show alerts react
    immediately. Switch to the **light theme** in Appearance.
14. Sign in as **viewer@strata.demo** to show that read-only users cannot change anything.

Tip: before a meeting, set the Demo Control clock to **5×** for a minute or two so the KPIs and charts are visibly moving.

---

## 5. Architecture

```
┌──────────── Tauri desktop shell (Rust) ────────────┐
│  window · single instance · starts/stops engine     │
│  ┌──────────── WebView (Chromium/WebKit) ────────┐  │
│  │ React 19 UI  (Vite, Tailwind v4, Radix,        │  │
│  │ ECharts, three.js/R3F, Framer Motion, cmdk)    │  │
│  └──────▲───────────────────────────▲─────────────┘  │
│         │ REST /api (cookie auth)   │ WebSocket /ws (2 frames/s)
│  ┌──────┴───────────────────────────┴─────────────┐  │
│  │ STRATA engine (Node.js, Express, ws)            │  │
│  │  ├ simulator: road graph, load & haul cycles,   │  │
│  │  │  sensors, faults, alerts, shifts, dispatch   │  │
│  │  ├ alert manager · retention · KPIs             │  │
│  │  └ SQLite (better-sqlite3 + Drizzle migrations) │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

- **One engine process** serves the UI, the API and the live socket, and runs the simulator on one port.
  `pnpm dev` adds Vite (hot reload) as middleware. The installed app bundles the engine into one file
  plus a private Node runtime (`scripts/bundle-backend.mjs`).
- **Live data:** the simulator steps 5× per second (sub-stepped when sped up) and pushes a compact frame of all
  machines plus KPIs twice a second. The UI keeps it in a small zustand store, and charts and sparklines read
  ring buffers, so only the widgets whose data changed re-render. Lists are virtualised, routes and the 3D view are
  lazy-loaded, and camera canvases pause when they are off-screen.
- **Cameras use real footage** (29 licence-free mining clips in `public/footage`, about 40 MB; see
  `public/footage/CREDITS.md`), chosen per machine type and camera position. A footage player for each feed keeps the
  clip in step with the machine: playback speed follows ground speed, the feed freezes when the machine stops, the tray
  view is scrubbed by payload percentage, and playback follows the DVR clock (pause, 1–32×). STRATA draws its own
  overlays on every frame, so snapshots and recordings include them. A drawn fallback shows while a clip loads.
  Recording uses the browser's MediaRecorder. Clips are kept in the WebView's IndexedDB, and their metadata goes to the database.
  Every view of the same camera (wall tile, panorama, bird's-eye, full screen) shares one video decoder, and feeds
  nobody is drawing are paused. Night vision is a single blend-mode fill per frame; `ctx.filter` was avoided because it
  allocates a layer per draw.
- **Sign-in screen:** four HD cuts of real mining footage (`public/hero`, about 9 MB) cross-fade with a slow zoom.
  Only the visible clip decodes.
- **Satellite map:** tiles are placed with Web Mercator maths from the site's geo-anchor (`shared/site.ts`, `GEO`).
  The zoom level follows the screen scale, with a coarse layer underneath while sharp tiles load.

### Data model (SQLite)

`users`, `user_prefs` (theme, dashboard layout) · `settings` (site, shifts, KPI targets, units, dispatch,
alert behaviour) · `machines`, `cameras`, `operators`, `roster` (machine × shift), `routes` ·
`sensor_defs` (label, unit type, machine types, warn and crit limits, enabled) · `telemetry` (per machine:
position, status, speed, payload, fuel, engine, brakes, tyres, hydraulics, boom, swing…) ·
`production_events` (one row per tipped load, with queue, spot, load, haul, dump and return times) ·
`machine_shift_stats` (operating, idle, down, maintenance seconds, fuel, distance, tonnes per machine per shift) ·
`fuel_events`, `alerts`, `downtime`, `maintenance`, `snapshots`, `recordings`, `audit_log`.

### Retention and size

Telemetry is written every 10 s, thinned to 1 per minute after 2 h and to 1 per 5 min after 48 h, and dropped after
the history window (7 days). Events, alerts and fuel records are kept 35 days, and the 300 newest snapshots are kept. The
database stays around 30–60 MB.

### The simulation

- **The fleet:** 38 machines. 2 hydraulic shovels, 4 excavators, 2 wheel loaders, 19 haul trucks (CAT 793F, 785D and 777G;
  Komatsu 830E), 3 dozers, 2 drill rigs, 2 water tankers and 4 light vehicles, each with named operators on three
  8-hour shifts (A Day 06–14, B Evening 14–22, C Night 22–06).
- **Load and haul:** trucks drive a road network with speed limits and grades, follow each other, queue at the
  loader, spot, and receive 3–5 bucket passes (with occasional overloads). They haul loaded up the ramp, tip at the crusher, ROM pad
  or waste dump, and return. Loading units run dig, swing, dump and return phases that drive the boom, stick and swing sensors.
- **Daily life:** shift handovers, staggered crib breaks, refuelling at the fuel bay or by a field service truck,
  water-tanker refills, planned maintenance (machines go to the workshop), random breakdowns with work orders,
  overheating, tyre leaks, fuel theft, fatigue and phone-use events, proximity events between light vehicles and
  trucks, and overspeed on zone limits.
- **Robustness:** auto-dispatch re-routes trucks when a loader stops. Traffic passes broken-down machines, and a
  gridlock watchdog keeps vehicles moving. `pnpm sim:stress 7` runs a week with forced breakdowns every 4 h and reports any stuck truck.

---

## 6. Decisions and assumptions

- **Tauri desktop shell with a Node engine,** instead of Next.js. One engine process does real-time simulation,
  SQLite and WebSockets. Tauri provides a native, light window and installer, and the engine ships inside it with its own
  runtime, so the demo PC needs nothing installed.
- **SQLite + Drizzle** for the schema and migrations, with hand-written SQL for the reporting aggregates
  (clearer and faster for GROUP BY-heavy queries).
- **Own component kit on Radix primitives** instead of generating shadcn/ui. It has the same accessibility, needs no CLI or
  network step, and has a distinct visual identity: a control-room dark theme with "ore" amber accents and a light theme.
- **Real stock footage, bundled.** Video works offline. Real footage cannot show a machine's exact live state, so each clip is chosen and driven by that state (speed, working, payload, day or night) rather than matching it frame by frame.
- **Free satellite imagery instead of Google Maps.** Google needs an API key with billing and does not allow offline use. Esri World Imagery needs no key, and the map falls back to the site plan when offline. The imagery is a real mining area; the site name, company, operators and production are fictional.
- **Times follow your computer's clock and time zone.** If you speed the simulation up, the app runs ahead of
  real time until you reset. Demo Control shows how far ahead it is.
- Recorded clips live in the WebView storage of the computer that recorded them. Snapshots are stored in the database.
- The admin email and password come from the brief and are seeded once. Change them in production.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm dev` says port 5180 is busy | Another copy is running. Close it, or set `PORT=5181` in `.env` **and** `devUrl` in `src-tauri/tauri.conf.json`. |
| Want a fresh demo | Demo Control → Reset data, or `pnpm db:reset` (dev database). In the installed app, delete `%APPDATA%\com.winteg.strata`. |
| Desktop window is blank on first `pnpm dev` | Wait: the engine is still simulating the first week of history (shown in the terminal). |
| Installed app shows "could not start" | Read `engine.log` in `%APPDATA%\com.winteg.strata`. |
| Recording button missing | Viewer accounts cannot record. Use operator, supervisor or admin. |
