/**
 * screenshot.js
 *
 * Uses Playwright with fully mocked network responses to render
 * index.html (including the Leaflet map and Top 3 Closest Sunny Spots panel)
 * in a headless Chromium browser and save a screenshot.
 *
 * Run:  node test/screenshot.js
 *
 * How the mocking works
 * ---------------------
 * 1. Leaflet CDN (CSS + JS)  → served from test/vendor/  (pre-downloaded via npm)
 * 2. CartoDB dark map tiles  → returns a 1×1 dark PNG so tiles render instantly
 * 3. Open-Meteo forecast API → returns deterministic mock JSON per city so we can
 *    control exactly which spots show as "sunny" vs "rainy"
 *
 * Mock scenario (Today = day index 0):
 *   Sunny (code 0 / 1 / 2):  Leavenworth, North Bend WA, Vantage, Mazama, Spokane
 *   Rainy / cloudy:          all other main cities
 * → Top 3 panel should show: North Bend WA (~27 mi), Leavenworth (~78 mi), Vantage (~119 mi)
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');
const VENDOR_DIR = path.join(__dirname, 'vendor');
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'screenshots');
const OUTPUT_FILE = path.join(SCREENSHOTS_DIR, 'preview.png');

// 1×1 dark-grey PNG (base64) — used as a placeholder for all map tiles
const TILE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TILE_PNG_BUF = Buffer.from(TILE_PNG_BASE64, 'base64');

// ---------------------------------------------------------------------------
// Mock weather data factory
// Returns an Open-Meteo-shaped response for the given city config.
// ---------------------------------------------------------------------------
// City-level weather code assignments for the mock scenario (day 0 = Today).
// Using real WMO codes:  0=Clear, 1=Mainly Clear, 2=Partly Cloudy, 3=Overcast,
//                        61=Rain, 63=Rain, 80=Showers
const CITY_CODES = {
  // coord key -> [day0code, day1code]  (lat:lon rounded to 4dp)
  '47.6062:-122.3321': [61, 3],   // Seattle - rainy
  '48.7519:-122.4787': [63, 2],   // Bellingham - rain
  '49.2827:-123.1207': [80, 3],   // Vancouver BC - showers
  '46.9454:-119.9869': [2, 0],    // Vantage - partly cloudy → sunny tmw
  '47.6588:-117.426':  [1, 0],    // Spokane - mainly clear
  '45.5152:-122.6784': [61, 61],  // Portland - rain
  '44.0582:-121.3153': [0, 0],    // Bend - clear sky
  '47.4957:-121.7868': [2, 1],    // North Bend WA - partly cloudy
  '47.4281:-121.4116': [63, 63],  // Snoqualmie Pass - rain
  '46.56:-121.29':     [80, 3],   // Crystal Mountain - showers
  '47.745:-121.09':    [3, 2],    // Stevens Pass - overcast
  '48.5918:-120.4043': [1, 1],    // Mazama - mainly clear
  '47.5962:-120.6615': [0, 0],    // Leavenworth - clear
  '46.0646:-118.343':  [3, 0],    // Walla Walla - overcast
  '47.0379:-122.9007': [61, 3],   // Olympia - rain
  '47.2529:-122.4443': [63, 61],  // Tacoma - rain
  '44.0521:-123.0868': [80, 80],  // Eugene - showers
  '47.9692:-123.4986': [3, 2],    // Hurricane Ridge - overcast
};

function latLonKey(url) {
  const lat = parseFloat(new URL(url).searchParams.get('latitude'));
  const lon = parseFloat(new URL(url).searchParams.get('longitude'));
  // Try exact first, then rounded to 4dp
  const exact = `${lat}:${lon}`;
  if (CITY_CODES[exact]) return exact;
  const r4 = `${parseFloat(lat.toFixed(4))}:${parseFloat(lon.toFixed(4))}`;
  return r4;
}

function buildMockWeather(url) {
  const key = latLonKey(url);
  const [code0 = 3, code1 = 3] = CITY_CODES[key] || [];
  const forecastDays = parseInt(new URL(url).searchParams.get('forecast_days') || '2');

  const dates = [];
  const weatherCodes = [];
  const maxTemps = [];
  const minTemps = [];
  const hourlyTimes = [];
  const hourlyCodes = [];
  const base = new Date('2026-03-28');

  for (let i = 0; i < forecastDays; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    dates.push(dateStr);
    const dayCode = i === 0 ? code0 : i === 1 ? code1 : code1;
    weatherCodes.push(dayCode);
    maxTemps.push(55 + Math.round(Math.random() * 15));
    minTemps.push(38 + Math.round(Math.random() * 10));

    // Generate 24 hourly entries per day, all matching the daily code
    for (let h = 0; h < 24; h++) {
      hourlyTimes.push(`${dateStr}T${String(h).padStart(2, '0')}:00`);
      hourlyCodes.push(dayCode);
    }
  }

  return {
    latitude: parseFloat(new URL(url).searchParams.get('latitude')),
    longitude: parseFloat(new URL(url).searchParams.get('longitude')),
    generationtime_ms: 0.1,
    utc_offset_seconds: -25200,
    timezone: 'America/Los_Angeles',
    timezone_abbreviation: 'PDT',
    elevation: 50,
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°F', weather_code: 'wmo code' },
    current: { time: dates[0] + 'T12:00', interval: 900, temperature_2m: maxTemps[0] - 5, weather_code: code0 },
    daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°F', temperature_2m_min: '°F' },
    daily: {
      time: dates,
      weather_code: weatherCodes,
      temperature_2m_max: maxTemps,
      temperature_2m_min: minTemps,
    },
    hourly_units: { time: 'iso8601', weather_code: 'wmo code' },
    hourly: {
      time: hourlyTimes,
      weather_code: hourlyCodes,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const leafletJs = fs.readFileSync(path.join(VENDOR_DIR, 'leaflet.js'), 'utf8');
  const leafletCss = fs.readFileSync(path.join(VENDOR_DIR, 'leaflet.css'), 'utf8');

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---- Route: Leaflet JS from CDN ----------------------------------------
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs })
  );

  // ---- Route: Leaflet CSS from CDN ----------------------------------------
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss })
  );

  // ---- Route: Leaflet marker images (loaded by the CSS) -------------------
  await page.route(/leaflet.*\.(png|svg)/, route => {
    const imgPath = path.join(VENDOR_DIR, 'images', path.basename(route.request().url().split('?')[0]));
    if (fs.existsSync(imgPath)) {
      route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(imgPath) });
    } else {
      route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG_BUF });
    }
  });

  // ---- Route: CartoDB / OpenStreetMap map tiles ---------------------------
  await page.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG_BUF })
  );

  // ---- Route: Open-Meteo weather API --------------------------------------
  await page.route(/api\.open-meteo\.com/, route => {
    const mockData = buildMockWeather(route.request().url());
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData),
    });
  });

  // ---- Load index.html via file:// ----------------------------------------
  await page.goto('file://' + INDEX_HTML);

  // Wait for the Top 3 panel content to be populated (not "Loading..." or "Searching...")
  await page.waitForFunction(() => {
    const el = document.getElementById('top3Content');
    if (!el) return false;
    const text = el.textContent || '';
    return !text.includes('Loading') && !text.includes('Searching') && text.trim().length > 0;
  }, { timeout: 15000 });

  // Extra pause to let tile rendering settle
  await page.waitForTimeout(800);

  // ---- Take screenshot ----------------------------------------------------
  await page.screenshot({ path: OUTPUT_FILE, fullPage: false });
  console.log('Screenshot saved to', OUTPUT_FILE);

  // Print Top 3 panel text for quick verification
  const panelText = await page.$eval('#top3Content', el => el.innerText);
  console.log('\nTop 3 panel content:\n' + panelText);

  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
