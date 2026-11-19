# Įkrovimo kainos – EV charging price map (MVP)

A mobile-first website that shows electric-car charging prices across Lithuania and finds the cheapest charger nearby.

- Map: [MapLibre GL JS](https://maplibre.org) with free [OpenFreeMap](https://openfreemap.org) tiles (no API key)
- Data: Lithuania's national charging database, published as open data by [AB Via Lietuva](https://ev.vialietuva.lt/en/data-provision) (CC BY 4.0)
- Map view: 3D globe (spin, tilt and rotate with two fingers)
- Ranking: total cost = charge + trip there and back (electricity, car wear, your time), from your location, a saved home or a city
- Navigation: hands off to Google Maps, Waze or Apple Maps
- Car picker: connectors, charging speed and consumption from [Open EV Data](https://github.com/KilowattApp/open-ev-data) (MIT with attribution; licence in `data/OPEN-EV-DATA-LICENSE`)
- Optional sign-in with Google or Apple through Firebase Auth (off until configured)
- Languages: Lithuanian and English
- No backend, no accounts, no cookies: it's a static site

## How it works

| File | What it does |
|---|---|
| `index.html`, `style.css`, `app.js`, `i18n.js` | The website |
| `data/lt.json` | Charging locations and prices, built from Via Lietuva's data |
| `scripts/build_data.py` | Downloads Via Lietuva's DATEX II file and builds `data/lt.json` |
| `.github/workflows/update-data.yml` | Runs the build every 30 minutes and commits changes |
| `manifest.webmanifest`, `assets/` | Lets people add the site to their phone's home screen |

## Publish it (free, GitHub Pages)

1. Push this folder to a GitHub repository.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions** so the data job can commit.
4. **Actions → Update charging data → Run workflow** once to check it works.
5. The site appears at `https://<your-user>.github.io/<repository>/` after a minute or two.

A custom domain (for example a `.lt` name) can be added later under **Settings → Pages → Custom domain**.

## Turn on sign-in (Google / Apple)

1. Create a free project at [console.firebase.google.com](https://console.firebase.google.com) and add a **Web app**. Copy its config object.
2. **Authentication → Sign-in method**: enable **Google**. For **Apple**, a paid Apple Developer account is needed.
3. **Authentication → Settings → Authorized domains**: add `andziemelis.github.io` (and your own domain later).
4. Paste the config into `FIREBASE_CONFIG` at the top of `app.js`. The sign-in buttons then appear on the welcome screen.

Sign-in is optional: people can always continue without an account.

## Update the car list

```bash
python scripts/build_cars.py path/to/open-ev-data/data/ev-data.json
```

## Update the data by hand

```bash
python scripts/build_data.py              # download the latest data
python scripts/build_data.py file.xml     # or use a file you saved
```

Requires Python 3.9+ and no extra packages.

## Known limits

- The data has no station names, so locations are described by the nearest town.
- Where a location lists several tariffs, the lowest is shown; the real price depends on charger, payment method or membership.
- Public and semi-public chargers are mixed in the data, so some cheap or free spots may be customer-only.
- Live availability will be added when Via Lietuva's live status feed is back online.
- OpenFreeMap is a free public service with no guarantees. If it ever changes, switch `MAP_STYLE` in `app.js` to another MapLibre style (for example MapTiler).

## Credits

Charging data © AB Via Lietuva, CC BY 4.0 (grouped by location, prices simplified). Map data © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles.
