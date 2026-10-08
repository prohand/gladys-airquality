// -----------------------------------------------------------------------------
// Air quality providers: Open-Meteo Air Quality API (CAMS Europe + CAMS global).
//
// WHY THIS SOURCE RATHER THAN ATMO FRANCE. Atmo France is the reference for the
// French ATMO index, but its Atmo Data API requires an account and a token that
// every user would have to create and paste before the integration works at
// all — and the request explicitly asked to prefer an official open source with
// no authentication.
//
// Open-Meteo republishes the Copernicus Atmosphere Monitoring Service (CAMS)
// forecasts — the European Union's reference models, run by ECMWF — as open
// data, with NO account and NO API key. Two models, and the difference matters:
//
//   - CAMS EUROPE, ~11 km, Europe only: the regional ensemble, the finest of
//     the two, the one the European Air Quality Index is published from;
//   - CAMS GLOBAL, ~40 km, the whole planet: the global atmospheric composition
//     forecast, which reports the same five regulated pollutants everywhere
//     else.
//
// So there is one provider per model, registered Europe first (see
// src/airQuality/index.js): a European point is read on the finer regional
// model, and every other point on the global one. Both are asked for their
// domain EXPLICITLY rather than through the API's `auto` blend, because the two
// models are not coupled and may disagree — a location must stay on ONE of
// them for its history to be a single series rather than two datasets under one
// chart.
//
// Node 20+ provides `fetch` natively: no dependency needed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'open-meteo' });

// Overridable for local development; the default is the public API.
const API_BASE_URL =
  process.env.AIR_QUALITY_API_URL ?? 'https://air-quality-api.open-meteo.com/v1/air-quality';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Our pollutant keys mapped onto the Open-Meteo variable names. Same order as
 * POLLUTANTS, and a test keeps the two lists in step: a pollutant the scale
 * grades but nobody fetches would silently never have a value.
 *
 * All five are served by BOTH domains — the Europe-only variables of this API
 * (ammonia, the pollen taxa, the pre-computed european_aqi) are deliberately
 * not among them, so a device holds the same features wherever it is.
 */
export const OPEN_METEO_VARIABLES = {
  pm2_5: 'pm2_5',
  pm10: 'pm10',
  nitrogen_dioxide: 'nitrogen_dioxide',
  ozone: 'ozone',
  sulphur_dioxide: 'sulphur_dioxide',
};

// Bounding box of the CAMS European domain, as the regional ensemble publishes
// it. Inside it the ~11 km model answers; outside it this endpoint has nothing
// on `cams_europe`, which is why the global provider takes over there.
const CAMS_EUROPE_BBOX = { minLat: 30, maxLat: 72, minLon: -25, maxLon: 45 };

// The CAMS analysis is produced hourly: polling the same coordinates faster
// than this returns the same numbers. The cache keeps the public API quiet when
// several locations share a grid cell and when the user hammers the test button.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

// How many days the hourly curve covers: today and tomorrow. It is what the
// dashboard widget draws, and the ONE thing here that is not a device feature —
// a forecast has not happened yet, so the core keeps no history of it.
const FORECAST_DAYS = 2;

// The curve is a SECOND request, with a cache of its own: the refresh cycle of
// every device only ever needs the current hour and runs whether or not a
// dashboard is open, so the two must not share an entry.
const forecastCache = new Map();

/**
 * The entry a cache holds for `key` while it is still worth serving — in
 * flight, or answered less than CACHE_TTL_MS ago. An expired entry is DROPPED
 * on the way: the map would otherwise keep every point ever read until the
 * same point is read again.
 * @param {Map<string, { at: number|null, promise: Promise<unknown> }>} store
 * @param {string} key
 */
function liveEntry(store, key) {
  const entry = store.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.at === null || Date.now() - entry.at < CACHE_TTL_MS) {
    return entry;
  }
  store.delete(key);
  return undefined;
}

/**
 * The cached answer for `key`, or the one `load` produces.
 *
 * What is cached is the PROMISE, from the moment the request leaves: the
 * refresh cycle, a dashboard pull and the test button asking for the same
 * point within the same second share ONE request instead of racing three to
 * the API. The TTL starts when the answer arrives (`at` is null until then),
 * and a request that fails leaves no entry behind, so the next read tries
 * again rather than being served the failure for ten minutes.
 * @template T
 * @param {Map<string, { at: number|null, promise: Promise<T> }>} store
 * @param {string} key
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
function cachedRead(store, key, load) {
  const live = liveEntry(store, key);
  if (live) {
    logger.debug(`Cache hit for ${key}${live.at === null ? ' (in flight)' : ''}`);
    return live.promise;
  }
  const entry = { at: null, promise: load() };
  store.set(key, entry);
  // Also what marks the promise as handled: an entry nobody awaits (a point
  // read ahead by `prefetchConcentrations`) must never become an unhandled
  // rejection, which would take the container down.
  entry.promise.then(
    () => {
      // A cache cleared while the request was in flight stays cleared.
      if (store.get(key) === entry) {
        entry.at = Date.now();
      }
    },
    () => {
      if (store.get(key) === entry) {
        store.delete(key);
      }
    },
  );
  return entry.promise;
}

/**
 * How long a `Retry-After` header asks to wait, in milliseconds, or null.
 *
 * Both forms of RFC 9110 are read: a number of seconds, or an HTTP date. The
 * refresh cycle uses it to space its retry of a location Open-Meteo throttled
 * (HTTP 429) instead of knocking again thirty seconds later.
 * @param {string|null|undefined} value
 * @param {number} [now] the current time, in milliseconds (the tests)
 * @returns {number|null}
 */
export function parseRetryAfter(value, now = Date.now()) {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null;
  }
  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Whether a pair of numbers is a point on Earth at all.
 *
 * This is the floor of every `supports()` below: a stored coordinate can be
 * anything, and refusing a location the source could never answer for is the
 * whole reason coverage is checked before a device is published.
 * @param {{ latitude: number, longitude: number }} point
 */
export function isPoint({ latitude, longitude } = {}) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/** Whether a point falls in the domain of the CAMS European regional model. */
export function insideCamsEurope({ latitude, longitude } = {}) {
  return (
    latitude >= CAMS_EUROPE_BBOX.minLat &&
    latitude <= CAMS_EUROPE_BBOX.maxLat &&
    longitude >= CAMS_EUROPE_BBOX.minLon &&
    longitude <= CAMS_EUROPE_BBOX.maxLon
  );
}

/**
 * One request to the Open-Meteo air quality API, checked.
 *
 * Shared by the current hour and by the hourly curve: same host, same error
 * handling, same timeout — only the query differs.
 * @param {Record<string, string>} params query parameters, `domains` included
 * @returns {Promise<object>} the parsed body
 */
async function requestOpenMeteo(params) {
  const url = `${API_BASE_URL}?${new URLSearchParams(params).toString()}`;
  logger.debug('Open-Meteo request ->', url);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Propagate: the caller decides whether to keep the previous values or to
    // report the integration as disconnected. The status and the server's own
    // "come back later" travel with the error, for the refresh cycle's retry.
    const error = new Error(`Open-Meteo HTTP ${response.status}`);
    error.status = response.status;
    const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
    if (retryAfterMs !== null) {
      error.retryAfterMs = retryAfterMs;
    }
    throw error;
  }

  const body = await response.json();
  if (body?.error) {
    throw new Error(`Open-Meteo error: ${body.reason ?? 'unknown reason'}`);
  }
  return body;
}

/**
 * The five concentrations held by one hour of an answer.
 *
 * `Number(null)` is 0 — a perfectly clean sky — so an absent value must stay
 * null all the way to "no state published" and to "no point on the curve".
 * @param {(variable: string) => unknown} valueOf reads one API variable
 */
function readConcentrations(valueOf) {
  const concentrations = {};
  for (const [pollutant, variable] of Object.entries(OPEN_METEO_VARIABLES)) {
    const raw = valueOf(variable);
    concentrations[pollutant] = raw === null || raw === undefined ? null : Number(raw);
  }
  return concentrations;
}

/**
 * The current hour of ONE point of an answer: the shape `fetchConcentrations`
 * resolves to, whether the point was asked alone or in a batch.
 * @param {object} body the answer for that point
 */
function parseCurrent(body) {
  const current = body?.current ?? {};
  // The hour of the CAMS analysis, in the local time of the point — the
  // answer to "how fresh is this?", which the refresh interval alone does not
  // give: the model runs hourly and we may be reading a cached body.
  return {
    concentrations: readConcentrations((variable) => current[variable]),
    measuredAt: current.time ?? null,
    timeZone: body?.timezone_abbreviation ?? null,
  };
}

/**
 * One provider reading one CAMS domain. The two differ by their coverage and by
 * the `domains` parameter they ask for — everything else, request, parsing and
 * cache, is the same code.
 * @param {object} spec
 * @param {string} spec.key identifier reported by the test action and the logs
 * @param {{ en: string, fr: string }} spec.name
 * @param {string} spec.domain the Open-Meteo `domains` value
 * @param {(point: object) => boolean} spec.supports
 */
function createOpenMeteoProvider({ key, name, domain, supports }) {
  // The domain is part of the key: the same point read on two models is two
  // different answers, and one must never be served for the other.
  const cacheKey = ({ latitude, longitude }) => `${domain}:${latitude},${longitude}`;

  /** The query of the current hour, for one point or several. */
  const currentQuery = (points) => ({
    latitude: points.map((point) => String(point.latitude)).join(','),
    longitude: points.map((point) => String(point.longitude)).join(','),
    current: Object.values(OPEN_METEO_VARIABLES).join(','),
    // The domain EXPLICITLY: `auto` blends the two models, and a location
    // whose series silently switches from one to the other is two datasets
    // under one chart.
    domains: domain,
    timezone: 'auto',
  });

  return {
    key,
    name,
    domain,

    /** Pollutants this provider can report. */
    pollutants: Object.keys(OPEN_METEO_VARIABLES),

    /**
     * Whether this provider has data for a point.
     * @param {{ latitude: number, longitude: number }} point
     */
    supports,

    /**
     * Read the current pollutant concentrations of a point.
     * @param {{ latitude: number, longitude: number }} point
     * @returns {Promise<{
     *   concentrations: Record<string, number|null>,
     *   measuredAt: string|null,
     *   timeZone: string|null,
     * }>}
     *   concentrations in µg/m³, keyed by pollutant; a pollutant with no value is
     *   null (the caller turns that into "no state published"). `measuredAt` is
     *   the hour the model stamped the reading with, in the LOCAL time of the
     *   point (`timezone=auto` below), and `timeZone` the abbreviation that
     *   makes it readable from anywhere.
     */
    fetchConcentrations(point) {
      return cachedRead(cache, cacheKey(point), async () =>
        parseCurrent(await requestOpenMeteo(currentQuery([point]))),
      );
    },

    /**
     * Read the current hour of SEVERAL points in ONE request, ahead of the
     * `fetchConcentrations` calls that will ask for them.
     *
     * Open-Meteo takes comma-separated latitudes and longitudes and answers an
     * array, one entry per point, in the order asked. Twenty locations are
     * then one request per domain per refresh cycle instead of twenty. Nothing
     * is returned: each point's share of the answer is put in the cache under
     * that point's own key — in flight at once — so the per-point reads that
     * follow are served from it, the cache keeps working point by point, and
     * a batch that fails simply leaves each of them to fail (and be retried)
     * on its own. Never throws.
     *
     * A point already cached, or already in flight, is not asked again; a
     * lone point left is left to `fetchConcentrations`, whose request is the
     * plain single-point one.
     * @param {Array<{ latitude: number, longitude: number }>} points
     */
    prefetchConcentrations(points) {
      const wanted = new Map();
      for (const point of points) {
        const key = cacheKey(point);
        if (!wanted.has(key) && !liveEntry(cache, key)) {
          wanted.set(key, point);
        }
      }
      if (wanted.size < 2) {
        return;
      }

      const asked = [...wanted.values()];
      logger.debug(`Batching ${asked.length} points on ${domain}`);
      const batch = requestOpenMeteo(currentQuery(asked)).then((body) => {
        // Answered point by point, by POSITION: an answer that does not hold
        // exactly one entry per point asked cannot be told apart, and serving
        // one town the air of another is the one thing never to do.
        if (!Array.isArray(body) || body.length !== asked.length) {
          throw new Error(
            `Open-Meteo answered ${Array.isArray(body) ? body.length : 'no list of'} point(s) for ${asked.length} asked`,
          );
        }
        return body.map(parseCurrent);
      });
      asked.forEach((point, index) => {
        cachedRead(cache, cacheKey(point), () => batch.then((values) => values[index]));
      });
    },

    /**
     * Read the hourly curve of a point: today and tomorrow.
     *
     * This is the one piece of data that cannot be a device feature — it has
     * not happened yet, so the core historizes nothing of it — and it is only
     * ever read when a dashboard asks for the chart. Hence the second request
     * and the second cache: the refresh cycle must not pay for a curve nobody
     * is looking at.
     * @param {{ latitude: number, longitude: number }} point
     * @returns {Promise<{
     *   hours: Array<{ t: string, concentrations: Record<string, number|null> }>,
     *   timeZone: string|null,
     * }>}
     *   `t` is the LOCAL hour of the point, as the API stamps it, so the chart
     *   marks the reader's "now" against the location's own clock.
     */
    fetchForecast(point) {
      return cachedRead(forecastCache, cacheKey(point), async () => {
        const body = await requestOpenMeteo({
          latitude: String(point.latitude),
          longitude: String(point.longitude),
          hourly: Object.values(OPEN_METEO_VARIABLES).join(','),
          forecast_days: String(FORECAST_DAYS),
          domains: domain,
          timezone: 'auto',
        });

        const hourly = body?.hourly ?? {};
        const times = Array.isArray(hourly.time) ? hourly.time : [];
        return {
          hours: times.map((t, index) => ({
            t,
            concentrations: readConcentrations((variable) => hourly[variable]?.[index]),
          })),
          timeZone: body?.timezone_abbreviation ?? null,
        };
      });
    },
  };
}

/** Europe, on the ~11 km regional ensemble. */
export const openMeteoEuropeProvider = createOpenMeteoProvider({
  key: 'open-meteo-cams-europe',
  name: {
    en: 'Open-Meteo (CAMS Europe, Copernicus)',
    fr: 'Open-Meteo (CAMS Europe, Copernicus)',
  },
  domain: 'cams_europe',
  supports: (point) => isPoint(point) && insideCamsEurope(point),
});

/** Everywhere else, on the ~40 km global composition forecast. */
export const openMeteoGlobalProvider = createOpenMeteoProvider({
  key: 'open-meteo-cams-global',
  name: {
    en: 'Open-Meteo (CAMS global, Copernicus)',
    fr: 'Open-Meteo (CAMS global, Copernicus)',
  },
  domain: 'cams_global',
  // No bounding box: the global model covers the planet, so the only thing left
  // to refuse is a pair of numbers that is not a point.
  supports: isPoint,
});

/** Drop the cached responses, current hours and curves alike (the tests). */
export function clearAirQualityCache() {
  cache.clear();
  forecastCache.clear();
}
