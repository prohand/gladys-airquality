// -----------------------------------------------------------------------------
// Air quality provider registry.
//
// A provider knows how to read pollutant concentrations for a point. Two are
// registered, and their ORDER is the whole logic: the first one that supports
// the point wins, so the finer regional model is asked wherever it has data and
// the global one answers everywhere else. Callers never name an implementation.
//
// To add one:
//   1. create `src/airQuality/<yourProvider>.js` exposing { key, name,
//      pollutants, supports(point), fetchConcentrations(point) }, plus the
//      OPTIONAL fetchForecast(point) the dashboard widget draws its curve from;
//   2. append it to PROVIDERS below, BEFORE the more generic ones — a national
//      source registered ahead of the CAMS ones overrides them for its own area,
//      and the global provider must stay LAST since it supports every point.
//
// This is deliberately separate from `src/geocoding.js`: reading the air of a
// point and turning what the user typed into a point are two different problems.
// -----------------------------------------------------------------------------

import { openMeteoEuropeProvider, openMeteoGlobalProvider } from './openMeteo.js';
import { concentrationToIndex, overallIndex } from './scale.js';

// Europe first (the ~11 km regional ensemble), the planet second (~40 km).
export const PROVIDERS = [openMeteoEuropeProvider, openMeteoGlobalProvider];

/**
 * Pick the provider that covers a point.
 * @param {{ latitude: number, longitude: number }} point
 * @returns {object|undefined} the provider, or undefined when none covers it
 */
export function findProvider(point) {
  return PROVIDERS.find((provider) => provider.supports(point));
}

/**
 * Every pollutant any registered provider can report, in a stable order. The
 * device features are built from this list so a device keeps the same shape
 * whichever provider ends up serving it.
 */
export function allPollutants() {
  const pollutants = [];
  for (const provider of PROVIDERS) {
    for (const pollutant of provider.pollutants) {
      if (!pollutants.includes(pollutant)) {
        pollutants.push(pollutant);
      }
    }
  }
  return pollutants;
}

/**
 * Read a point and grade its concentrations.
 * @param {{ latitude: number, longitude: number }} point
 * @returns {Promise<{
 *   provider: string,
 *   concentrations: Record<string, number|null>,
 *   subIndexes: Record<string, number|null>,
 *   overall: { level: number|null, pollutant: string|null },
 *   measuredAt: string|null,
 *   timeZone: string|null,
 * }>}
 */
export async function readAirQuality(point) {
  const provider = findProvider(point);
  if (!provider) {
    // The global provider covers every point on Earth, so getting here means
    // the location does not hold one: a coordinate out of range, or none.
    throw new Error(
      `No air quality provider covers ${point.latitude},${point.longitude} ` +
        '(that is not a point: latitude -90..90, longitude -180..180)',
    );
  }

  const { concentrations, measuredAt, timeZone } = await provider.fetchConcentrations(point);

  const subIndexes = {};
  for (const [pollutant, concentration] of Object.entries(concentrations)) {
    subIndexes[pollutant] = concentrationToIndex(pollutant, concentration);
  }

  return {
    provider: provider.key,
    concentrations,
    subIndexes,
    overall: overallIndex(subIndexes),
    measuredAt,
    timeZone: timeZone ?? null,
  };
}

/**
 * Read the hourly curve of a point and grade every hour of it.
 *
 * Only the dashboard widget uses this: it is the one thing here that cannot be
 * a device feature, since a forecast has not happened yet and the core
 * historizes nothing of it. A provider that cannot produce one answers no
 * hours rather than throwing — the card then drops its chart and keeps its
 * numbers.
 * @param {{ latitude: number, longitude: number }} point
 * @returns {Promise<{
 *   provider: string,
 *   hours: Array<{
 *     t: string,
 *     concentrations: Record<string, number|null>,
 *     subIndexes: Record<string, number|null>,
 *   }>,
 *   timeZone: string|null,
 * }>}
 */
export async function readAirQualityForecast(point) {
  const provider = findProvider(point);
  if (!provider) {
    throw new Error(
      `No air quality provider covers ${point.latitude},${point.longitude} ` +
        '(that is not a point: latitude -90..90, longitude -180..180)',
    );
  }
  if (typeof provider.fetchForecast !== 'function') {
    // Optional part of the contract: a national source added later may only
    // know the current hour.
    return { provider: provider.key, hours: [], timeZone: null };
  }

  const { hours, timeZone } = await provider.fetchForecast(point);
  return {
    provider: provider.key,
    hours: (hours ?? []).map((hour) => ({
      ...hour,
      subIndexes: Object.fromEntries(
        Object.entries(hour.concentrations ?? {}).map(([pollutant, concentration]) => [
          pollutant,
          concentrationToIndex(pollutant, concentration),
        ]),
      ),
    })),
    timeZone: timeZone ?? null,
  };
}
