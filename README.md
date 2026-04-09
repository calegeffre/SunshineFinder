# SunshineFinder ☀️

Need a little sun? SunshineFinder is an interactive weather map for the Pacific Northwest that shows you the **3 closest sunny spots** to Seattle right now — and for the next few days.

![SunshineFinder preview](https://github.com/user-attachments/assets/c00c158b-fa70-4fde-8f2b-9954866e29cc)

## What it does

- 🗺️ Displays 18+ cities across Washington, Oregon, Idaho, and British Columbia on an interactive map
- ☀️ Fetches live weather from the [Open-Meteo API](https://open-meteo.com/) and shows current conditions with emoji indicators
- 📅 Lets you browse a 4-day forecast (Today, Tomorrow, and the next two days) via day tabs
- 🎯 Ranks the nearest sunny cities and surfaces the **Top 3 Closest Sunny Spots** panel
- 🔄 Auto-refreshes every 15 minutes so the data stays current

## Open source libraries

SunshineFinder is built on top of these great open source projects:

| Library | Version | What we use it for |
|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | Interactive map rendering and city markers |
| [Open-Meteo API](https://open-meteo.com/) | — | Free, no-auth weather forecast data (WMO weather codes, temperature) |
| [CARTO](https://carto.com/) / [OpenStreetMap](https://www.openstreetmap.org/) | — | Dark basemap tiles displayed inside the Leaflet map |
| [Playwright](https://playwright.dev/) | ^1.58.2 | Headless browser automation used to generate the screenshot above |

## Generating screenshots with Playwright

The `screenshots/preview.png` image in this README is produced automatically by `test/screenshot.js` using [Playwright](https://playwright.dev/).

**How it works:**

1. Playwright launches a headless Chromium browser and loads `index.html`.
2. All external network requests are intercepted and replaced with deterministic mock data so the screenshot is fast and reproducible:
   - The Leaflet CDN (JS + CSS) is served from locally vendored copies in `test/vendor/`.
   - CartoDB map tiles are replaced with a 1×1 dark-grey PNG placeholder so tiles render instantly without network calls.
   - Open-Meteo API calls return hardcoded weather codes, making specific cities appear sunny or rainy in a predictable way.
3. The script waits until the **Top 3 Closest Sunny Spots** panel is fully populated, then captures a 1280×800 viewport screenshot.

**Regenerate the screenshot at any time:**

```bash
npm run screenshot
```

## Security review

A security advisory check was performed against the [GitHub Advisory Database](https://github.com/advisories) for all direct dependencies:

| Package | Version | Vulnerabilities found |
|---|---|---|
| `playwright` | ^1.58.2 | ✅ None |
| `leaflet` (vendored) | 1.9.4 | ✅ None |

**Additional notes:**

- **Open-Meteo API** — requests are read-only `GET` calls to a public, unauthenticated endpoint. No credentials are stored or transmitted.
- **CARTO / OpenStreetMap tiles** — tile URLs are composed of standard `{z}/{x}/{y}` slippy-map coordinates. No user data is sent in tile requests.
- **Leaflet is vendored** (`test/vendor/leaflet.js`) rather than loaded live from a CDN in the test environment, which eliminates supply-chain risk during screenshot generation.
- The app itself is a fully client-side, single HTML file with no backend and no user authentication, which keeps the attack surface minimal.

## License

[MIT](LICENSE)
