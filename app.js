"use strict";
// ---------- config ----------
// Sign-in with Google / Apple. Paste the Firebase web config here to switch it on (see README).
const FIREBASE_CONFIG = null;
const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
const DATA_URL = "data/lt.json";
const SEARCH_KM = 25;          // look this far (straight line); the cost model decides what is worth it
const ROAD_FACTOR = 1.3;       // roads are ~30% longer than a straight line
const CAR_DEFAULTS = { cons: 17, wear: 0.05, timeVal: 6 }; // kWh/100 km, €/km (tyres, servicing, depreciation), €/h
const speedFor = km => km < 10 ? 30 : 55; // km/h: town driving vs. out-of-town
const CITIES = [
  { id: "vilnius", en: "Vilnius", lt: "Vilniaus", c: [54.687, 25.280] },
  { id: "kaunas", en: "Kaunas", lt: "Kauno", c: [54.898, 23.904] },
  { id: "klaipeda", en: "Klaipėda", lt: "Klaipėdos", c: [55.712, 21.135] },
  { id: "siauliai", en: "Šiauliai", lt: "Šiaulių", c: [55.934, 23.315] },
  { id: "panevezys", en: "Panevėžys", lt: "Panevėžio", c: [55.737, 24.357] },
];
// Towns used to describe a location ("near Ukmergė"), since the data has no station names.
const TOWNS = [["Vilnius",54.687,25.280],["Kaunas",54.898,23.904],["Klaipėda",55.712,21.135],["Šiauliai",55.934,23.315],["Panevėžys",55.737,24.357],["Alytus",54.396,24.046],["Marijampolė",54.559,23.354],["Utena",55.497,25.599],["Mažeikiai",56.309,22.341],["Jonava",55.083,24.280],["Kėdainiai",55.288,23.974],["Telšiai",55.981,22.247],["Tauragė",55.252,22.290],["Ukmergė",55.245,24.776],["Visaginas",55.598,26.438],["Plungė",55.912,21.844],["Kretinga",55.889,21.242],["Palanga",55.917,21.069],["Šilutė",55.349,21.483],["Radviliškis",55.811,23.546],["Gargždai",55.712,21.391],["Druskininkai",54.016,23.973],["Rokiškis",55.962,25.586],["Biržai",56.201,24.756],["Elektrėnai",54.785,24.661],["Garliava",54.817,23.872],["Jurbarkas",55.078,22.765],["Kuršėnai",56.004,22.937],["Vilkaviškis",54.651,23.035],["Raseiniai",55.381,23.116],["Anykščiai",55.526,25.103],["Lentvaris",54.644,25.051],["Grigiškės",54.680,25.090],["Prienai",54.634,23.946],["Kelmė",55.631,22.932],["Varėna",54.221,24.570],["Kaišiadorys",54.866,24.453],["Pasvalys",56.059,24.403],["Kupiškis",55.840,24.975],["Zarasai",55.731,26.247],["Skuodas",56.270,21.528],["Kazlų Rūda",54.749,23.490],["Širvintos",55.044,24.957],["Molėtai",55.230,25.418],["Šalčininkai",54.309,25.385],["Šakiai",54.954,23.048],["Ignalina",55.340,26.164],["Pabradė",54.981,25.761],["Švenčionys",55.131,26.159],["Trakai",54.638,24.934],["Lazdijai",54.234,23.517],["Kalvarija",54.415,23.226],["Birštonas",54.606,24.033],["Joniškis",56.240,23.616],["Pakruojis",55.979,23.858],["Naujoji Akmenė",56.316,22.889],["Nida",55.304,21.005],["Rietavas",55.725,21.932],["Nemenčinė",54.849,25.476],["Vievis",54.766,24.802]];

// ---------- small helpers ----------
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let lang = store.get("lang", (navigator.language || "").toLowerCase().startsWith("lt") ? "lt" : "en");
const T = () => I18N[lang];
const money = n => lang === "lt" ? n.toFixed(2).replace(".", ",") + " €" : "€" + n.toFixed(2);
const kwhPrice = n => money(n) + "/kWh";
const translateTariff = s => lang === "lt" ? s : s.replace(/€\/val\. parkavimo mokestis/g, "€/h parking fee").replace(/Nemokamai?/g, "Free");
function km(a, b, c, d) { const r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }
function townOf(l) {
  let best = "", bd = 1e9;
  for (const [n, la, lo] of TOWNS) { const d = km(l.la, l.lo, la, lo); if (d < bd) { bd = d; best = n; } }
  if (bd < 5) return best;
  return lang === "lt" ? `${best} (apylinkės)` : `near ${best}`;
}
const colourOf = p => p == null ? "#94a3b8" : p === 0 ? "#0ea5e9" : p <= 0.29 ? "#16a34a" : p <= 0.37 ? "#f59e0b" : "#dc2626";
const levelOf = p => p == null ? T().unknown : p === 0 ? T().free : p <= 0.29 ? T().cheap : p <= 0.37 ? T().average : T().expensive;
function toast(msg, ms = 3500, sub = "") {
  const t = $("toast");
  $("toastT").textContent = msg; $("toastS").textContent = sub; $("toastS").hidden = !sub;
  t.hidden = true; void t.offsetWidth; t.hidden = false;           // restart the drop-in animation
  clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, ms);
}

// ---------- state ----------
let L = [], DATA = null, selected = null, userPos = null, lastOrigin = null;
let homeLoc = store.get("home", null);              // [lat, lon] or null
let car = { ...CAR_DEFAULTS, ...store.get("car", {}) };
let fastOnly = store.get("fastOnly", false), hideUnknown = store.get("hideUnknown", false);
// ---------- the driver's car (optional) ----------
// row from data/cars.json: [brand, model, variant, year, battery kWh, kWh/100 km, AC max kW, DC max kW, ports]
let myCar = store.get("myCar", null);
const carLabel = c => [c[0], c[1], c[2]].filter(Boolean).join(" ") + (c[3] ? ` (${c[3]})` : "");
// Can this car fast-charge here? ports: 1 = CCS, 2 = CHAdeMO; station ct: 2 = CCS, 4 = CHAdeMO
const carFitsDC = l => !myCar || ((myCar[8] & 1) && (l.ctb & 2)) || ((myCar[8] & 2) && (l.ctb & 4));
const isFast = l => l.kw > 22 && carFitsDC(l);
function offerPrice(o, l, fast) {
  if (fast) { if (!isFast(l)) return null; if (o.dc != null) return o.dc; return o.m; }
  if (l.kw > 22 && !carFitsDC(l)) return o.ac;   // the car can only use the slow (AC) side here
  return o.m;
}
// Effective charging power and time for this car at this station.
function chargeTime(l, kwh) {
  const fast = isFast(l);
  let kw = fast ? l.kw : Math.min(l.kw, 22);
  if (myCar) kw = Math.min(kw, fast ? (myCar[7] || kw) : (myCar[6] || 11));
  const avg = fast ? kw * 0.7 : kw;                // fast charging slows down as the battery fills
  return { kw: Math.round(kw), min: Math.round(kwh / Math.max(avg, 1) * 60 / 5) * 5 };
}
function priceOf(l, fast = fastOnly) {
  let best = null, offer = null;
  for (const o of l.offers) { const p = offerPrice(o, l, fast); if (p != null && (best == null || p < best)) { best = p; offer = o; } }
  return { p: best, o: offer };
}

// ---------- map ----------
const LITHUANIA = { center: [23.9, 55.2], zoom: 6.3, pitch: 0, bearing: 0 };
// People who switched on "reduce motion" on their phone get no spinning, pulsing or long flights.
const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const firstVisit = !store.get("seenGlobe", false);
const map = new maplibregl.Map({
  container: "map", style: MAP_STYLE, attributionControl: { compact: true },
  // first visit starts from space and flies in; later visits open straight on Lithuania
  ...(firstVisit ? { center: [23.9, 50], zoom: 1.6 } : LITHUANIA),
  maxPitch: 75, dragRotate: true, touchPitch: true, pitchWithRotate: true,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
map.on("style.load", () => {
  try { map.setProjection({ type: "globe" }); } catch (e) { console.warn("Globe view not supported", e); }
  // blue atmosphere glowing around the edge of the globe, fading out as you zoom in
  try { map.setSky({ "sky-color": "#0a1f4d", "horizon-color": "#3d7be0", "fog-color": "#0a1f4d",
    "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.9,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 9, 0] }); } catch {}
  nightEarth();
});

// "Earth at night" look: deep blue seas, near-black land, faint roads and borders, soft labels.
function nightEarth() {
  const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, val); } catch {} };
  for (const ly of map.getStyle().layers) {
    const sl = ly["source-layer"] || "", id = ly.id;
    if (ly.type === "background") set(id, "background-color", "#040a19");
    else if (sl === "water" && ly.type === "fill") { set(id, "fill-color", ["interpolate", ["linear"], ["zoom"], 2, "#1b4a8c", 8, "#163f78", 13, "#123563"]); set(id, "fill-outline-color", "#2a63b5"); }
    else if (sl === "waterway") set(id, "line-color", "#1d4f91");
    else if ((sl === "landcover" || sl === "landuse" || sl === "park") && ly.type === "fill") { set(id, "fill-color", "#07122a"); set(id, "fill-opacity", 0.6); }
    else if (sl === "building" && ly.type === "fill") set(id, "fill-color", "#0c1a36");
    else if (sl === "building" && ly.type === "fill-extrusion") set(id, "fill-extrusion-color", "#0f2145");
    else if (sl === "transportation" && ly.type === "line") set(id, "line-color", ["interpolate", ["linear"], ["zoom"], 6, "rgba(120,160,230,0.10)", 12, "rgba(120,160,230,0.32)", 16, "rgba(150,185,245,0.45)"]);
    else if (sl === "boundary" && ly.type === "line") set(id, "line-color", "rgba(140,180,255,0.35)");
    else if (ly.type === "symbol") {
      if (/poi|housenumber/.test(id)) { try { map.setLayoutProperty(id, "visibility", "none"); } catch {} }
      else { set(id, "text-color", "#9fb6e0"); set(id, "text-halo-color", "rgba(4,10,25,0.85)"); }
    }
  }
}

// Price level of a location, used for both the colour and the marker icon.
const levelKey = p => p == null ? "unk" : p === 0 ? "free" : p <= 0.29 ? "cheap" : p <= 0.37 ? "mid" : "high";
const LEVEL_COLOURS = { free: "#0ea5e9", cheap: "#16a34a", mid: "#f59e0b", high: "#dc2626", unk: "#94a3b8" };

// ---------- level of detail ----------
// From far away only a few of the best stations are shown; more appear with every zoom step.
// The map is split into a grid of cells about CELL_PX(z) pixels wide and each cell shows at most
// one station, the best-ranked one. Stations keep the zoom at which they first appear (mz),
// so nothing disappears while zooming in.
const LOD_MIN = 5, LOD_MAX = 15;                       // from LOD_MAX on, every station shows
const CELL_PX = z => z <= 7 ? 95 : z <= 9 ? 90 : z <= 11 ? 75 : z <= 13 ? 55 : 40;
const mercX = lon => (lon + 180) / 360;
const mercY = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
let lodItems = [], lodLevel = null, pinned = new Set(); // pinned: Best Charge results, always shown

function buildLod() {
  lodItems = [];
  for (const l of L) {
    if (fastOnly && !isFast(l)) continue;
    const { p } = priceOf(l);
    if (hideUnknown && p == null) continue;
    // lower rank = more important: known low price first, then fast chargers and bigger sites
    const rank = (p == null ? 1000 : p === 0 ? 60 : p * 100) - (isFast(l) ? 8 : 0) - Math.min(l.n, 8);
    lodItems.push({ l, p, rank, x: mercX(l.lo), y: mercY(l.la), mz: LOD_MAX });
  }
  lodItems.sort((a, b) => a.rank - b.rank);
  for (let z = LOD_MIN; z < LOD_MAX; z++) {
    const size = CELL_PX(z) / (256 * 2 ** z), taken = new Set();
    const cell = it => Math.floor(it.x / size) + ":" + Math.floor(it.y / size);
    for (const it of lodItems) if (it.mz <= z) taken.add(cell(it));      // already visible keep their cells
    for (const it of lodItems) if (it.mz > z) { const c = cell(it); if (!taken.has(c)) { taken.add(c); it.mz = z; } }
  }
}

function geojson() {
  const z = Math.max(LOD_MIN, Math.floor(map.getZoom()));
  const kwh = +$("kwh").value;
  const features = [];
  for (const it of lodItems) {
    if (it.mz > z && it.l.i !== selected && !pinned.has(it.l.i)) continue;
    const { l, p } = it, k = levelKey(p);
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [l.lo, l.la] },
      properties: { i: l.i, rank: it.rank, c: colourOf(p), known: p == null ? 0 : 1, pin: pinned.has(l.i) || l.i === selected ? 1 : 0, icon: `badge-${k}${isFast(l) ? "-dc" : ""}`,
        label: p == null ? "" : p === 0 ? T().free : money(p * kwh) } });   // what this charge costs, not €/kWh
  }
  return { type: "FeatureCollection", features };
}

// Round badge marker (design option D): dark circle, price-coloured ring and charger glyph,
// a yellow lightning badge for fast (DC) chargers; the selected version is filled.
function badgeSVG(colour, dc, selected) {
  const ring = selected ? `<circle cx="20" cy="20" r="18" fill="${colour}" stroke="#ffffff" stroke-width="2.5"/>`
    : `<circle cx="20" cy="20" r="17" fill="#141f30" stroke="${colour}" stroke-width="4"/>`;
  const g = selected ? "#ffffff" : colour;
  const glyph = `<g fill="none" stroke="${g}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="13" y="11" width="9" height="16" rx="2"/><path d="M18 14.5 16.5 18h3l-1.5 3.5"/>
    <path d="M22 19h1.5a1.2 1.2 0 0 1 1.2 1.2v2.3a1.2 1.2 0 0 0 2.4 0V17l-1.2-1.6"/></g>`;
  const fast = dc ? `<circle cx="32" cy="8" r="7" fill="#facc15" stroke="#0b1220" stroke-width="2"/><path d="M33 4.2 30 8.6h2.2l-.8 3.2 3-4.4h-2.2z" fill="#0b1220"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 40 40">${ring}${glyph}${fast}</svg>`;
}
function loadBadges() {
  const jobs = [];
  for (const [k, colour] of Object.entries(LEVEL_COLOURS)) for (const dc of [false, true]) for (const sel of [false, true]) {
    const name = `badge-${k}${dc ? "-dc" : ""}${sel ? "-sel" : ""}`;
    jobs.push(new Promise(resolve => {
      const img = new Image(80, 80);
      img.onload = () => { if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 }); resolve(); };
      img.onerror = resolve;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(badgeSVG(colour, dc, sel));
    }));
  }
  return Promise.all(jobs);
}

async function addLayers() {
  await loadBadges();
  buildLod(); lodLevel = Math.floor(map.getZoom());
  map.addSource("chargers", { type: "geojson", data: geojson() });
  map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // One marker layer for every zoom. Markers that would overlap are hidden (collision detection),
  // so the map shows a few of the best stations from far away and more as you zoom in.
  map.addLayer({ id: "badges", type: "symbol", source: "chargers",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 9, 0.6, 13, 0.85, 16, 1.05],
      "icon-padding": 2,
      "icon-allow-overlap": true, "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "rank"],
      // prices appear under the markers when zoomed in close; a hidden label never hides its marker
      "text-field": ["step", ["zoom"], "", 12.5, ["get", "label"]],
      "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": "#f1f5f9", "text-halo-color": "#0b1220", "text-halo-width": 1.8 } });
  // soft glow under each marker in its price colour; stronger for recommended and selected stations
  map.addLayer({ id: "glow", type: "circle", source: "chargers", filter: ["==", ["get", "known"], 1],
    paint: { "circle-color": ["get", "c"], "circle-blur": 1,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["==", ["get", "pin"], 1], 16, 7], 14, ["case", ["==", ["get", "pin"], 1], 34, 18]],
      "circle-opacity": ["case", ["==", ["get", "pin"], 1], 0.6, 0.28] } }, "badges");
  // Charging locations as night lights, like cities seen from space: every location, warm and glowing,
  // strongest from far away and fading out as the badges take over.
  map.addSource("lights", { type: "geojson", data: { type: "FeatureCollection",
    features: L.map(l => ({ type: "Feature", geometry: { type: "Point", coordinates: [l.lo, l.la] }, properties: {} })) } });
  map.addLayer({ id: "lights-halo", type: "circle", source: "lights", maxzoom: 13,
    paint: { "circle-color": "#ffcf6b", "circle-blur": 1, "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 7, 12, 10],
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.35, 9, 0.22, 12.5, 0] } }, "glow");
  map.addLayer({ id: "lights", type: "circle", source: "lights", maxzoom: 13,
    paint: { "circle-color": "#fff3c4", "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 8, 1.6, 12, 2.2],
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.95, 10, 0.6, 12.5, 0] } }, "glow");
  // animated "data connection" lines from the start point to the Best Charge results
  map.addSource("links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "links-glow", type: "line", source: "links", layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "c"], "line-width": 10, "line-blur": 8, "line-opacity": 0.45 } }, "glow");
  map.addLayer({ id: "links", type: "line", source: "links", layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "c"], "line-width": ["case", ["==", ["get", "best"], 1], 3, 2], "line-opacity": 0.95 } }, "glow");
  map.addLayer({ id: "selected", type: "symbol", source: "chargers", filter: ["==", ["get", "i"], -1],
    layout: { "icon-image": ["concat", ["get", "icon"], "-sel"], "icon-size": 1.25, "icon-allow-overlap": true, "icon-ignore-placement": true } });
  // start point as a glowing white ring with a bright core
  map.addLayer({ id: "me-halo", type: "circle", source: "me",
    paint: { "circle-color": ["match", ["get", "kind"], "home", "#a78bfa", "#9cc3ff"], "circle-radius": 22, "circle-blur": 1, "circle-opacity": 0.55 } });
  map.addLayer({ id: "me", type: "circle", source: "me",
    paint: { "circle-color": "#ffffff", "circle-radius": 5.5, "circle-stroke-color": "rgba(255,255,255,0.9)", "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.9, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "me-ring", type: "circle", source: "me",
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": 13, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.6, "circle-stroke-opacity": 0.85 } });
  for (const layer of ["badges", "selected"]) {
    map.on("click", layer, e => select(e.features[0].properties.i, false));
    map.on("mouseenter", layer, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", layer, () => map.getCanvas().style.cursor = "");
  }
}
function refreshMap(rebuild = true) { if (rebuild) buildLod(); const s = map.getSource("chargers"); if (s) s.setData(geojson()); highlight(); }
map.on("zoom", () => { const z = Math.floor(map.getZoom()); if (z !== lodLevel && map.getSource("chargers")) { lodLevel = z; refreshMap(false); } });
function highlight() { if (map.getLayer("selected")) map.setFilter("selected", ["==", ["get", "i"], selected ?? -1]); }

// ---------- station detail ----------
function select(i, fly = true) {
  selected = i; refreshMap(false);
  const l = L[i], t = T(), kwh = +$("kwh").value;
  const { p, o } = priceOf(l);
  const priced = l.offers.filter(x => x.m != null).length;
  // The big number: what this charge costs in total (including the trip when we know where you start).
  let amount = null, parts = [];
  if (p != null && p > 0) {
    amount = p * kwh; parts.push(`${t.chargingLbl} ${money(p * kwh)}`);
    if (lastOrigin) { const c = tripCost(km(lastOrigin.pos[0], lastOrigin.pos[1], l.la, l.lo), p, kwh); amount = c.total; parts.push(`${t.tripLbl} ${money(c.trip)}`); }
    parts.push(kwhPrice(p));
  }
  const ct = chargeTime(l, kwh);
  const dur = ct.min >= 90 ? (lang === "lt" ? `${String(Math.round(ct.min / 30) / 2).replace(".", ",")} val.` : `${Math.round(ct.min / 30) / 2} h`) : `${ct.min} min`;
  const timeLine = myCar ? t.chargeTimeCar(dur, ct.kw) : t.chargeTime(dur, ct.kw);
  const offers = l.offers.map(x => {
    const sub = [x.ac != null && t.slowFrom(money(x.ac)), x.dc != null && t.fastFrom(money(x.dc))].filter(Boolean).join(" · ");
    const head = x.m == null ? t.noPrice : x.f ? t.free : `${t.from} ${kwhPrice(x.m)}`;
    return `<div class="offer"><div class="h"><span>${x.op}</span><span style="color:${colourOf(x.f ? 0 : x.m)}">${head}</span></div>
      ${sub ? `<div class="s">${sub}</div>` : ""}
      ${x.t.length ? `<ul>${x.t.map(s => `<li>${translateTariff(s)}</li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
  const app = store.get("navApp", null);
  $("detail").innerHTML = `
    <button class="x-close" id="dClose" aria-label="${t.close}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    <div class="d-where">${townOf(l)} · ${t.points(l.n)} · ${t.upTo} ${l.kw} kW</div>
    <div class="amount" id="dAmt" aria-live="polite"></div>
    <div class="d-sub">${amount != null ? parts.join(" · ") : p === 0 ? t.freeToCharge : t.noPriceLong}
      <span class="tag" style="background:${colourOf(p)}">${levelOf(p)}</span></div>
    <div class="d-sub">${timeLine}${o && l.offers.length > 1 && p != null ? " · " + t.cheapestVia(o.op) : ""}</div>
    ${myCar && l.kw > 22 && !carFitsDC(l) ? `<div class="d-sub">${t.dcIncompatible}</div>` : ""}
    <div class="swipe" id="swipe">
      <span class="swipe-label"><span id="swipeTxt">${t.slideToNav}</span><span class="chev" aria-hidden="true">›››</span></span>
      <button class="swipe-thumb" id="swipeThumb" aria-label="${t.navigate}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    <div class="via">${app ? `${t.viaApp(NAV_NAMES[app])} · <button class="linkbtn" id="changeApp">${t.changeLbl}</button>` : ""}</div>
    ${l.offers.length > 1 ? `<div class="inf">${t.manyCompanies(l.offers.length, priced)}</div>` : ""}
    ${l.offers.some(x => x.pk) ? `<div class="warn">${t.parkingWarn}</div>` : ""}
    ${l.offers.some(x => x.fx) ? `<div class="warn">${t.fixedWarn}</div>` : ""}
    ${l.offers.some(x => x.fo) ? `<div class="inf">${t.freeOptInfo}</div>` : ""}
    <div class="ctxt">${l.ctxt}</div>
    ${offers}`;
  $("home").hidden = true; $("detail").hidden = true; void $("detail").offsetWidth; $("detail").hidden = false; $("panel").scrollTop = 0;
  typeAmount($("dAmt"), amount == null ? (p === 0 ? t.free : "—") : amount);
  $("dClose").onclick = closeDetail;
  if ($("changeApp")) $("changeApp").onclick = () => { store.set("navApp", null); navigate(l); };
  setupSwipe(l);
  if (fly) cinematicTo(l);
}
function closeDetail() { selected = null; refreshMap(false); $("detail").hidden = true; $("home").hidden = false; $("home").classList.remove("enter"); void $("home").offsetWidth; $("home").classList.add("enter"); }

// ---------- navigation hand-off ----------
const NAV_NAMES = { google: "Google Maps", waze: "Waze", apple: "Apple Maps" };
function navLinks(l) {
  const ll = `${l.la},${l.lo}`;
  return { google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`, apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d` };
}
// Ask which app to use (first time, or when changing); the choice is remembered on this device.
function navigate(l) {
  const links = navLinks(l);
  $("navGoogle").href = links.google; $("navWaze").href = links.waze; $("navApple").href = links.apple;
  $("navModal").hidden = false;
}
for (const [id, key] of [["navGoogle", "google"], ["navWaze", "waze"], ["navApple", "apple"]])
  $(id).addEventListener("click", () => { store.set("navApp", key); $("navModal").hidden = true; });
$("navCancel").onclick = () => $("navModal").hidden = true;
$("navModal").addEventListener("click", e => { if (e.target.id === "navModal") $("navModal").hidden = true; });

// ---------- swipe to navigate (like "swipe to send" in payment apps) ----------
function setupSwipe(l) {
  const sw = $("swipe"), thumb = $("swipeThumb"), label = sw.querySelector(".swipe-label");
  let x = 0, start = 0, max = 0, dragging = false, moved = false, done = false;
  const place = v => { thumb.style.transform = `translateX(${v}px)`; label.style.opacity = String(Math.max(0, 1 - v / (max || 1) * 1.4)); };
  const reset = () => { x = 0; sw.classList.remove("drag", "sending", "done"); place(0); label.style.opacity = ""; $("swipeTxt").textContent = T().slideToNav; done = false; };
  const complete = () => {
    if (done) return; done = true;
    const app = store.get("navApp", null);
    if (!app) { reset(); navigate(l); return; }                    // first time: pick the app
    max = sw.clientWidth - thumb.offsetWidth - 8; place(max);
    sw.classList.add("sending"); label.style.opacity = "1";
    $("swipeTxt").textContent = T().openingApp(NAV_NAMES[app]);
    if (!REDUCED_MOTION) burst(sw);
    setTimeout(() => {
      sw.classList.add("done"); $("swipeTxt").textContent = T().readyApp;
      thumb.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      setTimeout(() => { window.location.href = navLinks(l)[app]; setTimeout(reset, 1500); }, REDUCED_MOTION ? 0 : 450);
    }, REDUCED_MOTION ? 0 : 750);
  };
  thumb.addEventListener("pointerdown", e => {
    if (done) return; dragging = true; moved = false; max = sw.clientWidth - thumb.offsetWidth - 8;
    start = e.clientX - x; sw.classList.add("drag"); thumb.setPointerCapture(e.pointerId);
  });
  thumb.addEventListener("pointermove", e => {
    if (!dragging) return; x = Math.min(max, Math.max(0, e.clientX - start)); if (x > 4) moved = true; place(x);
  });
  const end = () => {
    if (!dragging) return; dragging = false; sw.classList.remove("drag");
    if (x > max * 0.8) complete(); else if (!moved) complete(); else { x = 0; place(0); label.style.opacity = ""; }
  };
  thumb.addEventListener("pointerup", end); thumb.addEventListener("pointercancel", end);
  thumb.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); complete(); } });
}
// small lightning bolts flying out of the pill, like the bills in the payment animation
function burst(host) {
  for (let i = 0; i < 9; i++) {
    const b = document.createElement("span"); b.className = "bolt-p"; b.textContent = "";
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="currentColor"/></svg>';
    b.style.left = `${20 + Math.random() * 45}%`; b.style.top = `${30 + Math.random() * 40}%`;
    b.style.setProperty("--dx", `${(Math.random() - .3) * 120}px`); b.style.setProperty("--dy", `${-20 - Math.random() * 50}px`);
    b.style.setProperty("--r", `${(Math.random() - .5) * 120}deg`); b.style.animationDelay = `${i * 45}ms`;
    host.appendChild(b); setTimeout(() => b.remove(), 1300);
  }
}

// The total types itself in, digit by digit, with a blinking caret.
function typeAmount(el, value) {
  const isNum = typeof value === "number";
  const parts = isNum ? (lang === "lt" ? [value.toFixed(2).replace(".", ","), "€", true] : [value.toFixed(2), "€", false]) : [String(value), "", false];
  const [num, cur, curAfter] = parts;
  const render = shown => el.innerHTML = (cur && !curAfter ? `<span class="cur">${cur}</span>` : "") + `<span class="num">${shown}</span>` +
    (cur && curAfter ? `<span class="cur">${cur}</span>` : "") + (shown.length < num.length ? '<span class="caret"></span>' : "");
  if (REDUCED_MOTION || !isNum) { render(num); return; }
  let i = 0; render("");
  clearInterval(typeAmount.h);
  typeAmount.h = setInterval(() => { i++; render(num.slice(0, i)); if (i >= num.length) clearInterval(typeAmount.h); }, 70);
}

// ---------- cost model ----------
// Total cost of charging at a location = the charge itself + the trip there and back:
// electricity used for the detour, car wear (tyres, servicing, depreciation) and your time.
function tripCost(straightKm, price, kwh) {
  const oneWay = straightKm * ROAD_FACTOR, road = oneWay * 2;
  const driveKwh = road * car.cons / 100;
  const trip = price * driveKwh + road * car.wear + road / speedFor(oneWay) * car.timeVal;
  return { road, oneWay, charge: price * kwh, trip, total: price * kwh + trip };
}

// ---------- where the driver starts from ----------
function setOriginMarker(pos, kind) {
  map.getSource("me")?.setData(pos ? { type: "Feature", geometry: { type: "Point", coordinates: [pos[1], pos[0]] }, properties: { kind } }
    : { type: "FeatureCollection", features: [] });
}
function getMyLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { toast(T().locFailed); resolve(null); return; }
    toast(T().locating, 8000);
    navigator.geolocation.getCurrentPosition(pos => {
      $("toast").hidden = true; userPos = [pos.coords.latitude, pos.coords.longitude]; resolve(userPos);
    }, () => { toast(T().locFailed); resolve(null); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
}
async function getOrigin() {
  const v = $("origin").value, t = T();
  if (v === "me") { const p = userPos || await getMyLocation(); return p && { pos: p, label: t.originMeShort, kind: "me" }; }
  if (v === "home") {
    if (!homeLoc) { toast(t.needHome); openCar(); return null; }
    return { pos: homeLoc, label: t.originHomeShort, kind: "home" };
  }
  const c = CITIES.find(x => x.id === v);
  return { pos: c.c, label: c.en, kind: "city" };
}

// ---------- Best Charge ----------
async function bestCharge() {
  const t = T(), kwh = +$("kwh").value;
  const origin = await getOrigin();
  if (!origin) return;
  lastOrigin = origin;
  setOriginMarker(origin.pos, origin.kind);
  const [oLa, oLo] = origin.pos;
  const pool = L.filter(l => !fastOnly || isFast(l)).map(l => ({ l, d: km(oLa, oLo, l.la, l.lo), ...priceOf(l) }))
    .filter(x => x.d <= SEARCH_KM && x.p != null);
  // free spots are usually for customers or residents only, so they're mentioned but not recommended
  const freeN = pool.filter(x => x.p === 0 && x.d <= 8).length;
  const paid = pool.filter(x => x.p > 0).map(x => ({ ...x, c: tripCost(x.d, x.p, kwh) }));
  if (!paid.length) { $("results").innerHTML = `<div class="note">${t.noneNear(SEARCH_KM)}</div>`; return; }
  const nearest = paid.reduce((a, b) => b.d < a.d ? b : a);   // what most people would do without the app
  paid.sort((a, b) => a.c.total - b.c.total);
  const top = [];
  for (const x of paid) { if (top.every(y => km(y.l.la, y.l.lo, x.l.la, x.l.lo) > 0.5)) top.push(x); if (top.length === 3) break; }
  pinned = new Set(top.map(x => x.l.i)); refreshMap(false);
  drawLinks(origin.pos, top.map((x, n) => ({ l: x.l, best: n === 0 })));
  // Kept deliberately short: one total, where, and the saving. The breakdown lives in the station card.
  $("results").innerHTML = `<div class="res-head">${t.resultsHead}</div>` + top.map((x, n) => {
    const saving = nearest.c.total - x.c.total;
    const extra = x === nearest ? t.isNearest : saving > 0.2 ? t.saves(money(saving)) : "";
    return `<div class="pick${n === 0 ? " first" : ""}" data-i="${x.l.i}" style="animation-delay:${n * 80}ms">
      <div class="amt" data-v="${x.c.total}">${money(x.c.total)}</div>
      <div class="meta"><b>${x.o.op}</b><span>${x.c.oneWay.toFixed(1)} km${extra ? ` · <em>${extra}</em>` : ""}</span></div>
      <button class="nav-mini" data-nav="${x.l.i}" aria-label="${t.navigate}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.5l7.2 2.3L12.5 20z"/></svg></button>
    </div>`;
  }).join("");
  document.querySelector(".legend").hidden = true;
  countUp($("results").querySelectorAll(".amt[data-v]"));
  $("results").querySelectorAll(".pick").forEach(el => el.addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { e.stopPropagation(); const l2 = L[+nav.dataset.nav], app = store.get("navApp", null); if (app) window.location.href = navLinks(l2)[app]; else navigate(l2); } else select(+el.dataset.i);
  }));
  const b = new maplibregl.LngLatBounds([oLo, oLa], [oLo, oLa]);
  top.forEach(x => b.extend([x.l.lo, x.l.la]));
  map.fitBounds(b, { padding: { top: 140, bottom: window.innerWidth < 760 ? window.innerHeight * 0.55 : 60, left: window.innerWidth < 760 ? 40 : 440, right: 40 }, maxZoom: 14, pitch: 35 });
}

// ---------- home & car settings ----------
function openCar() {
  const t = T();
  $("carName").textContent = myCar ? carLabel(myCar) : t.carNone;
  $("acctBox").hidden = !authUser;
  if (authUser) $("acctName").textContent = t.signedInAs(authUser.displayName || authUser.email || "");
  $("homeStatus").textContent = homeLoc ? t.homeSet(townOf({ la: homeLoc[0], lo: homeLoc[1] })) : t.homeNotSet;
  $("homeClear").hidden = !homeLoc;
  $("cons").value = car.cons; $("wear").value = car.wear; $("timeVal").value = car.timeVal;
  $("carModal").hidden = false;
}
function setHome(pos) {
  homeLoc = [+pos[0].toFixed(5), +pos[1].toFixed(5)]; store.set("home", homeLoc);
  $("origin").value = "home"; store.set("origin", "home");
  setOriginMarker(homeLoc, "home"); openCar(); toast(T().homeSaved);
}
$("carBtn").onclick = openCar;
$("homeHere").onclick = async () => { const p = await getMyLocation(); if (p) setHome(p); };
$("homeCentre").onclick = () => { const c = map.getCenter(); setHome([c.lat, c.lng]); };
$("homeClear").onclick = () => { homeLoc = null; store.set("home", null); if ($("origin").value === "home") $("origin").value = "me"; setOriginMarker(null); openCar(); };
$("carSave").onclick = () => {
  const num = (id, d, lo, hi) => { const v = parseFloat(String($(id).value).replace(",", ".")); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  car = { cons: num("cons", CAR_DEFAULTS.cons, 8, 40), wear: num("wear", CAR_DEFAULTS.wear, 0, 1), timeVal: num("timeVal", CAR_DEFAULTS.timeVal, 0, 200) };
  store.set("car", car); $("carModal").hidden = true;
  if ($("results").innerHTML) bestCharge();
};
$("carModal").addEventListener("click", e => { if (e.target.id === "carModal") $("carModal").hidden = true; });

// ---------- motion: camera, connection lines, spinning globe ----------
// Fly to a station with a slight tilt and turn, like Google Earth.
function cinematicTo(l) {
  const pad = { bottom: window.innerWidth < 760 ? window.innerHeight * 0.45 : 0, left: window.innerWidth < 760 ? 0 : 400 };
  if (REDUCED_MOTION) { map.jumpTo({ center: [l.lo, l.la], zoom: Math.max(map.getZoom(), 15), padding: pad }); return; }
  map.flyTo({ center: [l.lo, l.la], zoom: Math.max(map.getZoom(), 15.2), pitch: 52, bearing: map.getBearing() + 25,
    padding: pad, duration: 2200, curve: 1.6, essential: true });
}

// Curved line between two points (a gentle arc instead of a straight ruler line).
function arc(a, b, steps = 48) {
  const [x1, y1] = a, [x2, y2] = b, dx = x2 - x1, dy = y2 - y1;
  const cx = (x1 + x2) / 2 - dy * 0.25, cy = (y1 + y2) / 2 + dx * 0.25 * Math.cos(y1 * Math.PI / 180);
  const pts = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps, u = 1 - t; pts.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]); }
  return pts;
}
let linkAnim = 0;
function drawLinks(originPos, targets) {
  const src = map.getSource("links"); if (!src) return;
  const from = [originPos[1], originPos[0]];
  const lines = targets.map(x => ({ pts: arc(from, [x.l.lo, x.l.la]), c: x.best ? "#a78bfa" : "#6366f1", best: x.best ? 1 : 0 }));
  const frame = p => src.setData({ type: "FeatureCollection", features: lines.map(L1 => ({ type: "Feature",
    properties: { c: L1.c, best: L1.best },
    geometry: { type: "LineString", coordinates: L1.pts.slice(0, Math.max(2, Math.ceil(p * L1.pts.length))) } })) });
  cancelAnimationFrame(linkAnim);
  if (REDUCED_MOTION) { frame(1); return; }
  const t0 = performance.now(), dur = 900;
  const step = now => { const p = Math.min(1, (now - t0) / dur); frame(1 - (1 - p) ** 3); if (p < 1) linkAnim = requestAnimationFrame(step); };
  linkAnim = requestAnimationFrame(step);
}

// Slowly spinning globe behind the welcome screen; stops as soon as the map is touched.
let spinning = false;
function spinStep() {
  if (!spinning) return;
  const c = map.getCenter(); c.lng -= 8;
  map.easeTo({ center: c, duration: 1000, easing: t => t, essential: true });
}
function startSpin() { if (REDUCED_MOTION) return; spinning = true; spinStep(); }
function stopSpin() { spinning = false; }
map.on("moveend", () => { if (spinning) spinStep(); });
for (const ev of ["mousedown", "touchstart", "wheel", "dragstart"]) map.on(ev, stopSpin);
function flyIntoLithuania() {
  stopSpin();
  if (map.getZoom() > 4) return;
  if (REDUCED_MOTION) map.jumpTo(LITHUANIA); else map.flyTo({ ...LITHUANIA, duration: 4500, essential: true });
}

// Totals roll up to their value, like an amount in a payment app.
function countUp(els) {
  if (REDUCED_MOTION) return;
  const t0 = performance.now(), dur = 700;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
    els.forEach(el => { el.textContent = money(+el.dataset.v * e); });
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- liquid glass highlight ----------
// The soft highlight on glass controls follows the pointer or finger.
const GLASS = ".brand,.pill-btn,.chip,.secondary,.pick,.statcard,.x-close,.caropt,.go,.swipe";
if (!REDUCED_MOTION) document.addEventListener("pointermove", e => {
  const el = e.target.closest && e.target.closest(GLASS); if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--gx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--gy", `${((e.clientY - r.top) / r.height) * 100}%`);
}, { passive: true });

// ---------- floating stats card ----------
function ltCount(n, one, few, many) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && (b < 10 || b > 20) ? few : many; }
function updateStats() {
  if (!DATA) return;
  const n = L.length, mins = Math.max(0, Math.round((Date.now() - new Date(DATA.pub).getTime()) / 60000));
  $("statN").textContent = n.toLocaleString(lang === "lt" ? "lt-LT" : "en-GB");
  $("statLbl").textContent = lang === "lt" ? ltCount(n, "įkrovimo vieta", "įkrovimo vietos", "įkrovimo vietų") : "charging locations";
  $("statAge").textContent = T().updatedAgo(mins);
  $("statcard").hidden = false;
}
setInterval(updateStats, 60000);

// ---------- welcome screen & car picker ----------
let CARS = null;
function loadCars() {
  if (!CARS) CARS = fetch("data/cars.json").then(r => r.json()).then(d => d.cars).catch(() => []);
  return CARS;
}
async function renderCarList() {
  const cars = await loadCars(), t = T();
  const terms = $("carSearch").value.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = terms.length ? cars.filter(c => { const s = `${c[0]} ${c[1]} ${c[2]} ${c[3] || ""}`.toLowerCase(); return terms.every(w => s.includes(w)); }) : [];
  $("carList").innerHTML = hits.slice(0, 40).map(c => {
    const i = cars.indexOf(c);
    const specs = [c[4] && `${c[4]} kWh`, c[7] && `${t.fastUpTo} ${c[7]} kW`, (c[8] & 2) && !(c[8] & 1) ? "CHAdeMO" : ""].filter(Boolean).join(" · ");
    return `<button class="caropt" role="listitem" data-car="${i}"><b>${carLabel(c)}</b><span>${specs}</span></button>`;
  }).join("") || (terms.length ? `<div class="note">${t.carNotFound}</div>` : "");
}
function openOnboard(changing = false) {
  $("onboard").hidden = false; $("onboard").dataset.changing = changing ? "1" : "";
  $("obAuth").hidden = !FIREBASE_CONFIG || !!authUser || changing;
  $("carSearch").value = ""; renderCarList(); loadCars();
  setTimeout(() => $("carSearch").focus(), 50);
}
function finishOnboard() { store.set("onboarded", true); $("onboard").hidden = true; if ($("onboard").dataset.changing) openCar(); else flyIntoLithuania(); }
function setKwhOptions() {
  const prev = $("kwh").value, opts = [20, 40, 60].map(k => `<option value="${k}">${k} kWh</option>`);
  let auto = null;
  if (myCar && myCar[4]) { auto = Math.round(myCar[4] * 0.7); opts.unshift(`<option value="${auto}">${T().autoKwh(auto)}</option>`); }
  $("kwh").innerHTML = opts.join("");
  $("kwh").value = auto && (!prev || store.get("kwhAuto", true)) ? String(auto) : (prev || "40");
  if (!$("kwh").value) $("kwh").value = "40";
}
$("carSearch").addEventListener("input", renderCarList);
$("carList").addEventListener("click", async e => {
  const b = e.target.closest("[data-car]"); if (!b) return;
  const c = (await loadCars())[+b.dataset.car];
  myCar = c; store.set("myCar", c);
  if (c[5]) { car = { ...car, cons: c[5] }; store.set("car", car); }
  store.set("kwhAuto", true); setKwhOptions(); refreshMap(); toast(T().carSaved);
  if ($("results").innerHTML) bestCharge();
  finishOnboard();
});
$("carSkip").onclick = finishOnboard;
$("carChange").onclick = () => { $("carModal").hidden = true; openOnboard(true); };

// ---------- sign-in (Firebase Auth; only active when FIREBASE_CONFIG is set) ----------
let authUser = null;
function loadScript(src) { return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }); }
async function initAuth() {
  if (!FIREBASE_CONFIG) return;
  try {
    await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
    await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js");
    firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(u => { authUser = u; if (u && !$("onboard").hidden) $("obAuth").hidden = true; });
  } catch (e) { console.warn("Sign-in unavailable", e); }
}
async function signIn(provider) {
  try { const r = await firebase.auth().signInWithPopup(provider); authUser = r.user; $("obAuth").hidden = true; toast(T().signedInAs(authUser.displayName || authUser.email || "")); }
  catch (e) { if (e && e.code !== "auth/popup-closed-by-user") toast(T().signInFailed); }
}
$("authGoogle").onclick = () => signIn(new firebase.auth.GoogleAuthProvider());
$("authApple").onclick = () => signIn(new firebase.auth.OAuthProvider("apple.com"));
$("signOut").onclick = async () => { try { await firebase.auth().signOut(); } catch {} authUser = null; openCar(); };

// ---------- UI wiring ----------
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => el.textContent = T()[el.dataset.t]);
  $("langBtn").textContent = lang === "lt" ? "EN" : "LT";
  $("carSearch").placeholder = T().carSearchPh;
  if ($("kwh").options.length) setKwhOptions();
  if (!$("onboard").hidden) renderCarList();
  $("origin").innerHTML = `<option value="me">${T().originMe}</option><option value="home">${T().originHome}</option>` +
    CITIES.map(c => `<option value="${c.id}">${c.en}</option>`).join("");
  $("origin").value = store.get("origin", homeLoc ? "home" : "me");
  $("infoBody").innerHTML = T().about + `<button class="secondary" id="infoClose">${T().close}</button>`;
  $("infoClose").onclick = () => $("infoModal").hidden = true;
  setUpdated(); updateStats();
  if (L.length) { refreshMap(); if (selected != null) select(selected, false); if ($("results").innerHTML) bestCharge(); }
}
function setUpdated() {
  if (!DATA) return;
  const d = new Date(DATA.pub).toLocaleString(lang === "lt" ? "lt-LT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("updated").textContent = T().updated(d);
}
function setChips() { $("fastChip").classList.toggle("on", fastOnly); $("unkChip").classList.toggle("on", hideUnknown); }
$("langBtn").onclick = () => { lang = lang === "lt" ? "en" : "lt"; store.set("lang", lang); applyLang(); };
$("infoBtn").onclick = () => $("infoModal").hidden = false;
$("infoModal").addEventListener("click", e => { if (e.target.id === "infoModal") $("infoModal").hidden = true; });
$("fastChip").onclick = () => { fastOnly = !fastOnly; store.set("fastOnly", fastOnly); setChips(); refreshMap(); if ($("results").innerHTML) bestCharge(); if (selected != null) select(selected, false); };
$("unkChip").onclick = () => { hideUnknown = !hideUnknown; store.set("hideUnknown", hideUnknown); setChips(); refreshMap(); };
$("bestBtn").onclick = bestCharge;
$("origin").onchange = () => { store.set("origin", $("origin").value); bestCharge(); };
$("kwh").onchange = () => { store.set("kwhAuto", !!myCar && $("kwh").selectedIndex === 0); refreshMap(false); if ($("results").innerHTML) bestCharge(); if (selected != null) select(selected, false); };

// ---------- load ----------
applyLang(); setChips(); setKwhOptions(); initAuth();
if (!store.get("onboarded", false)) openOnboard();
const dataReady = fetch(DATA_URL, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
  DATA = d;
  const ct = c => [(c & 1) && "Type 2", (c & 2) && "CCS", (c & 4) && "CHAdeMO"].filter(Boolean).join(", ") || "—";
  L = d.s.map(([la, lo, kw, n, c, offers], i) => ({ i, la, lo, kw, n, ctb: c, ctxt: ct(c),
    offers: offers.map(([op, m, ac, dc, fl, tt]) => ({ op: d.ops[op], m: (fl & 1) ? 0 : m, ac, dc, f: fl & 1, fo: fl & 2, pk: fl & 4, fx: fl & 8, t: tt.map(j => d.T[j]) })) }));
  setUpdated(); updateStats();
}).catch(() => toast(T().loadFail, 8000));
map.on("load", () => {
  dataReady.then(addLayers);
  if (firstVisit) {
    store.set("seenGlobe", true);
    if (!$("onboard").hidden) startSpin(); else setTimeout(flyIntoLithuania, 600);
  }
});
