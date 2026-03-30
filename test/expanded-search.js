/**
 * expanded-search.js
 *
 * Integration test that validates the "search farther out" behaviour introduced
 * to replace the "No sunny spots found" dead-end.
 *
 * Mock scenario (Today = day index 0):
 *   All 18 main cities → overcast (code 3)  – not in CITY_CODES so they
 *   get the default [3, 3] treatment from buildMockWeather().
 *   All 18 fallback cities → overcast (code 3)  – same reason.
 *   Three expanded cities → sunny:
 *     Victoria BC    (48.4284, -123.3656)  ~74 mi  → code 0 (Clear Sky)
 *     Aberdeen WA    (46.9759, -123.8157)  ~81 mi  → code 1 (Mainly Clear)
 *     Ocean Shores WA (47.0043, -124.1557) ~94 mi  → code 1 (Mainly Clear)
 *
 * Expected result:
 *   Top 3 panel shows those three cities (not "No sunny spots found").
 *
 * Run:  node test/expanded-search.js
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

// 1×1 dark-grey PNG placeholder for map tiles
const TILE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TILE_PNG_BUF = Buffer.from(TILE_PNG_BASE64, 'base64');

// ---------------------------------------------------------------------------
// Mock weather data
// Only the three expanded cities are listed here; every other city will
// receive the default [3, 3] (overcast) codes.
// ---------------------------------------------------------------------------
const CITY_CODES = {
  '48.4284:-123.3656': [0, 0],   // Victoria BC  – clear sky
  '46.9759:-123.8157': [1, 0],   // Aberdeen WA  – mainly clear
  '47.0043:-124.1557': [1, 0],   // Ocean Shores WA – mainly clear
};

function latLonKey(url) {
  const lat = parseFloat(new URL(url).searchParams.get('latitude'));
  const lon = parseFloat(new URL(url).searchParams.get('longitude'));
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
  const base = new Date('2026-03-28');

  for (let i = 0; i < forecastDays; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
    weatherCodes.push(i === 0 ? code0 : code1);
    maxTemps.push(55);
    minTemps.push(40);
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
    current: { time: dates[0] + 'T12:00', interval: 900, temperature_2m: 50, weather_code: code0 },
    daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°F', temperature_2m_min: '°F' },
    daily: {
      time: dates,
      weather_code: weatherCodes,
      temperature_2m_max: maxTemps,
      temperature_2m_min: minTemps,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const leafletJs  = fs.readFileSync(path.join(VENDOR_DIR, 'leaflet.js'),  'utf8');
  const leafletCss = fs.readFileSync(path.join(VENDOR_DIR, 'leaflet.css'), 'utf8');

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: leafletJs })
  );
  await page.route('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', route =>
    route.fulfill({ status: 200, contentType: 'text/css', body: leafletCss })
  );
  await page.route(/leaflet.*\.(png|svg)/, route => {
    const imgPath = path.join(VENDOR_DIR, 'images', path.basename(route.request().url().split('?')[0]));
    route.fulfill({
      status: 200, contentType: 'image/png',
      body: fs.existsSync(imgPath) ? fs.readFileSync(imgPath) : TILE_PNG_BUF,
    });
  });
  await page.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG_BUF })
  );
  await page.route(/api\.open-meteo\.com/, route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildMockWeather(route.request().url())),
    });
  });

  await page.goto('file://' + INDEX_HTML);

  // Wait for the panel to finish searching (no "Loading" or "Searching")
  await page.waitForFunction(() => {
    const el = document.getElementById('top3Content');
    if (!el) return false;
    const text = el.textContent || '';
    return (
      !text.includes('Loading') &&
      !text.includes('Searching') &&
      text.trim().length > 0
    );
  }, { timeout: 60000 });

  const panelText = await page.$eval('#top3Content', el => el.innerText);
  console.log('\nTop 3 panel content:\n' + panelText);

  // Assertions
  let passed = true;

  if (panelText.includes('No sunny spots found')) {
    console.error('FAIL: panel still shows "No sunny spots found" – expanded search did not trigger');
    passed = false;
  } else {
    console.log('PASS: panel does not show "No sunny spots found"');
  }

  const expectedCities = ['Victoria BC', 'Aberdeen WA', 'Ocean Shores WA'];
  for (const city of expectedCities) {
    if (panelText.includes(city)) {
      console.log(`PASS: panel contains "${city}"`);
    } else {
      console.error(`FAIL: panel is missing "${city}"`);
      passed = false;
    }
  }

  await browser.close();

  if (!passed) {
    process.exit(1);
  }
  console.log('\nAll assertions passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
