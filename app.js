"use strict";
// ---------- config ----------
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const DATA_URL = "data/lt.json";
const RADIUS_KM = 8;            // search radius for Best Charge
const DETOUR_EUR_PER_KM = 0.004; // convenience: each km of detour counts as +€0.004/kWh
const KM_PER_KWH = 6.5;
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
let L = [], DATA = null, selected = null, userPos = null;
let fastOnly = store.get("fastOnly", false), hideUnknown = store.get("hideUnknown", false);
const isFast = l => l.kw > 22;
function offerPrice(o, l, fast) { if (fast) { if (o.dc != null) return o.dc; return l.kw > 22 ? o.m : null; } return o.m; }
function priceOf(l, fast = fastOnly) {
  let best = null, offer = null;
  for (const o of l.offers) { const p = offerPrice(o, l, fast); if (p != null && (best == null || p < best)) { best = p; offer = o; } }
  return { p: best, o: offer };
}

// ---------- map ----------
const map = new maplibregl.Map({
  container: "map", style: MAP_STYLE, center: [23.9, 55.2], zoom: 6.3, minZoom: 5,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

function geojson() {
  const features = [];
  for (const l of L) {
    if (fastOnly && !isFast(l)) continue;
    const { p } = priceOf(l);
    if (hideUnknown && p == null) continue;
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [l.lo, l.la] },
      properties: { i: l.i, c: colourOf(p), known: p == null ? 0 : 1, label: p == null ? "" : p === 0 ? T().free : money(p) } });
  }
  return { type: "FeatureCollection", features };
}

function addLayers() {
  map.addSource("chargers", { type: "geojson", data: geojson() });
  map.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "chargers", type: "circle", source: "chargers",
    paint: {
      "circle-color": ["get", "c"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 10, 5, 14, 8],
      "circle-stroke-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 1.5],
      "circle-sort-key": ["get", "known"],
    } });
  map.addLayer({ id: "selected", type: "circle", source: "chargers", filter: ["==", ["get", "i"], -1],
    paint: { "circle-color": ["get", "c"], "circle-radius": 13, "circle-stroke-color": "#0f172a", "circle-stroke-width": 3 } });
  map.addLayer({ id: "labels", type: "symbol", source: "chargers", minzoom: 12.5, filter: ["==", ["get", "known"], 1],
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12,
      "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": false },
    paint: { "text-color": "#0f172a", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
  map.addLayer({ id: "me", type: "circle", source: "me",
    paint: { "circle-color": "#2563eb", "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
  map.on("click", "chargers", e => select(e.features[0].properties.i, false));
  map.on("mouseenter", "chargers", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "chargers", () => map.getCanvas().style.cursor = "");
}
function refreshMap() { const s = map.getSource("chargers"); if (s) s.setData(geojson()); highlight(); }
function highlight() { if (map.getLayer("selected")) map.setFilter("selected", ["==", ["get", "i"], selected ?? -1]); }

// ---------- station detail ----------
function select(i, fly = true) {
  selected = i; highlight();
  const l = L[i], t = T(), kwh = +$("kwh").value;
  const { p, o } = priceOf(l);
  const priced = l.offers.filter(x => x.m != null).length;
  const total = p == null ? t.noPriceLong : p === 0 ? t.freeToCharge : t.forKwh(money(p * kwh), kwh, Math.round(kwh * KM_PER_KWH));
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
      <button class="go" id="dNav">🧭 ${t.navigate}</button>
      <button class="secondary" id="dClose">${t.close}</button>
    </div>
    ${l.offers.length > 1 ? `<div class="inf">ℹ️ ${t.manyCompanies(l.offers.length, priced)}</div>` : ""}
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

// ---------- Best Charge ----------
function bestCharge() {
  const t = T(), kwh = +$("kwh").value;
  const city = CITIES.find(c => c.id === $("city").value);
  const origin = userPos || city.c;
  const where = userPos ? t.nearYou : t.nearCity(lang === "lt" ? city.lt : city.en);
  const pool = L.filter(l => !fastOnly || isFast(l)).map(l => ({ l, d: km(origin[0], origin[1], l.la, l.lo), ...priceOf(l) }))
    .filter(x => x.d <= RADIUS_KM && x.p != null);
  // free spots are usually for customers or residents only, so they're mentioned but not recommended
  const freeN = pool.filter(x => x.p === 0).length, paid = pool.filter(x => x.p > 0);
  if (!paid.length) { $("results").innerHTML = `<div class="note">${t.noneNear(RADIUS_KM)}</div>`; return; }
  const avg = paid.reduce((a, x) => a + x.p, 0) / paid.length;
  paid.sort((a, b) => (a.p + a.d * DETOUR_EUR_PER_KM) - (b.p + b.d * DETOUR_EUR_PER_KM));
  const top = [];
  for (const x of paid) { if (top.every(y => km(y.l.la, y.l.lo, x.l.la, x.l.lo) > 0.5)) top.push(x); if (top.length === 3) break; }
  $("results").innerHTML = `<div class="res-head">${t.resultsNear(where)}</div>` + top.map(x => {
    const saving = (avg - x.p) * kwh;
    return `<div class="pick" data-i="${x.l.i}">
      <div class="amt" style="color:${colourOf(x.p)}">${money(x.p * kwh)}</div>
      <div class="meta"><b>${x.o.op}</b> · ${townOf(x.l)} · ${x.d.toFixed(1)} km<br>${kwhPrice(x.p)} · ${t.upTo} ${x.l.kw} kW${x.o.pk || x.o.fx ? " · " + t.extraFees : ""}
        ${saving > 0.25 ? `<br><span class="save">${t.save(money(saving))}</span>` : ""}</div>
      <button class="nav-mini" data-nav="${x.l.i}" aria-label="${t.navigate}">🧭</button>
    </div>`;
  }).join("") + `<div class="note">${t.avgNote(money(avg), paid.length, RADIUS_KM, freeN)}</div>`;
  $("results").querySelectorAll(".pick").forEach(el => el.addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { e.stopPropagation(); navigate(L[+nav.dataset.nav]); } else select(+el.dataset.i);
  }));
  const b = new maplibregl.LngLatBounds([origin[1], origin[0]], [origin[1], origin[0]]);
  top.forEach(x => b.extend([x.l.lo, x.l.la]));
  map.fitBounds(b, { padding: { top: 140, bottom: window.innerWidth < 760 ? window.innerHeight * 0.55 : 60, left: window.innerWidth < 760 ? 40 : 440, right: 40 }, maxZoom: 14 });
}

function locate() {
  if (!navigator.geolocation) { toast(T().locFailed); return; }
  toast(T().locating, 8000);
  navigator.geolocation.getCurrentPosition(pos => {
    $("toast").hidden = true;
    userPos = [pos.coords.latitude, pos.coords.longitude];
    map.getSource("me")?.setData({ type: "Feature", geometry: { type: "Point", coordinates: [userPos[1], userPos[0]] }, properties: {} });
    bestCharge();
  }, () => toast(T().locFailed), { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}

// ---------- UI wiring ----------
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach(el => el.textContent = T()[el.dataset.t]);
  $("langBtn").textContent = lang === "lt" ? "EN" : "LT";
  $("city").innerHTML = CITIES.map(c => `<option value="${c.id}">${T().cityPrefix} ${lang === "lt" ? c.lt : c.en}</option>`).join("");
  $("city").value = store.get("city", "vilnius");
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
$("nearBtn").onclick = locate;
$("city").onchange = () => { userPos = null; map.getSource("me")?.setData({ type: "FeatureCollection", features: [] }); store.set("city", $("city").value); if ($("results").innerHTML) bestCharge(); };
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
map.on("load", () => dataReady.then(addLayers));
