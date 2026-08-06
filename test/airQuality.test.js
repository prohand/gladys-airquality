// -----------------------------------------------------------------------------
// The provider layer: the Open-Meteo call and the registry above it.
//
// `globalThis.fetch` is stubbed in every test — nothing here touches the
// network. The provider keeps a module-level TTL cache, so `clearAirQualityCache()`
// runs before each test that counts requests.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { allPollutants, findProvider, PROVIDERS, readAirQuality } from '../src/airQuality/index.js';
import {
  clearAirQualityCache,
  OPEN_METEO_VARIABLES,
  openMeteoProvider,
} from '../src/airQuality/openMeteo.js';
import { INDEX_LEVELS, POLLUTANTS } from '../src/airQuality/scale.js';

const NANTES = { latitude: 47.2184, longitude: -1.5536 };

const realFetch = globalThis.fetch;
let requestedUrls = [];

/** Answer every request with one canned Open-Meteo body. */
function stubFetch(body, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok,
      status,
      json: async () => body,
    };
  };
}

beforeEach(() => {
  requestedUrls = [];
  clearAirQualityCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('the provider maps every graded pollutant onto an Open-Meteo variable', () => {
  // A pollutant the scale grades but nobody fetches would silently never hold a
  // value; one fetched but not graded would publish a raw number with no class.
  assert.deepEqual(Object.keys(OPEN_METEO_VARIABLES).sort(), [...POLLUTANTS].sort());
});

test('the requested URL carries the point and every variable', async () => {
  stubFetch({ current: { time: '2026-08-06T12:00' } });
  await openMeteoProvider.fetchConcentrations(NANTES);

  const [url] = requestedUrls;
  assert.match(url, /latitude=47\.2184/);
  assert.match(url, /longitude=-1\.5536/);
  for (const variable of Object.values(OPEN_METEO_VARIABLES)) {
    assert.ok(decodeURIComponent(url).includes(variable), `${variable} is not requested`);
  }
});

test('a pollutant the answer omits stays null instead of becoming 0', async () => {
  // Number(null) is 0, a perfectly clean sky: the one bug this guards against.
  stubFetch({ current: { time: '2026-08-06T12:00', pm2_5: 12.5, ozone: null } });
  const { concentrations, measuredAt } = await openMeteoProvider.fetchConcentrations(NANTES);

  assert.equal(concentrations.pm2_5, 12.5);
  assert.equal(concentrations.ozone, null);
  assert.equal(concentrations.pm10, null, 'an absent key must not become a number');
  assert.equal(measuredAt, '2026-08-06T12:00');
});

test('an HTTP failure is propagated, not swallowed into empty data', async () => {
  stubFetch({}, { ok: false, status: 503 });
  await assert.rejects(() => openMeteoProvider.fetchConcentrations(NANTES), /503/);
});

test('an API-level error object is an error too', async () => {
  stubFetch({ error: true, reason: 'Latitude must be in range of -90 to 90°.' });
  await assert.rejects(() => openMeteoProvider.fetchConcentrations(NANTES), /Latitude must be/);
});

test('a second read of the same point is served from the cache', async () => {
  stubFetch({ current: { time: '2026-08-06T12:00', pm10: 18 } });
  await openMeteoProvider.fetchConcentrations(NANTES);
  await openMeteoProvider.fetchConcentrations(NANTES);
  assert.equal(requestedUrls.length, 1);
});

test('coverage stops at the edge of the CAMS European domain', () => {
  assert.ok(openMeteoProvider.supports(NANTES));
  assert.ok(!openMeteoProvider.supports({ latitude: -33.86, longitude: 151.2 }), 'Sydney');
  assert.ok(!openMeteoProvider.supports({ latitude: 40.71, longitude: -74.0 }), 'New York');
});

test('the registry finds a provider for a European point and none elsewhere', () => {
  assert.equal(findProvider(NANTES), openMeteoProvider);
  assert.equal(findProvider({ latitude: -33.86, longitude: 151.2 }), undefined);
});

test('the pollutants of every registered provider are graded by the scale', () => {
  for (const provider of PROVIDERS) {
    for (const pollutant of provider.pollutants) {
      assert.ok(
        POLLUTANTS.includes(pollutant),
        `${provider.key} reports "${pollutant}", which the scale cannot grade`,
      );
    }
  }
  assert.deepEqual(allPollutants(), POLLUTANTS);
});

test('reading a point grades every concentration and picks the worst', async () => {
  stubFetch({
    current: {
      time: '2026-08-06T12:00',
      pm2_5: 5, // good
      pm10: 45, // moderate
      nitrogen_dioxide: 15, // good
      ozone: 250, // very poor
      sulphur_dioxide: 3, // good
    },
  });

  const reading = await readAirQuality(NANTES);

  assert.equal(reading.provider, openMeteoProvider.key);
  assert.equal(reading.subIndexes.pm10, INDEX_LEVELS.MODERATE);
  assert.equal(reading.subIndexes.ozone, INDEX_LEVELS.VERY_POOR);
  assert.deepEqual(reading.overall, { level: INDEX_LEVELS.VERY_POOR, pollutant: 'ozone' });
  assert.equal(reading.measuredAt, '2026-08-06T12:00');
});

test('reading an uncovered point says so instead of returning nothing', async () => {
  await assert.rejects(
    () => readAirQuality({ latitude: -33.86, longitude: 151.2 }),
    /No air quality provider covers/,
  );
});
