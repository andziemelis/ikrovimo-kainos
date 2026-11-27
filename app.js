"use strict";
// ---------- config ----------
// Sign-in with Google / Apple. Paste the Firebase web config here to switch it on (see README).
const FIREBASE_CONFIG = null;   // when sign-in is switched on, also allow https://www.gstatic.com and Firebase hosts in the
                                 // Content-Security-Policy in index.html, or the sign-in scripts will be blocked
// Never let another site show this app inside a frame (stops "clickjacking" tricks).
if (window.top !== window.self) { try { window.top.location = window.location.href; } catch { document.documentElement.innerHTML = ""; } }
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
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  try { map.setProjection({ type: "globe" }); } catch { /* older browsers: flat map */ }
  try { map.setSky({ "sky-color": "#0b1530", "horizon-color": "#1e3a5f", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] }); } catch {}
});

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
  // animated "data connection" lines from the start point to the Best Charge results
  map.addSource("links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "links-glow", type: "line", source: "links", layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "c"], "line-width": 10, "line-blur": 8, "line-opacity": 0.45 } }, "glow");
  map.addLayer({ id: "links", type: "line", source: "links", layout: { "line-cap": "round" },
    paint: { "line-color": ["get", "c"], "line-width": ["case", ["==", ["get", "best"], 1], 3, 2], "line-opacity": 0.95 } }, "glow");
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#3d6bff", "line-width": 14, "line-blur": 10, "line-opacity": 0.45 } }, "links-glow");
  map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#9db8ff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 6], "line-opacity": 0.95 } }, "links-glow");
  map.addLayer({ id: "selected", type: "symbol", source: "chargers", filter: ["==", ["get", "i"], -1],
    layout: { "icon-image": ["concat", ["get", "icon"], "-sel"], "icon-size": 1.25, "icon-allow-overlap": true, "icon-ignore-placement": true } });
  // numbered charging stops of a planned trip
  map.addSource("stops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "stops-c", type: "circle", source: "stops",
    paint: { "circle-color": "#3d6bff", "circle-radius": 12, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5, "circle-translate": [0, -26] } });
  map.addLayer({ id: "stops-t", type: "symbol", source: "stops",
    layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true, "text-offset": [0, -2] },
    paint: { "text-color": "#ffffff" } });
  map.addLayer({ id: "me", type: "circle", source: "me",
    paint: { "circle-color": ["match", ["get", "kind"], "home", "#9db8ff", "dest", "#f8fafc", "#60a5fa"], "circle-radius": 9, "circle-stroke-color": "#0b1220", "circle-stroke-width": 3 } });
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
  requestAnimationFrame(() => { if (isPhone()) snapSheet("half"); });
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
    return `<div class="offer"><div class="h"><span>${esc(x.op)}</span><span style="color:${colourOf(x.f ? 0 : x.m)}">${head}</span></div>
      ${sub ? `<div class="s">${sub}</div>` : ""}
      ${x.t.length ? `<ul>${x.t.map(s => `<li>${esc(translateTariff(s))}</li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
  const app = store.get("navApp", null);
  $("detail").innerHTML = `
    <button class="x-close" id="dClose" aria-label="${t.close}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    <div class="d-where">${townOf(l)} · ${t.points(l.n)} · ${t.upTo} ${l.kw} kW</div>
    <div class="amount" id="dAmt" aria-live="polite"></div>
    <div class="d-sub">${amount != null ? parts.join(" · ") : p === 0 ? t.freeToCharge : t.noPriceLong}
      <span class="tag" style="background:${colourOf(p)}">${levelOf(p)}</span></div>
    <div class="d-sub">${timeLine}${o && l.offers.length > 1 && p != null ? " · " + t.cheapestVia(esc(o.op)) : ""}</div>
    ${myCar && l.kw > 22 && !carFitsDC(l) ? `<div class="d-sub">${t.dcIncompatible}</div>` : ""}
    <div class="swipe" id="swipe">
      <span class="swipe-label"><span id="swipeTxt">${t.slideToNav}</span><span class="chev" aria-hidden="true">›››</span></span>
      <button class="swipe-thumb" id="swipeThumb" aria-label="${t.navigate}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    <div class="via">${app ? `${t.viaApp(NAV_NAMES[app])} · <button class="linkbtn" id="changeApp">${t.changeLbl}</button>` : ""}</div>
    ${payHTML(l)}
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
  $("detail").querySelectorAll("[data-pay]").forEach(a => a.addEventListener("click", () => logCharge(l.i)));
  if (fly) cinematicTo(l);
}
function closeDetail() { requestAnimationFrame(() => snapSheet(sheetState)); selected = null; refreshMap(false); $("detail").hidden = true; $("home").hidden = false; $("home").classList.remove("enter"); void $("home").offsetWidth; $("home").classList.add("enter"); }

// ---------- navigation hand-off ----------
const NAV_NAMES = { google: "Google Maps", waze: "Waze", apple: "Apple Maps" };
function navLinks(l) {
  const ll = `${l.la},${l.lo}`;
  const g = route ? `https://www.google.com/maps/dir/?api=1${route.from.kind === "me" ? "" : `&origin=${route.from.pos.join(",")}`}&destination=${route.to.pos.join(",")}&waypoints=${ll}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  return { google: g,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`, apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d` };
}
// Ask which app to use (first time, or when changing); the choice is remembered on this device.
let navTarget = null;
function goTo(l, app) { logCharge(l.i); window.location.href = navLinks(l)[app]; }
function navigate(l) {
  navTarget = l;
  const links = navLinks(l);
  $("navGoogle").href = links.google; $("navWaze").href = links.waze; $("navApple").href = links.apple;
  $("navModal").hidden = false;
}
for (const [id, key] of [["navGoogle", "google"], ["navWaze", "waze"], ["navApple", "apple"]])
  $(id).addEventListener("click", () => { if (navTarget) logCharge(navTarget.i); store.set("navApp", key); $("navModal").hidden = true; });
$("navCancel").onclick = () => $("navModal").hidden = true;
$("navModal").addEventListener("click", e => { if (e.target.id === "navModal") $("navModal").hidden = true; });

// ---------- how to pay: hand off to the operator's own app, or its no-app payment ----------
// The operator list (data/operators.json) is kept by hand from what each operator states publicly.
let OPS = [];
fetch("data/operators.json", { cache: "no-cache" }).then(r => r.json()).then(j => { OPS = j.operators || []; if (selected != null) select(selected, false); }).catch(() => {});
const PLATFORM = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "desktop";
const opInfo = name => { const n = String(name).toLowerCase(); return OPS.find(o => o.match.some(m => n.includes(m))); };
const httpsOnly = u => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
function appLink(o) {
  return httpsOnly(appLinkRaw(o));
}
function appLinkRaw(o) {
  const ios = /^\d+$/.test(o.ios || "") && `https://apps.apple.com/lt/app/id${o.ios}`, play = o.play && `https://play.google.com/store/search?q=${encodeURIComponent(o.play)}&c=apps`;
  return PLATFORM === "ios" ? ios || o.web : PLATFORM === "android" ? play || o.web : o.web || ios || play;
}
function payHTML(l) {
  const t = T(), seen = new Set(), rows = [];
  for (const x of l.offers) {
    if (seen.has(x.op)) continue; seen.add(x.op);
    const o = opInfo(x.op), href = o && appLink(o);
    const ways = (o?.adhoc || []).map(k => `<li>${t["adhoc_" + k]}</li>`).join("");
    rows.push(`<div class="pay-op">
      <div class="pay-top"><span class="pay-ic" aria-hidden="true">${esc(String(x.op).trim().slice(0, 1).toUpperCase())}</span>
        <span class="pay-name"><b>${esc(x.op)}</b><em>${!o ? t.payUnknown : o.inApp === "wallets" ? t.payInAppWallets : o.inApp === "unsure" ? t.payOpApp : t.payInApp}</em></span>
        ${href ? `<a class="pay-btn" data-pay href="${href}" target="_blank" rel="noopener">${t.payIn(esc(o.app))}</a>` : ""}</div>
      ${ways ? `<div class="pay-alt"><span>${t.payNoApp}</span><ul>${ways}</ul></div>` : ""}
    </div>`);
  }
  const anyApp = rows.length && l.offers.some(x => opInfo(x.op) && appLink(opInfo(x.op)));
  return `<div class="pay"><div class="pay-h">${t.payTitle}</div>${rows.join("")}${anyApp && PLATFORM !== "desktop" ? `<div class="pay-note">${t.payStoreNote}</div>` : ""}</div>`;
}

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
      setTimeout(() => { goTo(l, app); setTimeout(reset, 1500); }, REDUCED_MOTION ? 0 : 450);
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
    toast(T().locating, 8000, T().locWhy);
    navigator.geolocation.getCurrentPosition(pos => {
      $("toast").hidden = true; userPos = [pos.coords.latitude, pos.coords.longitude]; resolve(userPos);
    }, () => { toast(T().locFailed); resolve(null); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
}
// Best Charge always starts from where you are now. Without location access it uses the map centre.
async function getOrigin() {
  const p = userPos || await getMyLocation();
  if (p) return { pos: p, label: T().originMeShort, kind: "me" };
  const c = map.getCenter(); toast(T().usingCentre, 4000, T().usingCentreSub);
  return { pos: [c.lat, c.lng], label: T().mapCentre, kind: "city" };
}

// ---------- Best Charge ----------
async function bestCharge() {
  if (isPhone() && sheetState === "peek") snapSheet("half");
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
  lastPicks = new Map(top.map(x => [x.l.i, { op: x.o.op, total: x.c.total, save: Math.max(0, nearest.c.total - x.c.total) }]));
  drawLinks(origin.pos, top.map((x, n) => ({ l: x.l, best: n === 0 })));
  // Kept deliberately short: one total, where, and the saving. The breakdown lives in the station card.
  $("results").innerHTML = `<div class="res-head">${t.resultsHead}</div>` + top.map((x, n) => {
    const saving = nearest.c.total - x.c.total;
    const extra = x === nearest ? t.isNearest : saving > 0.2 ? t.saves(money(saving)) : "";
    return pickHTML(x, n, `${x.c.oneWay.toFixed(1)} km${extra ? ` · <em>${extra}</em>` : ""}`);
  }).join("");
  wirePicks();
  const b = new maplibregl.LngLatBounds([oLo, oLa], [oLo, oLa]);
  top.forEach(x => b.extend([x.l.lo, x.l.la]));
  map.fitBounds(b, { padding: { top: 140, bottom: window.innerWidth < 760 ? window.innerHeight * 0.55 : 60, left: window.innerWidth < 760 ? 40 : 440, right: 40 }, maxZoom: 14, pitch: 35 });
}

let lastPicks = new Map();   // station → { op, total, save } from the latest results, for the wallet
function wirePicks() {
  document.querySelector(".legend").hidden = true;
  countUp($("results").querySelectorAll(".amt[data-v]"));
  $("results").querySelectorAll(".pick").forEach(el => el.addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { e.stopPropagation(); const l2 = L[+nav.dataset.nav], app = store.get("navApp", null); if (app) goTo(l2, app); else navigate(l2); } else select(+el.dataset.i);
  }));
}
const pickHTML = (x, n, metaLine) => `<div class="pick${n === 0 ? " first" : ""}" data-i="${x.l.i}" style="animation-delay:${n * 80}ms">
      <div class="amt" data-v="${x.c.total}">${money(x.c.total)}</div>
      <div class="meta"><b>${esc(x.o.op)}</b><span>${metaLine}</span></div>
      <button class="nav-mini" data-nav="${x.l.i}" aria-label="${T().navigate}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.5l7.2 2.3L12.5 20z"/></svg></button>
    </div>`;
const rerun = () => route ? routeBest() : bestCharge();

// ---------- wallet: estimated savings from charges picked through the app ----------
function logCharge(i) {
  const pk = lastPicks.get(i); if (!pk) return;
  const log = store.get("log", []), now = Date.now();
  if (log.some(e => e.i === i && now - e.t < 3 * 3600e3)) return;   // same stop again soon after: count once
  log.push({ t: now, i, op: pk.op, total: +pk.total.toFixed(2), save: +pk.save.toFixed(2) });
  store.set("log", log.slice(-200));
}
function monthLog() { const d = new Date(), m0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); return store.get("log", []).filter(e => e.t >= m0); }
// Wallet: only a payment card for the future subscription. Charging itself is paid in the operator's app.
// No card can be saved yet: that needs sign-in and a payment provider (e.g. Stripe) behind the app.
function openWallet() { $("walletModal").hidden = false; }
$("addCardBtn").onclick = () => toast(T().cardSoon, 4000, T().cardSoonSub);
$("walletClose").onclick = () => $("walletModal").hidden = true;
$("walletModal").addEventListener("click", e => { if (e.target.id === "walletModal") $("walletModal").hidden = true; });

// ---------- legal pages and deleting your data ----------
const legalLinks = () => `<a href="privacy.html" target="_blank" rel="noopener">${T().privacyLink}</a> · <a href="terms.html" target="_blank" rel="noopener">${T().termsLink}</a>`;
// Two taps, so it can't happen by accident: the first asks, the second deletes everything this app stored on the device.
let delTimer = 0;
$("deleteData").onclick = () => {
  const b = $("deleteData");
  if (!b.classList.contains("armed")) {
    b.classList.add("armed"); b.textContent = T().deleteConfirm;
    clearTimeout(delTimer); delTimer = setTimeout(() => { b.classList.remove("armed"); b.textContent = T().deleteData; }, 5000);
    return;
  }
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  location.replace(location.pathname + "?deleted=1");
};
if (new URLSearchParams(location.search).has("deleted")) {
  history.replaceState(null, "", location.pathname);
  setTimeout(() => toast(T().deletedDone, 4000, T().deletedSub), 400);
}

// ---------- tabs: Map and Account ----------
let tab = "map";
// Icons are drawn with strokes so the open tab can draw itself in. The map unfolds and drops a pin;
// the person's head pops in. A glowing "charge" bar on top crawls to the open tab like an inchworm.
const TAB_ICONS = {
  map: `<svg class="ti ti-map" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path class="ti-s fold f1" pathLength="1" d="M3 6.5 9 4v14l-6 2.5z"/><path class="ti-s fold f2" pathLength="1" d="M9 4l6 2.5v14L9 18z"/><path class="ti-s fold f3" pathLength="1" d="M15 6.5 21 4v14l-6 2.5z"/>
    <g class="pin"><path d="M15 2.2a3.1 3.1 0 0 0-3.1 3.1c0 2.3 3.1 5.6 3.1 5.6s3.1-3.3 3.1-5.6A3.1 3.1 0 0 0 15 2.2z"/><circle cx="15" cy="5.3" r="1.1"/></g></svg>`,
  account: `<svg class="ti ti-acct" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle class="ti-s head" pathLength="1" cx="12" cy="8" r="3.8"/><path class="ti-s body" pathLength="1" d="M4.5 20.5c.7-3.6 3.8-5.8 7.5-5.8s6.8 2.2 7.5 5.8"/></svg>` };
function buildTabs() {
  $("tabs").innerHTML = '<span class="tab-bar" id="tabBar" aria-hidden="true"></span><span class="tab-beam" id="tabBeam" aria-hidden="true"></span>' +
    ["map", "account"].map(v => `<button type="button" class="tab${v === tab ? " on" : ""}" role="tab" data-v="${v}" aria-selected="${v === tab}">${TAB_ICONS[v]}<span class="tl">${v === "map" ? T().tabMap : T().tabAccount}</span></button>`).join("");
  $("tabs").querySelectorAll(".tab").forEach(b => b.onclick = () => setTab(b.dataset.v));
  requestAnimationFrame(() => placeTabBar(false));
}
let barLeft = null;
function placeTabBar(animate = true) {
  const host = $("tabs"), btn = host.querySelector(`.tab[data-v="${tab}"]`), bar = $("tabBar"), beam = $("tabBeam");
  if (!btn) return;
  const hr = host.getBoundingClientRect(), r = btn.getBoundingClientRect(), w = 34;
  const left = r.left - hr.left + r.width / 2 - w / 2, right = hr.width - left - w;
  const moveRight = barLeft != null && left > barLeft, go = animate && !REDUCED_MOTION && barLeft != null && left !== barLeft;
  // inchworm: the leading end shoots ahead, the trailing end catches up
  bar.style.transition = go ? (moveRight ? "right .28s cubic-bezier(.3,.9,.3,1), left .42s cubic-bezier(.5,0,.2,1) .12s" : "left .28s cubic-bezier(.3,.9,.3,1), right .42s cubic-bezier(.5,0,.2,1) .12s") : "none";
  bar.style.left = `${left}px`; bar.style.right = `${right}px`;
  beam.style.transition = go ? "transform .5s cubic-bezier(.3,.9,.3,1) .1s, opacity .3s" : "none";
  beam.style.transform = `translateX(${r.left - hr.left + r.width / 2 - beam.offsetWidth / 2}px)`;
  barLeft = left;
}
window.addEventListener("resize", () => placeTabBar(false));
function setTab(v) {
  if (v === tab && $("tabs").querySelector(".tab.on")?.dataset.v === v) return;
  tab = v;
  $("tabs").querySelectorAll(".tab").forEach(b => {
    const on = b.dataset.v === v; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on));
    b.classList.remove("draw"); if (on && !REDUCED_MOTION) { void b.offsetWidth; b.classList.add("draw"); }
  });
  placeTabBar(true);
  document.documentElement.classList.toggle("tab-account", v === "account");
  $("accountPage").hidden = v !== "account";
  if (v === "account") { closeRouteForm(); renderAccount(); $("accountPage").scrollTop = 0; }
  else requestAnimationFrame(() => snapSheet(sheetState, false));
}
function renderAccount() {
  const t = T();
  $("liCarVal").textContent = myCar ? [myCar[0], myCar[1]].filter(Boolean).join(" ") : t.noCar;
  $("liWalletVal").textContent = t.noCardShort;
  $("acctFoot").innerHTML = `${t.acctFoot}<br>${legalLinks()}`;
  if (authUser) { $("acctHead").textContent = authUser.displayName || authUser.email || ""; $("acctSub").textContent = ""; $("acctBtns").hidden = true; }
}
const authSoon = () => FIREBASE_CONFIG ? signIn(new firebase.auth.GoogleAuthProvider()) : toast(T().signInSoon, 3500, T().signInSoonSub);
$("loginBtn").onclick = authSoon; $("signupBtn").onclick = authSoon;
$("liCar").onclick = () => openOnboard(true);
$("liSettings").onclick = openCar;
$("liWallet").onclick = openWallet;

// ---------- route planner (top bar) ----------
// Pick a start and a destination; the app finds where along the way charging costs the least,
// counting the small detour off the road. Places come from Photon (OpenStreetMap), the road route
// from the OSRM demo server; without a connection it falls back to a straight-line estimate.
const CORRIDOR_KM = 3;
let route = null, rFromSel = { kind: "me" }, rToSel = null, activeField = "to", geoTimer = 0, geoSeq = 0;
const fold = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const fieldLabel = s => s.kind === "me" ? T().myLocation : s.kind === "home" ? T().homeLbl : s.label;
const ICON_PIN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const ICON_ME = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.5l7.2 2.3L12.5 20z"/></svg>';
const ICON_HOME = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3 2 11.5h3V20h5.5v-5h3v5H19v-8.5h3z"/></svg>';
let sgItems = [];
function renderSuggest(items) {
  sgItems = items;
  $("rSuggest").innerHTML = items.length ? items.map((s, n) => `<button class="sg" type="button" data-n="${n}"><span class="sg-ic">${s.kind === "me" ? ICON_ME : s.kind === "home" ? ICON_HOME : ICON_PIN}</span><span class="sg-t"><b>${esc(s.label)}</b>${s.sub ? `<em>${esc(s.sub)}</em>` : ""}</span></button>`).join("")
    : `<div class="sg-empty">${T().noGeo}</div>`;
}
function baseItems() {
  const it = activeField === "from" ? [{ kind: "me", label: T().myLocation }] : [];
  if (homeLoc) it.push({ kind: "home", label: T().homeLbl, pos: homeLoc });
  return it;
}
function suggestFor(q) {
  const f = fold(q.trim());
  if (!f) { renderSuggest([...baseItems(), ...TOWNS.slice(0, 5).map(([n, la, lo]) => ({ kind: "place", label: n, sub: "Lietuva", pos: [la, lo] }))]); return; }
  const local = TOWNS.filter(([n]) => fold(n).startsWith(f)).slice(0, 4).map(([n, la, lo]) => ({ kind: "place", label: n, sub: "Lietuva", pos: [la, lo] }));
  const mine = baseItems().filter(s => fold(s.label).startsWith(f));
  renderSuggest([...mine, ...local]);
  clearTimeout(geoTimer);
  if (f.length < 3) return;
  const seq = ++geoSeq;
  geoTimer = setTimeout(async () => {
    try {
      const c = map.getCenter();
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat.toFixed(1)}&lon=${c.lng.toFixed(1)}&bbox=14,49,28.5,60&lang=${lang === "lt" ? "default" : "en"}`);
      const j = await r.json(); if (seq !== geoSeq) return;
      const seen = new Set(local.map(x => x.label));
      const remote = (j.features || []).map(ft => { const p = ft.properties || {};
        const name = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || p.city;
        const sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : "", p.city && p.city !== name ? p.city : "", p.country].filter(Boolean).join(", ");
        return name && { kind: "place", label: name, sub, pos: [ft.geometry.coordinates[1], ft.geometry.coordinates[0]] }; })
        .filter(x => x && !seen.has(x.label) && (seen.add(x.label), true));
      renderSuggest([...mine, ...local, ...remote]);
    } catch { /* offline: local towns are still listed */ }
  }, 280);
}
function openRouteForm(field = "to") {
  $("routeForm").hidden = false; document.documentElement.classList.add("route-open");
  $("rFrom").value = fieldLabel(rFromSel); $("rTo").value = rToSel ? rToSel.label : "";
  activeField = field; const inp = field === "from" ? $("rFrom") : $("rTo");
  inp.focus(); inp.select();   // focus inside the tap itself, or iPhones won't open the keyboard
  suggestFor(field === "to" ? inp.value : "");
  if (isPhone() && sheetState !== "peek") snapSheet("peek");
}
function closeRouteForm() { $("routeForm").hidden = true; document.documentElement.classList.remove("route-open"); document.activeElement?.blur?.(); }
$("routeBar").onclick = () => openRouteForm("to");
$("routeClose").onclick = closeRouteForm;
for (const [id, field] of [["rFrom", "from"], ["rTo", "to"]]) {
  $(id).addEventListener("focus", () => { activeField = field; suggestFor(field === "from" && $(id).value === fieldLabel(rFromSel) ? "" : $(id).value); });
  $(id).addEventListener("input", () => suggestFor($(id).value));
  $(id).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); if (sgItems[0]) pickSuggestion(sgItems[0]); } if (e.key === "Escape") closeRouteForm(); });
}
$("rSuggest").addEventListener("pointerdown", e => e.preventDefault());   // keep the keyboard open while tapping
$("rSuggest").addEventListener("click", e => { const b = e.target.closest(".sg"); if (b) pickSuggestion(sgItems[+b.dataset.n]); });
function pickSuggestion(s) {
  if (activeField === "from") { rFromSel = s; $("rFrom").value = fieldLabel(s); if (!rToSel) { activeField = "to"; $("rTo").focus(); suggestFor(""); return; } }
  else { rToSel = s.kind === "me" || s.kind === "home" ? { ...s, label: fieldLabel(s) } : s; $("rTo").value = rToSel.label; }
  if (rToSel) planRoute();
}
async function resolvePlace(s) {
  if (s.kind === "me") { const p = userPos || await getMyLocation(); return p && { pos: p, label: T().myLocation, kind: "me" }; }
  if (s.kind === "home") return homeLoc && { pos: homeLoc, label: T().homeLbl, kind: "home" };
  return { pos: s.pos, label: s.label, kind: "place" };
}
const setBestLabel = () => { $("bestBtn").textContent = route ? T().replan : T().bestCharge; };
function setRouteTxt() {
  $("routeTxt").innerHTML = route ? `<b>${esc(route.from.kind === "me" ? T().myLocation : route.from.kind === "home" ? T().homeLbl : route.from.label)}</b><i>→</i><b>${esc(route.to.label)}</b>`
    : `<span class="ph">${T().whereTo}</span>`;
}
const fmtKm = d => `${Math.round(d)} km`;
const fmtDur = s => { const m = Math.round(s / 60), hh = Math.floor(m / 60); return hh ? `${hh} h ${m % 60} min` : `${m} min`; };
let routeTimes = [];
async function planRoute() {
  closeRouteForm();
  const now = Date.now(); routeTimes = routeTimes.filter(t => now - t < 60000);
  if (routeTimes.length >= 8) { toast(T().tooMany); return; }   // be fair to the free route server
  routeTimes.push(now);
  const from = await resolvePlace(rFromSel), to = await resolvePlace(rToSel);
  if (!from) { toast(T().routeNoFrom); openRouteForm("from"); return; }
  if (!to) return;
  toast(T().routing, 10000);
  let coords, dist, dur, approx = false;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.pos[1]},${from.pos[0]};${to.pos[1]},${to.pos[0]}?overview=full&geometries=geojson`, { signal: ctl.signal });
    clearTimeout(tm);
    const rt = (await r.json()).routes[0];
    coords = rt.geometry.coordinates; dist = rt.distance / 1000; dur = rt.duration;
    $("toast").hidden = true;
  } catch {
    approx = true;
    coords = Array.from({ length: 61 }, (_, k) => [from.pos[1] + (to.pos[1] - from.pos[1]) * k / 60, from.pos[0] + (to.pos[0] - from.pos[0]) * k / 60]);
    dist = km(from.pos[0], from.pos[1], to.pos[0], to.pos[1]) * ROAD_FACTOR; dur = dist / 70 * 3600;
    toast(T().routeFail);
  }
  route = { from, to, coords, dist, dur, approx };
  document.documentElement.classList.add("route-on"); setBestLabel();
  setRouteTxt();
  $("routeClear").hidden = false;
  if (closeDetail && selected != null) closeDetail();
  map.getSource("route")?.setData({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} });
  map.getSource("me")?.setData({ type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [from.pos[1], from.pos[0]] }, properties: { kind: from.kind === "home" ? "home" : "me" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [to.pos[1], to.pos[0]] }, properties: { kind: "dest" } }] });
  map.getSource("links")?.setData({ type: "FeatureCollection", features: [] });
  routeBest();
  const b = new maplibregl.LngLatBounds(coords[0], coords[0]); coords.forEach(c => b.extend(c));
  map.fitBounds(b, { padding: { top: 110, bottom: isPhone() ? window.innerHeight * 0.55 : 60, left: isPhone() ? 40 : 440, right: 40 }, maxZoom: 13, pitch: 0, bearing: 0 });
}
// ---------- trip planner: where to charge on the way ----------
// The formulas, in plain words:
//  1. Energy for a stretch of road = km × consumption. Consumption = your car's figure × a speed factor
//     (motorways use more) × a winter factor (Nov–Mar). The speed comes from the route's own time and distance.
//  2. If the battery covers the whole trip and still leaves the reserve, no stop is needed.
//  3. Otherwise every combination of fast chargers along the road is weighed (dynamic programming):
//     cost of a stop = price × kWh charged + (charging time + detour + getting on/off the road) × value of your time.
//     At each stop you charge only what the next stretch needs. Above 80 % charging runs at about a third of the speed,
//     so the plan only goes past 80 % when that beats another stop. You never plan to arrive anywhere below 10 %.
//     The plan with the lowest total wins.
//  4. "Fastest" is the same formula with time weighted very heavily.
//  5. "Round trip" plans the way there and back as one journey.
//  6. If the road leaves the area we have stations for, it plans up to the last station and warns you.
const RESERVE = 0.10, DC_TARGET = 0.80, SLOW_ABOVE = 0.35, STOP_MIN = 10, DETOUR_KMH = 45, FASTEST_EUR_H = 300;
let tripSoc = store.get("tripSoc", 80), tripMode = store.get("tripMode", "cheap"), roundTrip = store.get("roundTrip", false);
let tripPlan = null;
function tripCar() {
  const known = !!(myCar && myCar[4]);
  return { batt: known ? myCar[4] : 60, dcKw: myCar && myCar[7] ? myCar[7] : 100, known };
}
function tripConsumption(distKm, durS) {
  const v = distKm / Math.max(durS / 3600, 0.05);
  const speedF = v > 95 ? 1.22 : v > 80 ? 1.15 : v > 60 ? 1.05 : 0.95;
  const mo = new Date().getMonth(), winter = mo >= 10 || mo <= 2;
  return { per100: car.cons * speedF * (winter ? 1.15 : 1), motorway: v > 80, winter };
}
// average charging power from ~10 % to 80 % at this station for this car
const stopKw = l => Math.max(5, Math.min(l.kw, tripCar().dcKw) * 0.75);
function chargeMin(rate, arriveKwh, q, B) {
  const fastPart = Math.min(q, Math.max(0, DC_TARGET * B - arriveKwh));
  return fastPart / rate * 60 + (q - fastPart) / (rate * SLOW_ABOVE) * 60;
}
// stations near the road, with where along the trip they are (km) and how far off the road
function stationsAlong(legs) {
  const out = [];
  let offset = 0;
  for (const pts of legs) {
    const samp = [[pts[0][0], pts[0][1], 0]]; let run = 0;
    for (let k = 1; k < pts.length; k++) {
      run += km(pts[k - 1][1], pts[k - 1][0], pts[k][1], pts[k][0]);
      if (run - samp[samp.length - 1][2] >= 0.3 || k === pts.length - 1) samp.push([pts[k][0], pts[k][1], run]);
    }
    const scale = route.dist / Math.max(run, 0.1);
    let minLo = 180, maxLo = -180, minLa = 90, maxLa = -90;
    for (const [lo, la] of samp) { minLo = Math.min(minLo, lo); maxLo = Math.max(maxLo, lo); minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la); }
    for (const l of L) {
      if (l.la < minLa - 0.05 || l.la > maxLa + 0.05 || l.lo < minLo - 0.09 || l.lo > maxLo + 0.09) continue;
      const cosLa = Math.cos(l.la * Math.PI / 180); let best = Infinity, at = 0;
      for (const [lo, la, d] of samp) { const dx = (lo - l.lo) * cosLa, dy = la - l.la, dd = dx * dx + dy * dy; if (dd < best) { best = dd; at = d; } }
      const off = Math.sqrt(best) * 111.2;
      if (off <= CORRIDOR_KM) out.push({ l, off, at: offset + at * scale });
    }
    offset += route.dist;
  }
  return out;
}
function planTrip() {
  const tc = tripCar(), B = tc.batt, legs = roundTrip ? [route.coords, route.coords.slice().reverse()] : [route.coords];
  const total = route.dist * legs.length, dur = route.dur * legs.length;
  const cons = tripConsumption(route.dist, route.dur), kwhPerKm = cons.per100 / 100;
  const s0 = tripSoc / 100, val = tripMode === "fast" ? FASTEST_EUR_H : car.timeVal;
  const near = stationsAlong(legs);
  // stops: fast chargers this car can use, with a known price
  let stops = near.map(x => ({ ...x, ...priceOf(x.l, true) })).filter(x => x.p != null && x.p > 0);
  stops.sort((a, b) => a.at - b.at);
  const nodes = [{ at: 0, d: 0, start: 1 }, ...stops.map(x => ({ ...x, d: x.off * ROAD_FACTOR, rate: stopKw(x.l) })), { at: total, d: 0, dest: 1 }];
  const N = nodes.length, END = N - 1;
  const E = (i, j) => (nodes[j].at - nodes[i].at + nodes[i].d + nodes[j].d) * kwhPerKm;   // energy from i to j incl. detours
  const firstBudget = (s0 - RESERVE) * B;
  // direct: no stop needed
  if (E(0, END) <= firstBudget) return { kind: "none", total, dur, cons, tc, arrive: (s0 * B - E(0, END)) / B, near };
  // state k: 0 = reached straight from the start (arrives with what is left of the start charge), 1 = from a stop (arrives at the reserve)
  const best = [new Array(N).fill(null), new Array(N).fill(null)];
  for (let j = 1; j < END; j++) if (E(0, j) <= firstBudget) best[0][j] = { obj: 0, money: 0, min: 0, prev: null };
  const cap = B, maxLeg = (cap - RESERVE * B) / kwhPerKm + 10;
  let bestEnd = null;
  for (let i = 1; i < END; i++) for (let k = 0; k < 2; k++) {
    const s = best[k][i]; if (!s) continue;
    const n = nodes[i], arrive = k === 0 ? s0 * B - E(0, i) : RESERVE * B;
    for (let j = i + 1; j < N; j++) {
      if (nodes[j].at - n.at > maxLeg) break;
      const need = E(i, j) + RESERVE * B - arrive;
      if (need < 1 || arrive + need > cap + 0.01) continue;
      const min = chargeMin(n.rate, arrive, need, B) + STOP_MIN + 2 * n.d / DETOUR_KMH * 60;
      const money = n.p * need, obj = s.obj + money + min / 60 * val;
      const cand = { obj, money: s.money + money, min: s.min + min, prev: [i, k], q: need, arrive };
      if (j === END) { if (!bestEnd || obj < bestEnd.obj) bestEnd = cand; }
      else if (!best[1][j] || obj < best[1][j].obj) best[1][j] = cand;
    }
  }
  const walk = endState => {
    const list = []; let cur = endState;
    while (cur && cur.prev) { const [i, k] = cur.prev; const n = nodes[i];
      list.unshift({ ...n, q: cur.q, socIn: cur.arrive / B, socOut: (cur.arrive + cur.q) / B, min: chargeMin(n.rate, cur.arrive, cur.q, B) + STOP_MIN + 2 * n.d / DETOUR_KMH * 60 });
      cur = best[k][i]; }
    return list;
  };
  const avgP = stops.length ? stops.reduce((a, x) => a + x.p, 0) / stops.length : 0;
  if (bestEnd) {
    const plan = walk(bestEnd);
    return { kind: "stops", total, dur, cons, tc, stops: plan, money: bestEnd.money, min: bestEnd.min, arrive: RESERVE, avgP, near };
  }
  // no full plan: the road runs past the stations we know (e.g. abroad) or the battery is too low to reach the first one
  let far = null;
  for (let j = 1; j < END; j++) for (let k = 0; k < 2; k++) { const s = best[k][j]; if (s && (!far || nodes[j].at > nodes[far[0]].at)) far = [j, k]; }
  if (!far) return { kind: "unreachable", total, dur, cons, tc, near };
  const [fj, fk] = far, fn = nodes[fj], arriveF = fk === 0 ? s0 * B - E(0, fj) : RESERVE * B, qF = Math.max(0, DC_TARGET * B - arriveF);
  const plan = walk(best[fk][fj]);
  plan.push({ ...fn, q: qF, socIn: arriveF / B, socOut: DC_TARGET, min: chargeMin(fn.rate, arriveF, qF, B) + STOP_MIN, last: true });
  const money = best[fk][fj].money + fn.p * qF, leftKm = total - fn.at, rangeKm = (DC_TARGET - RESERVE) * B / kwhPerKm;
  return { kind: "partial", total, dur, cons, tc, stops: plan, money, min: best[fk][fj].min + plan[plan.length - 1].min, leftKm, rangeKm, avgP, near };
}
// battery level along the trip, as a small chart
function socChart(plan) {
  const W = 320, H = 64, B = plan.tc.batt, kpk = plan.cons.per100 / 100, X = km => 6 + km / plan.total * (W - 12), Y = s => 6 + (1 - Math.max(0, Math.min(1, s))) * (H - 12);
  const pts = [[0, tripSoc / 100]];
  for (const s of plan.stops || []) { pts.push([s.at, s.socIn], [s.at, s.socOut]); }
  const lastAt = pts[pts.length - 1][0], lastSoc = pts[pts.length - 1][1];
  pts.push([plan.total, plan.kind === "partial" ? Math.max(0, lastSoc - (plan.total - lastAt) * kpk / B) : plan.arrive]);
  const line = pts.map(([k, s]) => `${X(k).toFixed(1)},${Y(s).toFixed(1)}`).join(" ");
  const dots = (plan.stops || []).map((s, n) => `<circle cx="${X(s.at).toFixed(1)}" cy="${Y(s.socOut).toFixed(1)}" r="4.5"/><text x="${X(s.at).toFixed(1)}" y="${(Y(s.socOut) - 9).toFixed(1)}">${Math.round(s.socOut * 100)}%</text>`).join("");
  return `<svg class="soc" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><linearGradient id="socG" x1="0" x2="1"><stop offset="0" stop-color="#b9ccff"/><stop offset="1" stop-color="#3d6bff"/></linearGradient></defs>
    <line class="res" x1="6" x2="${W - 6}" y1="${Y(RESERVE).toFixed(1)}" y2="${Y(RESERVE).toFixed(1)}"/>
    <polyline points="${line}"/>${dots}
    <text class="end" x="${W - 6}" y="${H - 2}">${Math.round(Math.max(0, pts[pts.length - 1][1]) * 100)}%</text>
    <text class="beg" x="6" y="${H - 2}">${tripSoc}%</text></svg>`;
}
function tripNavUrl(stops) {
  const wp = stops.map(s => `${s.l.la},${s.l.lo}`).join("|");
  const dest = roundTrip ? route.from.pos : route.to.pos;
  return `https://www.google.com/maps/dir/?api=1${route.from.kind === "me" ? "" : `&origin=${route.from.pos.join(",")}`}&destination=${dest.join(",")}${wp ? `&waypoints=${encodeURIComponent(wp)}` : ""}&travelmode=driving`;
}
function setStopsOnMap(stops) {
  map.getSource("stops")?.setData({ type: "FeatureCollection", features: (stops || []).map((s, n) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.l.lo, s.l.la] }, properties: { n: String(n + 1) } })) });
}
function buildTripControls() {
  liquidSeg($("socSeg"), [20, 40, 60, 80, 100].map(v => ({ value: String(v), label: `${v}%` })), String(tripSoc), v => {
    tripSoc = +v; store.set("tripSoc", tripSoc); if (route) routeBest(); });
  liquidSeg($("modeSeg"), [{ value: "cheap", label: T().modeCheap }, { value: "fast", label: T().modeFast }], tripMode, v => {
    tripMode = v; store.set("tripMode", v); if (route) routeBest(); });
  $("rtChip").classList.toggle("on", roundTrip);
}
$("rtChip").onclick = () => { roundTrip = !roundTrip; store.set("roundTrip", roundTrip); $("rtChip").classList.toggle("on", roundTrip); if (route) routeBest(); };
function routeBest() {
  if (!route) return;
  if (isPhone() && sheetState === "peek") snapSheet("half");
  const t = T(), plan = tripPlan = planTrip();
  const head = `<div class="res-head">${t.tripHead(fmtKm(plan.total), fmtDur(plan.dur))}${roundTrip ? " · " + t.roundTrip.toLowerCase() : ""}</div>`;
  const consLine = `<div class="trip-note">${t.consNote(plan.cons.per100.toFixed(1).replace(".", lang === "lt" ? "," : "."), plan.cons.motorway, plan.cons.winter)}${plan.tc.known ? "" : " · " + t.noCarBatt}</div>`;
  let html = head;
  if (plan.kind === "none") {
    // formula 2: no stop needed – show where it is cheapest to top up once you arrive
    html += `<div class="trip-sum ok"><div class="ts-top"><b>${t.noStop}</b><span>${t.arriveWith(Math.round(plan.arrive * 100))}</span></div>${socChart(plan)}</div>${consLine}`;
    const dest = roundTrip ? route.from.pos : route.to.pos, refill = Math.max(5, (DC_TARGET - plan.arrive) * plan.tc.batt);
    const atDest = L.map(l => ({ l, d: km(dest[0], dest[1], l.la, l.lo), ...priceOf(l, false) })).filter(x => x.d <= 5 && x.p > 0)
      .map(x => ({ ...x, c: { total: x.p * refill } })).sort((a, b) => a.c.total - b.c.total);
    const top = []; for (const x of atDest) { if (top.every(y => km(y.l.la, y.l.lo, x.l.la, x.l.lo) > 0.3)) top.push(x); if (top.length === 3) break; }
    if (top.length) html += `<div class="res-head">${t.nearDestHead(Math.round(refill))}</div>` + top.map((x, n) => pickHTML(x, n, t.destMeta(x.d.toFixed(1).replace(".", lang === "lt" ? "," : "."), kwhPrice(x.p)))).join("");
    pinned = new Set(top.map(x => x.l.i)); lastPicks = new Map(top.map(x => [x.l.i, { op: x.o.op, total: x.c.total, save: 0 }]));
    setStopsOnMap([]);
  } else if (plan.kind === "unreachable") {
    html += `<div class="trip-sum warn"><b>${t.cantReach(tripSoc)}</b></div>${consLine}`;
    pinned = new Set(); lastPicks = new Map(); setStopsOnMap([]);
  } else {
    const n = plan.stops.length, saved = plan.stops.reduce((a, s) => a + Math.max(0, (plan.avgP - s.p) * s.q), 0);
    html += `<div class="trip-sum${plan.kind === "partial" ? " warn" : ""}">
      <div class="ts-top"><span class="amt" data-v="${plan.money}">${money(plan.money)}</span>
        <span>${t.stopsCount(n)} · +${Math.round(plan.min)} min</span></div>
      ${socChart(plan)}
      ${saved > 0.5 ? `<div class="ts-save">${t.cheaperAvg(money(saved))}</div>` : ""}
      ${plan.kind === "partial" ? `<div class="ts-warn">${t.outOfData(Math.round(plan.rangeKm), Math.round(plan.leftKm))}</div>` : ""}
    </div>${consLine}`;
    html += plan.stops.map((s, k) => `<div class="pick stop${k === 0 ? " first" : ""}" data-i="${s.l.i}" style="animation-delay:${k * 80}ms">
      <div class="stop-n">${k + 1}</div>
      <div class="meta"><b>${esc(s.o.op)} · ${money(s.p * s.q)}</b><span>${t.stopMeta(Math.round(s.at), Math.round(s.q), Math.round(s.socIn * 100), Math.round(s.socOut * 100), Math.round(s.min))}</span></div>
      <button class="nav-mini" data-nav="${s.l.i}" aria-label="${t.navigate}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.5l7.2 2.3L12.5 20z"/></svg></button>
    </div>`).join("");
    html += `<a class="go trip-go" id="tripGo" href="${tripNavUrl(plan.stops)}" target="_blank" rel="noopener">${t.startTrip}</a><div class="trip-note">${t.startTripNote}</div>`;
    pinned = new Set(plan.stops.map(s => s.l.i));
    lastPicks = new Map(plan.stops.map(s => [s.l.i, { op: s.o.op, total: s.p * s.q, save: Math.max(0, (plan.avgP - s.p) * s.q) }]));
    setStopsOnMap(plan.stops);
  }
  refreshMap(false);
  $("results").innerHTML = html;
  wirePicks();
  $("tripGo")?.addEventListener("click", () => plan.stops.forEach(s => logCharge(s.l.i)));
}
function clearRoute() {
  route = null; document.documentElement.classList.remove("route-on"); setBestLabel();
  rToSel = null; setRouteTxt(); $("routeClear").hidden = true;
  map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
  setOriginMarker(null); pinned = new Set(); lastPicks = new Map(); tripPlan = null; setStopsOnMap([]); refreshMap(false);
  $("results").innerHTML = ""; document.querySelector(".legend").hidden = false;
  requestAnimationFrame(() => snapSheet(sheetState, false));
}
$("routeClear").onclick = clearRoute;

// ---------- home & car settings ----------
function openCar() {
  const t = T();
  $("acctBox").hidden = !authUser;
  if (authUser) $("acctName").textContent = t.signedInAs(authUser.displayName || authUser.email || "");
  $("homeStatus").textContent = homeLoc ? t.homeSet(townOf({ la: homeLoc[0], lo: homeLoc[1] })) : t.homeNotSet;
  $("homeClear").hidden = !homeLoc;
  $("cons").value = car.cons; $("wear").value = car.wear; $("timeVal").value = car.timeVal;
  $("carModal").hidden = false;
}
function setHome(pos) {
  homeLoc = [+pos[0].toFixed(5), +pos[1].toFixed(5)]; store.set("home", homeLoc);
  setOriginMarker(homeLoc, "home"); openCar(); toast(T().homeSaved);
}
$("homeHere").onclick = async () => { const p = await getMyLocation(); if (p) setHome(p); };
$("homeCentre").onclick = () => { const c = map.getCenter(); setHome([c.lat, c.lng]); };
$("homeClear").onclick = () => { homeLoc = null; store.set("home", null); setOriginMarker(null); openCar(); };
$("carSave").onclick = () => {
  const num = (id, d, lo, hi) => { const v = parseFloat(String($(id).value).replace(",", ".")); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  car = { cons: num("cons", CAR_DEFAULTS.cons, 8, 40), wear: num("wear", CAR_DEFAULTS.wear, 0, 1), timeVal: num("timeVal", CAR_DEFAULTS.timeVal, 0, 200) };
  store.set("car", car); $("carModal").hidden = true;
  if ($("results").innerHTML) rerun();
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
  const lines = targets.map(x => ({ pts: arc(from, [x.l.lo, x.l.la]), c: x.best ? "#9db8ff" : "#3d6bff", best: x.best ? 1 : 0 }));
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

// ---------- liquid glass segmented control (like the iOS tab bar) ----------
// A clear glass lens sits on the chosen option. Switching makes it pop out, stretch while it slides
// on a spring, magnify what is under it, then settle. You can also drag the lens across the options.
function liquidSeg(host, options, value, onChange) {
  host.innerHTML = '<span class="lens" aria-hidden="true"></span>' +
    options.map(o => `<button type="button" role="radio" data-v="${o.value}" title="${o.title || ""}">${o.label}</button>`).join("");
  const lens = host.querySelector(".lens"), btns = [...host.querySelectorAll("button")];
  const place = (btn, animate) => {
    const r = btn.getBoundingClientRect(), hr = host.getBoundingClientRect();
    lens.style.left = `${r.left - hr.left}px`; lens.style.width = `${r.width}px`;
    if (animate && !REDUCED_MOTION) { lens.classList.remove("moving"); void lens.offsetWidth; lens.classList.add("moving"); }
  };
  const mark = v => btns.forEach(b => { const on = b.dataset.v === String(v); b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  const choose = (btn, animate = true) => {
    mark(btn.dataset.v); place(btn, animate);
    if (btn.dataset.v !== String(value)) { value = btn.dataset.v; onChange(value); }
  };
  btns.forEach(b => b.addEventListener("click", () => choose(b)));
  // drag the lens like on iOS (a plain tap still works as a normal click)
  let dragging = false, x0 = null;
  host.addEventListener("pointerdown", e => { if (!REDUCED_MOTION) x0 = e.clientX; });
  host.addEventListener("pointermove", e => {
    if (x0 == null) return;
    if (!dragging) { if (Math.abs(e.clientX - x0) < 6) return; dragging = true; host.classList.add("drag"); try { host.setPointerCapture(e.pointerId); } catch {} }
    const hr = host.getBoundingClientRect(), w = lens.offsetWidth;
    lens.style.left = `${Math.min(hr.width - w - 4, Math.max(4, e.clientX - hr.left - w / 2))}px`;
    const mid = b => b.getBoundingClientRect().left + b.offsetWidth / 2;
    const near = btns.reduce((a, b) => Math.abs(mid(b) - e.clientX) < Math.abs(mid(a) - e.clientX) ? b : a);
    btns.forEach(b => b.classList.toggle("hover", b === near));
  });
  const end = () => {
    x0 = null; if (!dragging) return; dragging = false; host.classList.remove("drag");
    const near = host.querySelector("button.hover"); btns.forEach(b => b.classList.remove("hover"));
    if (near) choose(near); else place(btns.find(b => b.dataset.v === String(value)) || btns[0], true);
  };
  host.addEventListener("pointerup", end); host.addEventListener("pointercancel", end);
  const init = btns.find(b => b.dataset.v === String(value)) || btns[0];
  mark(init.dataset.v); requestAnimationFrame(() => place(init, false));
  new ResizeObserver(() => place(btns.find(b => b.classList.contains("on")) || btns[0], false)).observe(host);
}
function buildFastSeg() {
  liquidSeg($("fastSeg"), [{ value: "all", label: T().allChargers }, { value: "fast", label: T().fastChargers }], fastOnly ? "fast" : "all", v => {
    fastOnly = v === "fast"; store.set("fastOnly", fastOnly); refreshMap(); if ($("results").innerHTML) rerun(); if (selected != null) select(selected, false);
  });
}
function buildKwhSeg() {
  const opts = [...$("kwh").options].map((o, i) => ({ value: o.value,
    label: myCar && i === 0 ? `${T().autoLbl} ${o.value}` : `${o.value}`, title: o.textContent }));
  liquidSeg($("kwhSeg"), opts, $("kwh").value, v => { $("kwh").value = v; $("kwh").dispatchEvent(new Event("change")); });
}

// ---------- Waze-style bottom sheet (phones) ----------
// The panel is a sheet you drag with your finger. It snaps to three heights: peek (just the main
// button), half, and full. A quick flick decides the direction; otherwise it snaps to the nearest.
// Floating buttons ride just above it. On a computer it is a fixed side panel instead.
const isPhone = () => window.innerWidth < 760;
const sheet = $("panel");
let sheetState = "half", sheetY = 0, snaps = { full: 0, half: 0, peek: 0 };
function measureSheet() {
  const H = sheet.offsetHeight, vh = window.innerHeight;
  const anchor = $("detail").hidden ? sheet.querySelector(".actions") : $("dAmt");
  const padB = parseFloat(getComputedStyle(sheet).paddingBottom) || 18;
  const peekVis = anchor ? Math.min(H, anchor.offsetTop + anchor.offsetHeight + Math.max(16, padB)) : 120;
  snaps = { full: 0, half: Math.max(0, H - Math.round(vh * 0.52)), peek: Math.max(0, H - peekVis) };
  return H;
}
function setSheetY(y, animate) {
  sheetY = y;
  sheet.classList.toggle("anim", !!animate); document.documentElement.classList.toggle("sheet-moving", !animate);
  sheet.style.transform = isPhone() ? `translateY(${Math.round(y)}px)` : "";
  const vis = isPhone() ? sheet.offsetHeight - y : 0;
  document.documentElement.style.setProperty("--sheet-vis", `${Math.max(0, Math.round(vis))}px`);
  document.documentElement.classList.toggle("fab-off", isPhone() && vis > window.innerHeight * 0.68);
  const span = snaps.peek - snaps.half;
  const p = !isPhone() || span < 20 ? 1 : Math.min(1, Math.max(0, (snaps.peek - y) / span));
  document.documentElement.style.setProperty("--sheet-p", p.toFixed(3));
}
function snapSheet(state = sheetState, animate = true) {
  if (!isPhone()) { sheet.classList.add("at-full"); setSheetY(0, false); return; }
  measureSheet(); sheetState = state;
  sheet.classList.toggle("at-full", state === "full");
  if (state !== "full") sheet.scrollTop = 0;
  setSheetY(snaps[state], animate && !REDUCED_MOTION);
}
let suppressClickUntil = 0;
sheet.addEventListener("click", ev => { if (performance.now() < suppressClickUntil) { ev.stopPropagation(); ev.preventDefault(); } }, { capture: true });
(() => {
  let start = null, dragging = false, fromHandle = false, samples = [];
  sheet.addEventListener("pointerdown", e => {
    if (!isPhone() || e.button > 0) return;
    fromHandle = !!e.target.closest("#grab") || e.clientY - sheet.getBoundingClientRect().top < 30;
    if (sheetState === "full" && !fromHandle) return;           // at full height the content scrolls instead
    start = { y: e.clientY, y0: sheetY, id: e.pointerId }; dragging = false; samples = [[performance.now(), e.clientY]];
  });
  // follow the finger anywhere on screen (it often leaves the sheet while dragging it up)
  window.addEventListener("pointermove", e => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    if (!dragging) { if (Math.abs(dy) < 8) return; dragging = true; }
    let y = start.y0 + dy;
    if (y < 0) y = y / 3;                                        // rubber band past the top
    if (y > snaps.peek) y = snaps.peek + (y - snaps.peek) / 3;   // and past the bottom
    setSheetY(y, false);
    samples.push([performance.now(), e.clientY]); if (samples.length > 5) samples.shift();
  });
  const end = e => {
    if (!start) return;
    const wasDrag = dragging; start = null; dragging = false;
    if (!wasDrag) return;
    const [t0, y0] = samples[0], [t1, y1] = samples[samples.length - 1];
    const v = (y1 - y0) / Math.max(1, t1 - t0);                 // px per ms, + is down
    const order = ["full", "half", "peek"].filter(s => s !== "half" || snaps.half > 40);
    let target;
    if (Math.abs(v) > 0.45) {
      const sorted = order.map(s => [s, snaps[s]]).sort((a, b) => a[1] - b[1]);
      target = v > 0 ? (sorted.find(([, y]) => y > sheetY + 4) || sorted[sorted.length - 1])[0]
                     : ([...sorted].reverse().find(([, y]) => y < sheetY - 4) || sorted[0])[0];
    } else target = order.reduce((a, b) => Math.abs(snaps[b] - sheetY) < Math.abs(snaps[a] - sheetY) ? b : a);
    snapSheet(target);
    // a drag is not a tap: swallow the click that follows
    suppressClickUntil = performance.now() + 350;
  };
  window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  $("grab").addEventListener("click", () => snapSheet(sheetState === "peek" ? "half" : sheetState === "half" ? "full" : "peek"));
  $("grab").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("grab").click(); } });
})();
map.on("dragstart", () => { if (!$("routeForm").hidden) closeRouteForm();
 if (isPhone() && sheetState !== "peek") snapSheet("peek"); });
window.addEventListener("resize", () => snapSheet(sheetState, false));
new ResizeObserver(() => { if (!document.documentElement.classList.contains("sheet-moving")) snapSheet(sheetState, false); }).observe(sheet);

// floating "my location" button: start from where you are and show it
$("locBtn").onclick = async () => {
  const p = await getMyLocation(); if (!p) return;
  if (!route) setOriginMarker(p, "me");
  map.flyTo({ center: [p[1], p[0]], zoom: Math.max(map.getZoom(), 13), duration: REDUCED_MOTION ? 0 : 1200 });
};

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
    return `<button class="caropt" role="listitem" data-car="${i}"><b>${esc(carLabel(c))}</b><span>${esc(specs)}</span></button>`;
  }).join("") || (terms.length ? `<div class="note">${t.carNotFound}</div>` : "");
}
function openOnboard(changing = false) {
  $("onboard").hidden = false; $("onboard").dataset.changing = changing ? "1" : "";
  $("obAuth").hidden = !FIREBASE_CONFIG || !!authUser || changing;
  $("carSearch").value = ""; renderCarList(); loadCars();
  setTimeout(() => $("carSearch").focus(), 50);
}
function finishOnboard() { store.set("onboarded", true); $("onboard").hidden = true; if ($("onboard").dataset.changing) renderAccount(); else flyIntoLithuania(); }
function setKwhOptions() {
  const prev = $("kwh").value;
  let auto = myCar && myCar[4] ? Math.round(myCar[4] * 0.7) : null;
  const opts = [20, 40, 60].filter(k => k !== auto).map(k => `<option value="${k}">${k} kWh</option>`);
  if (auto) opts.unshift(`<option value="${auto}">${T().autoKwh(auto)}</option>`);
  $("kwh").innerHTML = opts.join("");
  $("kwh").value = auto && (!prev || store.get("kwhAuto", true)) ? String(auto) : (prev || "40");
  if (!$("kwh").value) $("kwh").value = "40";
  buildKwhSeg();
}
$("carSearch").addEventListener("input", renderCarList);
$("carList").addEventListener("click", async e => {
  const b = e.target.closest("[data-car]"); if (!b) return;
  const c = (await loadCars())[+b.dataset.car];
  myCar = c; store.set("myCar", c);
  if (c[5]) { car = { ...car, cons: c[5] }; store.set("car", car); }
  store.set("kwhAuto", true); setKwhOptions(); refreshMap(); toast(T().carSaved);
  if ($("results").innerHTML) rerun();
  finishOnboard();
});
$("carSkip").onclick = finishOnboard;

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
  } catch { /* sign-in unavailable: the app keeps working without it */ }
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
  buildFastSeg();
  $("carSearch").placeholder = T().carSearchPh;
  if ($("kwh").options.length) setKwhOptions();
  if (!$("onboard").hidden) renderCarList();
  buildTabs(); buildTripControls(); setBestLabel();
  $("rFrom").placeholder = T().fromPh; $("rTo").placeholder = T().toPh;
  setRouteTxt();
  renderAccount();
  $("infoBody").innerHTML = T().about + `<p class="legal-links">${legalLinks()}</p><button class="secondary" id="infoClose">${T().close}</button>`;
  $("obLegal").innerHTML = T().obLegal(`<a href="terms.html" target="_blank" rel="noopener">${T().termsLinkWith}</a>`, `<a href="privacy.html" target="_blank" rel="noopener">${T().privacyLink}</a>`);
  $("setLegal").innerHTML = legalLinks();
  $("infoClose").onclick = () => $("infoModal").hidden = true;
  setUpdated(); updateStats();
  if (L.length) { refreshMap(); if (selected != null) select(selected, false); if ($("results").innerHTML) rerun(); }
}
function setUpdated() {
  if (!DATA) return;
  const d = new Date(DATA.pub).toLocaleString(lang === "lt" ? "lt-LT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("updated").textContent = T().updated(d);
}
function setChips() { $("unkChip").classList.toggle("on", hideUnknown); }
$("langBtn").onclick = () => { lang = lang === "lt" ? "en" : "lt"; store.set("lang", lang); applyLang(); };
$("infoBtn").onclick = () => { $("carModal").hidden = true; $("infoModal").hidden = false; };
$("infoModal").addEventListener("click", e => { if (e.target.id === "infoModal") $("infoModal").hidden = true; });
$("unkChip").onclick = () => { hideUnknown = !hideUnknown; store.set("hideUnknown", hideUnknown); setChips(); refreshMap(); };
$("bestBtn").onclick = () => route ? routeBest() : bestCharge();
$("kwh").onchange = () => { store.set("kwhAuto", !!myCar && $("kwh").selectedIndex === 0); refreshMap(false); if ($("results").innerHTML) rerun(); if (selected != null) select(selected, false); };

// ---------- load ----------
applyLang(); setChips(); setKwhOptions(); initAuth(); requestAnimationFrame(() => snapSheet("half", false));
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
