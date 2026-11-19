"use strict";
// ---------- config ----------
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
function toast(msg, ms = 3500) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, ms); }

// ---------- state ----------
let L = [], DATA = null, selected = null, userPos = null, lastOrigin = null;
let homeLoc = store.get("home", null);              // [lat, lon] or null
let car = { ...CAR_DEFAULTS, ...store.get("car", {}) };
let fastOnly = store.get("fastOnly", false), hideUnknown = store.get("hideUnknown", false);
const isFast = l => l.kw > 22;
function offerPrice(o, l, fast) { if (fast) { if (o.dc != null) return o.dc; return l.kw > 22 ? o.m : null; } return o.m; }
function priceOf(l, fast = fastOnly) {
  let best = null, offer = null;
  for (const o of l.offers) { const p = offerPrice(o, l, fast); if (p != null && (best == null || p < best)) { best = p; offer = o; } }
  return { p: best, o: offer };
}

// ---------- map ----------
const LITHUANIA = { center: [23.9, 55.2], zoom: 6.3, pitch: 0, bearing: 0 };
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
  try { map.setSky({ "sky-color": "#0b1530", "horizon-color": "#1e3a5f", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0] }); } catch {}
});

// Price level of a location, used for both the colour and the marker icon.
const levelKey = p => p == null ? "unk" : p === 0 ? "free" : p <= 0.29 ? "cheap" : p <= 0.37 ? "mid" : "high";
const LEVEL_COLOURS = { free: "#0ea5e9", cheap: "#16a34a", mid: "#f59e0b", high: "#dc2626", unk: "#94a3b8" };

function geojson() {
  const features = [];
  for (const l of L) {
    if (fastOnly && !isFast(l)) continue;
    const { p } = priceOf(l);
    if (hideUnknown && p == null) continue;
    const k = levelKey(p);
    // Placement priority when zoomed out (lower = shown first): stations with a known low price,
    // fast chargers and bigger sites win; others appear as you zoom in and space frees up.
    const rank = (p == null ? 1000 : p === 0 ? 60 : p * 100) - (isFast(l) ? 8 : 0) - Math.min(l.n, 8);
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [l.lo, l.la] },
      properties: { i: l.i, rank, c: colourOf(p), known: p == null ? 0 : 1, icon: `badge-${k}${isFast(l) ? "-dc" : ""}`,
        label: p == null ? "" : p === 0 ? T().free : money(p) } });
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
  map.addSource("chargers", { type: "geojson", data: geojson() });
  map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // One marker layer for every zoom. Markers that would overlap are hidden (collision detection),
  // so the map shows a few of the best stations from far away and more as you zoom in.
  map.addLayer({ id: "badges", type: "symbol", source: "chargers",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 9, 0.6, 13, 0.85, 16, 1.05],
      "icon-padding": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 3, 14, 1],
      "icon-allow-overlap": false, "icon-ignore-placement": false,
      "symbol-sort-key": ["get", "rank"],
      // prices appear under the markers when zoomed in close; a hidden label never hides its marker
      "text-field": ["step", ["zoom"], "", 12.5, ["get", "label"]],
      "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.6], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": "#f1f5f9", "text-halo-color": "#0b1220", "text-halo-width": 1.8 } });
  map.addLayer({ id: "selected", type: "symbol", source: "chargers", filter: ["==", ["get", "i"], -1],
    layout: { "icon-image": ["concat", ["get", "icon"], "-sel"], "icon-size": 1.25, "icon-allow-overlap": true, "icon-ignore-placement": true } });
  map.addLayer({ id: "me", type: "circle", source: "me",
    paint: { "circle-color": ["match", ["get", "kind"], "home", "#a78bfa", "#60a5fa"], "circle-radius": 9, "circle-stroke-color": "#0b1220", "circle-stroke-width": 3 } });
  for (const layer of ["badges", "selected"]) {
    map.on("click", layer, e => select(e.features[0].properties.i, false));
    map.on("mouseenter", layer, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", layer, () => map.getCanvas().style.cursor = "");
  }
}
function refreshMap() { const s = map.getSource("chargers"); if (s) s.setData(geojson()); highlight(); }
function highlight() { if (map.getLayer("selected")) map.setFilter("selected", ["==", ["get", "i"], selected ?? -1]); }

// ---------- station detail ----------
function select(i, fly = true) {
  selected = i; highlight();
  const l = L[i], t = T(), kwh = +$("kwh").value;
  const { p, o } = priceOf(l);
  const priced = l.offers.filter(x => x.m != null).length;
  let total = p == null ? t.noPriceLong : p === 0 ? t.freeToCharge : t.forKwh(money(p * kwh), kwh, Math.round(kwh / car.cons * 100));
  if (p != null && p > 0 && lastOrigin) {
    const c = tripCost(km(lastOrigin.pos[0], lastOrigin.pos[1], l.la, l.lo), p, kwh);
    total += `<div class="breakdown">${t.detailTrip(lastOrigin.label, Math.round(c.road * 10) / 10, money(c.trip), money(c.total))}</div>`;
  }
  const offers = l.offers.map(x => {
    const sub = [x.ac != null && t.slowFrom(money(x.ac)), x.dc != null && t.fastFrom(money(x.dc))].filter(Boolean).join(" · ");
    const head = x.m == null ? t.noPrice : x.f ? t.free : `${t.from} ${kwhPrice(x.m)}`;
    return `<div class="offer"><div class="h"><span>${x.op}</span><span style="color:${colourOf(x.f ? 0 : x.m)}">${head}</span></div>
      ${sub ? `<div class="s">${sub}</div>` : ""}
      ${x.t.length ? `<ul>${x.t.map(s => `<li>${translateTariff(s)}</li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
  $("detail").innerHTML = `
    <div class="d-top">
      <div>
        <div class="d-where">${townOf(l)} · ${t.points(l.n)} · ${t.upTo} ${l.kw} kW · ${l.ctxt}</div>
        <div class="d-price">${p == null ? "—" : p === 0 ? t.free : `${money(p)}<small>/kWh</small>`}</div>
        <div class="d-total">${total}${o && l.offers.length > 1 && p != null ? " · " + t.cheapestVia(o.op) : ""}</div>
      </div>
      <span class="tag" style="background:${colourOf(p)}">${levelOf(p)}</span>
    </div>
    <div class="d-actions">
      <button class="go" id="dNav"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.5l7.2 2.3L12.5 20z"/></svg> ${t.navigate}</button>
      <button class="secondary" id="dClose">${t.close}</button>
    </div>
    ${l.offers.length > 1 ? `<div class="inf">${t.manyCompanies(l.offers.length, priced)}</div>` : ""}
    ${l.offers.some(x => x.pk) ? `<div class="warn">${t.parkingWarn}</div>` : ""}
    ${l.offers.some(x => x.fx) ? `<div class="warn">${t.fixedWarn}</div>` : ""}
    ${l.offers.some(x => x.fo) ? `<div class="inf">${t.freeOptInfo}</div>` : ""}
    ${offers}`;
  $("home").hidden = true; $("detail").hidden = false; $("panel").scrollTop = 0;
  $("dNav").onclick = () => navigate(l);
  $("dClose").onclick = closeDetail;
  if (fly) map.flyTo({ center: [l.lo, l.la], zoom: Math.max(map.getZoom(), 14) });
}
function closeDetail() { selected = null; highlight(); $("detail").hidden = true; $("home").hidden = false; }

// ---------- navigation hand-off ----------
function navigate(l) {
  const ll = `${l.la},${l.lo}`;
  const links = {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
    apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
  };
  $("navGoogle").href = links.google; $("navWaze").href = links.waze; $("navApple").href = links.apple;
  $("navModal").hidden = false;
}
for (const id of ["navGoogle", "navWaze", "navApple"]) $(id).addEventListener("click", () => $("navModal").hidden = true);
$("navCancel").onclick = () => $("navModal").hidden = true;
$("navModal").addEventListener("click", e => { if (e.target.id === "navModal") $("navModal").hidden = true; });

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
  $("results").innerHTML = `<div class="res-head">${t.resultsFrom(origin.label, kwh)}</div>` + top.map(x => {
    const saving = nearest.c.total - x.c.total;
    const badge = x === nearest ? `<span class="save">${t.isNearest}</span>` : saving > 0.2 ? `<span class="save">${t.vsNearest(money(saving))}</span>` : "";
    return `<div class="pick" data-i="${x.l.i}">
      <div class="amt" style="color:${colourOf(x.p)}">${money(x.c.total)}</div>
      <div class="meta"><b>${x.o.op}</b> · ${townOf(x.l)} · ${t.away(x.c.oneWay.toFixed(1))}<br>
        <span class="breakdown">${t.breakdown(money(x.c.charge), money(x.c.trip))} · ${kwhPrice(x.p)}${x.o.pk || x.o.fx ? " · " + t.extraFees : ""}</span>
        ${badge ? "<br>" + badge : ""}</div>
      <button class="nav-mini" data-nav="${x.l.i}" aria-label="${t.navigate}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.5l7.2 2.3L12.5 20z"/></svg></button>
    </div>`;
  }).join("") + `<div class="note">${t.tripNote(money(car.wear), money(car.timeVal), car.cons)}${freeN ? " " + t.freeNearby(freeN) : ""}</div>`;
  $("results").querySelectorAll(".pick").forEach(el => el.addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { e.stopPropagation(); navigate(L[+nav.dataset.nav]); } else select(+el.dataset.i);
  }));
  const b = new maplibregl.LngLatBounds([oLo, oLa], [oLo, oLa]);
  top.forEach(x => b.extend([x.l.lo, x.l.la]));
  map.fitBounds(b, { padding: { top: 140, bottom: window.innerWidth < 760 ? window.innerHeight * 0.55 : 60, left: window.innerWidth < 760 ? 40 : 440, right: 40 }, maxZoom: 14, pitch: 35 });
}

// ---------- home & car settings ----------
function openCar() {
  const t = T();
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

// ---------- UI wiring ----------
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => el.textContent = T()[el.dataset.t]);
  $("langBtn").textContent = lang === "lt" ? "EN" : "LT";
  $("origin").innerHTML = `<option value="me">${T().originMe}</option><option value="home">${T().originHome}</option>` +
    CITIES.map(c => `<option value="${c.id}">${c.en}</option>`).join("");
  $("origin").value = store.get("origin", homeLoc ? "home" : "me");
  $("infoBody").innerHTML = T().about + `<button class="secondary" id="infoClose">${T().close}</button>`;
  $("infoClose").onclick = () => $("infoModal").hidden = true;
  setUpdated();
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
$("kwh").onchange = () => { if ($("results").innerHTML) bestCharge(); if (selected != null) select(selected, false); };

// ---------- load ----------
applyLang(); setChips();
const dataReady = fetch(DATA_URL, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => {
  DATA = d;
  const ct = c => [(c & 1) && "Type 2", (c & 2) && "CCS", (c & 4) && "CHAdeMO"].filter(Boolean).join(", ") || "—";
  L = d.s.map(([la, lo, kw, n, c, offers], i) => ({ i, la, lo, kw, n, ctxt: ct(c),
    offers: offers.map(([op, m, ac, dc, fl, tt]) => ({ op: d.ops[op], m: (fl & 1) ? 0 : m, ac, dc, f: fl & 1, fo: fl & 2, pk: fl & 4, fx: fl & 8, t: tt.map(j => d.T[j]) })) }));
  setUpdated();
}).catch(() => toast(T().loadFail, 8000));
map.on("load", () => {
  dataReady.then(addLayers);
  if (firstVisit) { store.set("seenGlobe", true); setTimeout(() => map.flyTo({ ...LITHUANIA, duration: 4500, essential: true }), 600); }
});
