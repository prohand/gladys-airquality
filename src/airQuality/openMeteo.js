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
     * @returns {Promise<{ concentrations: Record<string, number|null>, measuredAt: string|null }>}
     *   concentrations in µg/m³, keyed by pollutant; a pollutant with no value is
     *   null (the caller turns that into "no state published").
     */
    async fetchConcentrations({ latitude, longitude }) {
      // The domain is part of the key: the same point read on two models is two
      // different answers, and one must never be served for the other.
      const cacheKey = `${domain}:${latitude},${longitude}`;
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        logger.debug(`Cache hit for ${cacheKey}`);
        return cached.value;
      }

      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: Object.values(OPEN_METEO_VARIABLES).join(','),
        // The domain EXPLICITLY: `auto` blends the two models, and a location
        // whose series silently switches from one to the other is two datasets
        // under one chart.
        domains: domain,
        timezone: 'auto',
      });
      const url = `${API_BASE_URL}?${params.toString()}`;
      logger.debug('Open-Meteo request ->', url);

      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        // Propagate: the caller decides whether to keep the previous values or to
        // report the integration as disconnected.
        throw new Error(`Open-Meteo HTTP ${response.status}`);
      }

      const body = await response.json();
      if (body?.error) {
        throw new Error(`Open-Meteo error: ${body.reason ?? 'unknown reason'}`);
      }

      const current = body?.current ?? {};
      const concentrations = {};
      for (const [pollutant, variable] of Object.entries(OPEN_METEO_VARIABLES)) {
        const raw = current[variable];
        // `Number(null)` is 0 — a perfectly clean sky — so an absent value must
        // stay null all the way to "no state published".
        concentrations[pollutant] = raw === null || raw === undefined ? null : Number(raw);
      }

      const value = { concentrations, measuredAt: current.time ?? null };
      cache.set(cacheKey, { at: Date.now(), value });
      return value;
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

/** Drop the cached responses (used by the tests). */
export function clearAirQualityCache() {
  cache.clear();
}
