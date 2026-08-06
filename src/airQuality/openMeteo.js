// -----------------------------------------------------------------------------
// Air quality provider: Open-Meteo Air Quality API (CAMS Europe).
//
// WHY THIS SOURCE RATHER THAN ATMO FRANCE. Atmo France is the reference for the
// French ATMO index, but its Atmo Data API requires an account and a token that
// every user would have to create and paste before the integration works at
// all — and the request explicitly asked to prefer an official open source with
// no authentication.
//
// Open-Meteo republishes the CAMS European air quality forecast — Copernicus
// Atmosphere Monitoring Service, the European Union's reference model, run by
// ECMWF on a ~11 km grid — as open data, with NO account and NO API key. The
// numbers are therefore official European ones, and the index this integration
// derives from them (src/airQuality/scale.js) uses the very thresholds the
// French ATMO index is defined with.
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
 */
export const OPEN_METEO_VARIABLES = {
  pm2_5: 'pm2_5',
  pm10: 'pm10',
  nitrogen_dioxide: 'nitrogen_dioxide',
  ozone: 'ozone',
  sulphur_dioxide: 'sulphur_dioxide',
};

// Bounding box of the CAMS European domain. Outside of it this endpoint falls
// back to the coarser global model, whose species do not line up with the
// European index bands — so a point there is refused up front rather than
// published as a device holding a number that does not mean what it says.
const CAMS_EUROPE_BBOX = { minLat: 30, maxLat: 72, minLon: -25, maxLon: 45 };

// The CAMS analysis is produced hourly: polling the same coordinates faster
// than this returns the same numbers. The cache keeps the public API quiet when
// several locations share a grid cell and when the user hammers the test button.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export const openMeteoProvider = {
  key: 'open-meteo-cams-europe',

  name: {
    en: 'Open-Meteo (CAMS Europe, Copernicus)',
    fr: 'Open-Meteo (CAMS Europe, Copernicus)',
  },

  /** Pollutants this provider can report. */
  pollutants: Object.keys(OPEN_METEO_VARIABLES),

  /**
   * Whether this provider has data for a point.
   * @param {{ latitude: number, longitude: number }} point
   */
  supports({ latitude, longitude }) {
    return (
      latitude >= CAMS_EUROPE_BBOX.minLat &&
      latitude <= CAMS_EUROPE_BBOX.maxLat &&
      longitude >= CAMS_EUROPE_BBOX.minLon &&
      longitude <= CAMS_EUROPE_BBOX.maxLon
    );
  },

  /**
   * Read the current pollutant concentrations of a point.
   * @param {{ latitude: number, longitude: number }} point
   * @returns {Promise<{ concentrations: Record<string, number|null>, measuredAt: string|null }>}
   *   concentrations in µg/m³, keyed by pollutant; a pollutant with no value is
   *   null (the caller turns that into "no state published").
   */
  async fetchConcentrations({ latitude, longitude }) {
    const cacheKey = `${latitude},${longitude}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      logger.debug(`Cache hit for ${cacheKey}`);
      return cached.value;
    }

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: Object.values(OPEN_METEO_VARIABLES).join(','),
      // The European domain explicitly: the global fallback reports the same
      // variable names on a different model, and comparing them over time would
      // be comparing two datasets under one chart.
      domains: 'cams_europe',
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

/** Drop the cached responses (used by the tests). */
export function clearAirQualityCache() {
  cache.clear();
}
