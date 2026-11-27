# Security checklist

Status of the 20-point checklist for Įkrovimo kainos. Updated 2026-11-27.

Today the app is a **static website**: no server, no database, no accounts, no payments, no file uploads. All user settings stay in the browser on the user's device. Many items below therefore have nothing to protect yet. They are marked **Later**, with what to do when that part of the app is built.

Status key: **Done** = in place now. **N/A now** = the thing does not exist in the app yet. **Later** = must be done when sign-in, a database or payments are added.

## 01 · Injection & input

| # | Item | Status | How |
|---|------|--------|-----|
| 1 | SQL injection | N/A now | No database. **Later:** only use the database SDK's parameterised queries (Firestore has no SQL; with Postgres/Supabase never build queries from strings). |
| 2 | XSS | Done | Every outside value (operator names, tariffs, car names, place search results) is escaped before it is shown (`esc()` in app.js). A Content-Security-Policy in every page blocks scripts from anywhere but this site. Pay links must be `https://`. The data builder strips `<`, `>` and control characters from the feed. |
| 3 | CSRF | N/A now | No logins, cookies or forms that change anything; the CSP sets `form-action 'none'`. **Later:** session cookies `SameSite=Lax` (or Strict) + `Secure` + `HttpOnly`, and a CSRF token or Firebase ID token on every request that changes data. |
| 4 | File uploads | N/A now | The app accepts no uploads. **Later:** check type and size on the server, store outside the web root with random names, never in a public bucket. |
| 5 | SSRF | Done | The only server-side fetch is the data bot, and it downloads one fixed address. It refuses anything that is not https on the same host after redirects, and anything over 60 MB. Python's XML parser does not load external entities. Users can never make the server fetch a URL. |

## 02 · Auth & access

| # | Item | Status | How |
|---|------|--------|-----|
| 6 | BOLA / IDOR | N/A now | No user records on a server. **Later:** every read/write checks that the record belongs to the signed-in user (see the rules in #11); never trust an ID sent by the app. |
| 7 | Rate limiting | Done (client) | Route planning is limited to 8 per minute, place search waits until the user stops typing, search boxes have length limits. **Later:** Firebase App Check plus server-side limits on sign-in, payment and any write endpoint. |
| 8 | Password hashing | N/A now | The app will not store passwords: sign-in is planned with Google / Apple through Firebase Auth, which handles this. If email+password is ever added, let Firebase Auth store it; never store passwords yourself. |
| 9 | MFA | Later | Owner: turn on two-factor login for the GitHub account (it controls the site) and, later, the Firebase, Stripe and Apple/Google developer accounts. Users signing in with Google or Apple get those accounts' MFA. |
| 10 | Server-side permissions | N/A now | **Later:** permissions are enforced in Firestore Security Rules / server code, never only by hiding buttons in the app. |
| 11 | RLS (Row Level Security) | Later | When the database is added, start from "deny everything" and allow each user only their own data. Firestore version of RLS: |

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /{doc=**} { allow read, write: if false; }            // deny by default
    match /users/{uid}/{rest=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 03 · Secrets & tokens

| # | Item | Status | How |
|---|------|--------|-----|
| 12 | JWT secret | N/A now | No tokens are made by this app. **Later:** Firebase Auth signs tokens; if you ever sign your own, keep the secret only on the server (GitHub Actions secrets / server environment), never in app code. |
| 13 | API keys | Done | No keys, passwords or tokens anywhere in the repo (checked). `.gitignore` blocks `.env`, key files and Firebase admin files from being committed. **Owner:** turn on secret scanning in GitHub (Settings → Code security). Note: Firebase's web `apiKey` is not a secret, but the Admin SDK key and Stripe secret key are, and must never be in the app. |
| 14 | No localStorage tokens | Done | localStorage holds only settings (car, home, language, filters) and the user can delete them in Settings. No login tokens. **Later (native app):** keep sign-in tokens in the iOS Keychain / Android Keystore; on the web, an HttpOnly cookie set by the server. |
| 15 | Default credentials | N/A now | No admin panel or accounts. **Later:** no default or shared admin passwords, every admin uses their own account with MFA. |

## 04 · Config & hygiene

| # | Item | Status | How |
|---|------|--------|-----|
| 16 | CORS policy | N/A now | There is no API. The site only serves public files (the charging data is open data anyway). **Later:** an API allows only the app's own origin, never `*` for anything that needs a login. |
| 17 | Webhook signatures | Later | No webhooks yet. **Later (Stripe):** verify every webhook with the `Stripe-Signature` header and the webhook secret, reject old timestamps, and handle each event ID only once. |
| 18 | Source maps | Done | No `.map` files are published and the map library's map references are removed. (Note: the repository itself is public, so the app's code can be read on GitHub.) |
| 19 | Clean production logs | Done | No `console.log` / `console.warn` in the app. The data bot logs only counts, never personal data. |
| 20 | Dependencies | Done | MapLibre updated to 5.24.1 (vendored in `vendor/`), the Inter font is vendored, the data bot uses only Python's standard library, and its GitHub Actions are pinned to exact commits. Dependabot (`.github/dependabot.yml`) opens a pull request when those actions have updates. **Owner:** every few months check MapLibre releases (github.com/maplibre/maplibre-gl-js/releases) and replace the files in `vendor/`. |

## Extra protections in place

- Content-Security-Policy on every page (scripts only from this site; network only to the map, place-search and route services).
- The app refuses to run inside another site's frame (clickjacking).
- Font and map library are hosted here, so visitors' IP addresses are not sent to Google or a CDN.
- The data bot refuses broken downloads (fewer than 500 stations), coordinates outside Lithuania and prices above 5 €/kWh.
- Users can delete all their data in **Account → Settings → Delete my data**.

## Owner to-do (GitHub settings I can't change from code)

1. Two-factor login on the GitHub account.
2. Settings → Pages → **Enforce HTTPS**.
3. Settings → Code security → **Dependabot alerts** and **Secret scanning** on.
4. Add your name and contact email in `legal/owner.js`.

## Reporting a problem

If you find a security issue, please report it privately to the contact email in the privacy policy rather than opening a public issue.
