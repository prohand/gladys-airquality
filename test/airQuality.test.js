// -----------------------------------------------------------------------------
// The provider layer: the Open-Meteo call and the registry above it.
//
// `globalThis.fetch` is stubbed in every test — nothing here touches the
// network. The provider keeps a module-level TTL cache, so `clearAirQualityCache()`
// runs before each test that counts requests.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  allPollutants,
  findProvider,
  prefetchAirQuality,
  PROVIDERS,
  readAirQuality,
} from '../src/airQuality/index.js';
import {
  clearAirQualityCache,
  OPEN_METEO_VARIABLES,
  openMeteoEuropeProvider,
  openMeteoGlobalProvider,
  parseRetryAfter,
} from '../src/airQuality/openMeteo.js';
import { INDEX_LEVELS, POLLUTANTS } from '../src/airQuality/scale.js';

const NANTES = { latitude: 47.2184, longitude: -1.5536 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };
const LYON = { latitude: 45.7679, longitude: 4.8343 };

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

/**
 * Answer every request with what `answer(url)` returns — a body, or
 * `{ status, headers }` for a failure — and record the URLs.
 */
function stubFetchWith(answer) {
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    const { status = 200, headers = {}, body = {} } = answer(decodeURIComponent(String(url)));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: async () => body,
    };
  };
}

/** Whether a (decoded) URL asks for several points at once. */
const isBatch = (url) => /latitude=[^&]*,/.test(decodeURIComponent(url));

/** The `current` answer of one point, its PM10 telling the points apart. */
function currentAt(pm10) {
  return { timezone_abbreviation: 'CEST', current: { time: '2026-08-06T12:00', pm10 } };
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

test('the reading carries the hour of the data and the zone it is written in', async () => {
  stubFetch({
    timezone_abbreviation: 'CEST',
    current: { time: '2026-08-06T12:00', pm10: 18 },
  });
  const reading = await openMeteoEuropeProvider.fetchConcentrations(NANTES);

  assert.equal(reading.measuredAt, '2026-08-06T12:00');
  assert.equal(reading.timeZone, 'CEST');
});

test('a source that names no timezone still reads', async () => {
  stubFetch({ current: { time: '2026-08-06T12:00', pm10: 18 } });
  const reading = await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  assert.equal(reading.timeZone, null);
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

// --- The cache: one request per point and per model, in flight included -----

test('reads of the same point made at the same time share ONE request', async () => {
  stubFetch(currentAt(18));
  const [first, second] = await Promise.all([
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
  ]);
  assert.equal(requestedUrls.length, 1, 'the second read waits for the request in flight');
  assert.deepEqual(first, second);
});

test('the curve is shared while in flight too, without touching the current hour', async () => {
  stubFetch({ hourly: { time: ['2026-08-06T12:00'], pm10: [18] } });
  await Promise.all([
    openMeteoEuropeProvider.fetchForecast(NANTES),
    openMeteoEuropeProvider.fetchForecast(NANTES),
  ]);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /hourly=/);
});

test('a failed request is not cached: the next read asks again', async () => {
  stubFetch({}, { ok: false, status: 503 });
  await assert.rejects(() => openMeteoEuropeProvider.fetchConcentrations(NANTES), /503/);

  stubFetch(currentAt(18));
  const reading = await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  assert.equal(reading.concentrations.pm10, 18);
  assert.equal(requestedUrls.length, 2);
});

test('an expired answer is read again rather than served', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-06T12:00:00Z') });
  stubFetch(currentAt(18));
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);

  t.mock.timers.tick(9 * 60 * 1000);
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  assert.equal(requestedUrls.length, 1, 'still fresh after 9 minutes');

  t.mock.timers.tick(2 * 60 * 1000);
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  assert.equal(requestedUrls.length, 2, 'expired after 11');
});

// --- Several points in one request -------------------------------------------

test('several points of one model are read in ONE request, and each gets its own answer', async () => {
  stubFetchWith(() => ({ body: [currentAt(11), currentAt(22)] }));
  openMeteoEuropeProvider.prefetchConcentrations([NANTES, LYON]);

  const nantes = await openMeteoEuropeProvider.fetchConcentrations(NANTES);
  const lyon = await openMeteoEuropeProvider.fetchConcentrations(LYON);

  assert.equal(requestedUrls.length, 1);
  const url = decodeURIComponent(requestedUrls[0]);
  assert.match(url, /latitude=47\.2184,45\.7679/);
  assert.match(url, /longitude=-1\.5536,4\.8343/);
  assert.match(url, /domains=cams_europe/);
  // By POSITION: the first answer is the first point asked.
  assert.equal(nantes.concentrations.pm10, 11);
  assert.equal(lyon.concentrations.pm10, 22);
  assert.equal(lyon.timeZone, 'CEST');
});

test('a point already cached is not asked again in a batch', async () => {
  stubFetch(currentAt(11));
  await openMeteoEuropeProvider.fetchConcentrations(NANTES);

  // Only Lyon is left: a lone point, read by the plain single-point request.
  stubFetch(currentAt(22));
  openMeteoEuropeProvider.prefetchConcentrations([NANTES, LYON]);
  const lyon = await openMeteoEuropeProvider.fetchConcentrations(LYON);

  assert.equal(requestedUrls.length, 2);
  assert.doesNotMatch(decodeURIComponent(requestedUrls[1]), /47\.2184/);
  assert.equal(lyon.concentrations.pm10, 22);
});

test('an answer that does not hold one entry per point falls back on one request per point', async () => {
  // Telling the points apart is done by position: a short answer would hand
  // one town the air of another, so it is not used — each point is asked alone.
  stubFetchWith((url) =>
    isBatch(url)
      ? { body: [currentAt(11)] }
      : { body: currentAt(url.includes('latitude=47.2184') ? 11 : 22) },
  );
  openMeteoEuropeProvider.prefetchConcentrations([NANTES, LYON]);

  const [nantes, lyon] = await Promise.all([
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
    openMeteoEuropeProvider.fetchConcentrations(LYON),
  ]);

  assert.equal(nantes.concentrations.pm10, 11);
  assert.equal(lyon.concentrations.pm10, 22);
  assert.equal(requestedUrls.length, 3, 'the batch, then ONE request per point');
});

test('a failed batch never silences the points that answer on their own', async () => {
  // A point the API refuses (a 400) must not take the others down with it,
  // at every cycle and every retry.
  stubFetchWith((url) => {
    if (isBatch(url) || url.includes('latitude=45.7679')) {
      return { status: 400 };
    }
    return { body: currentAt(11) };
  });
  openMeteoEuropeProvider.prefetchConcentrations([NANTES, LYON]);

  const [nantes, lyon] = await Promise.allSettled([
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
    openMeteoEuropeProvider.fetchConcentrations(LYON),
  ]);

  assert.equal(nantes.status, 'fulfilled');
  assert.equal(nantes.value.concentrations.pm10, 11);
  assert.equal(lyon.status, 'rejected');
  assert.match(lyon.reason.message, /400/);
});

test('a reader waiting during the fallback shares it, with no second request', async () => {
  stubFetchWith((url) => (isBatch(url) ? { status: 503 } : { body: currentAt(11) }));
  openMeteoEuropeProvider.prefetchConcentrations([NANTES, LYON]);

  // Three readers of Nantes, all in flight while the batch fails.
  await Promise.all([
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
    openMeteoEuropeProvider.fetchConcentrations(LYON),
    openMeteoEuropeProvider.fetchConcentrations(NANTES),
  ]);

  assert.equal(requestedUrls.length, 3, 'the batch, then ONE fallback per point');
  const nantesAlone = requestedUrls.filter(
    (url) => !isBatch(url) && decodeURIComponent(url).includes('latitude=47.2184'),
  );
  assert.equal(nantesAlone.length, 1, 'the waiting readers share the fallback');
});

test('a failed batch costs no unhandled rejection, even for a point nobody reads', async () => {
  stubFetchWith(() => ({ status: 503 }));
  openMeteoEuropeProvider.prefetchConcentrations([NANTES, LYON]);
  // An unhandled rejection would fail the run; give it a few turns to surface
  // (the batch, then the single-point fallbacks, all failing).
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(requestedUrls.length, 3, 'the batch, then one fallback per point');
});

test('the read-ahead groups the points by model: one request per domain', async () => {
  stubFetchWith((url) => ({
    body: url.includes('cams_europe')
      ? [currentAt(11), currentAt(22)]
      : [currentAt(33), currentAt(44)],
  }));
  prefetchAirQuality([NANTES, SYDNEY, LYON, NEW_YORK, { latitude: 300, longitude: 2 }]);

  const readings = await Promise.all([NANTES, LYON, SYDNEY, NEW_YORK].map(readAirQuality));

  assert.equal(requestedUrls.length, 2);
  assert.deepEqual(
    readings.map((reading) => reading.concentrations.pm10),
    [11, 22, 33, 44],
  );
  assert.deepEqual(
    readings.map((reading) => reading.provider),
    [
      openMeteoEuropeProvider.key,
      openMeteoEuropeProvider.key,
      openMeteoGlobalProvider.key,
      openMeteoGlobalProvider.key,
    ],
  );
});

// --- Retry-After --------------------------------------------------------------

test('a throttled answer carries the delay the server asked for', async () => {
  stubFetchWith(() => ({ status: 429, headers: { 'Retry-After': '90' } }));
  await assert.rejects(
    () => openMeteoEuropeProvider.fetchConcentrations(NANTES),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterMs, 90_000);
      return true;
    },
  );
});

test('Retry-After is read in seconds or as a date, and ignored otherwise', () => {
  const now = Date.parse('2026-08-06T12:00:00Z');
  assert.equal(parseRetryAfter('120', now), 120_000);
  assert.equal(parseRetryAfter('Thu, 06 Aug 2026 12:02:00 GMT', now), 120_000);
  assert.equal(parseRetryAfter('Thu, 06 Aug 2026 11:00:00 GMT', now), 0, 'a past date is now');
  assert.equal(parseRetryAfter('soon', now), null);
  assert.equal(parseRetryAfter(null, now), null);
});
