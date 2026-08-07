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
  openMeteoEuropeProvider,
  openMeteoGlobalProvider,
} from '../src/airQuality/openMeteo.js';
import { INDEX_LEVELS, POLLUTANTS } from '../src/airQuality/scale.js';

const NANTES = { latitude: 47.2184, longitude: -1.5536 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };

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

test('the requested URL carries the point, every variable and the domain', async () => {
  stubFetch({ current: { time: '2026-08-06T12:00' } });
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);

  const [url] = requestedUrls;
  assert.match(url, /latitude=47\.2184/);
  assert.match(url, /longitude=-1\.5536/);
  // The domain is asked for EXPLICITLY: `auto` blends two models that are not
  // coupled, and a series that switches between them is two datasets in one.
  assert.match(url, /domains=cams_europe/);
  for (const variable of Object.values(OPEN_METEO_VARIABLES)) {
    assert.ok(decodeURIComponent(url).includes(variable), `${variable} is not requested`);
  }
});

test('the global provider reads the global model, not the European one', async () => {
  stubFetch({ current: { time: '2026-08-06T12:00', pm2_5: 8 } });
  await openMeteoGlobalProvider.fetchConcentrations(SYDNEY);

  const [url] = requestedUrls;
  assert.match(url, /latitude=-33\.8688/);
  assert.match(url, /domains=cams_global/);
});

test('a pollutant the answer omits stays null instead of becoming 0', async () => {
  // Number(null) is 0, a perfectly clean sky: the one bug this guards against.
  stubFetch({ current: { time: '2026-08-06T12:00', pm2_5: 12.5, ozone: null } });
  const { concentrations, measuredAt } = await openMeteoEuropeProvider.fetchConcentrations(NANTES);

  assert.equal(concentrations.pm2_5, 12.5);
  assert.equal(concentrations.ozone, null);
  assert.equal(concentrations.pm10, null, 'an absent key must not become a number');
  assert.equal(measuredAt, '2026-08-06T12:00');
});

test('an HTTP failure is propagated, not swallowed into empty data', async () => {
  stubFetch({}, { ok: false, status: 503 });
  await assert.rejects(() => openMeteoEuropeProvider.fetchConcentrations(NANTES), /503/);
});

test('an API-level error object is an error too', async () => {
  stubFetch({ error: true, reason: 'Latitude must be in range of -90 to 90°.' });
  await assert.rejects(
    () => openMeteoEuropeProvider.fetchConcentrations(NANTES),
    /Latitude must be/,
  );
});

test('a second read of the same point is served from the cache', async () => {
  stubFetch({ current: { time: '2026-08-06T12:00', pm10: 18 } });
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  assert.equal(requestedUrls.length, 1);
});

test('the cache never serves one model answer for the other', async () => {
  // The two domains are not coupled: the same point read on both is two
  // different answers, so the domain has to be part of the cache key.
  stubFetch({ current: { time: '2026-08-06T12:00', pm10: 18 } });
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  await openMeteoGlobalProvider.fetchConcentrations(NANTES);
  assert.equal(requestedUrls.length, 2);
});

test('the European provider stops at the edge of the CAMS European domain', () => {
  assert.ok(openMeteoEuropeProvider.supports(NANTES));
  assert.ok(!openMeteoEuropeProvider.supports(SYDNEY));
  assert.ok(!openMeteoEuropeProvider.supports(NEW_YORK));
});

test('the global provider covers every point on Earth, and only points', () => {
  for (const point of [NANTES, SYDNEY, NEW_YORK, { latitude: -89.9, longitude: 179.9 }]) {
    assert.ok(openMeteoGlobalProvider.supports(point), JSON.stringify(point));
  }
  // What is left to refuse: something that is not a point at all.
  assert.ok(!openMeteoGlobalProvider.supports({ latitude: 300, longitude: 2 }));
  assert.ok(!openMeteoGlobalProvider.supports({ latitude: null, longitude: 2 }));
  assert.ok(!openMeteoGlobalProvider.supports({}));
});

test('a European point is read on the finer model, everywhere else on the global one', () => {
  // The order of PROVIDERS is the whole routing logic: first match wins.
  assert.equal(findProvider(NANTES), openMeteoEuropeProvider);
  assert.equal(findProvider(SYDNEY), openMeteoGlobalProvider);
  assert.equal(findProvider(NEW_YORK), openMeteoGlobalProvider);
  assert.equal(findProvider({ latitude: 300, longitude: 2 }), undefined);
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

  assert.equal(reading.provider, openMeteoEuropeProvider.key);
  assert.equal(reading.subIndexes.pm10, INDEX_LEVELS.MODERATE);
  assert.equal(reading.subIndexes.ozone, INDEX_LEVELS.VERY_POOR);
  assert.deepEqual(reading.overall, { level: INDEX_LEVELS.VERY_POOR, pollutant: 'ozone' });
  assert.equal(reading.measuredAt, '2026-08-06T12:00');
});

test('a point outside Europe is graded on the same scale, by the global model', async () => {
  stubFetch({
    current: {
      time: '2026-08-06T12:00',
      pm2_5: 30, // poor on the European bands
      pm10: 20,
      nitrogen_dioxide: 10,
      ozone: 40,
      sulphur_dioxide: 5,
    },
  });

  const reading = await readAirQuality(SYDNEY);

  assert.equal(reading.provider, openMeteoGlobalProvider.key);
  assert.deepEqual(reading.overall, { level: INDEX_LEVELS.POOR, pollutant: 'pm2_5' });
  assert.match(requestedUrls[0], /domains=cams_global/);
});

test('reading something that is not a point says so instead of returning nothing', async () => {
  await assert.rejects(
    () => readAirQuality({ latitude: 300, longitude: 151.2 }),
    /No air quality provider covers/,
  );
});
