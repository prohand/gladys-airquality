// -----------------------------------------------------------------------------
// Air quality provider registry.
//
// A provider knows how to read pollutant concentrations for a point. Today a
// single one is registered (Open-Meteo / CAMS Europe), but the lookup goes
// through `findProvider()` so adding a source for another region is a one-line
// change here plus a new file next to `openMeteo.js` — the device code never
// names a provider.
//
// To add one:
//   1. create `src/airQuality/<yourProvider>.js` exposing { key, name,
//      pollutants, supports(point), fetchConcentrations(point) };
//   2. append it to PROVIDERS below, BEFORE the more generic ones (the first
//      provider that supports the point wins, so a national source can override
//      the continental one for its own country).
//
// This is deliberately a SEPARATE registry from `src/countries/`: reading the
// air of a point and turning a postal code into a point are two different
// problems, and a new country usually only needs the second one.
// -----------------------------------------------------------------------------

import { openMeteoProvider } from './openMeteo.js';
import { concentrationToIndex, overallIndex } from './scale.js';

export const PROVIDERS = [openMeteoProvider];

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
 * }>}
 */
export async function readAirQuality(point) {
  const provider = findProvider(point);
  if (!provider) {
    throw new Error(
      `No air quality provider covers ${point.latitude},${point.longitude} ` +
        '(readings are currently limited to the CAMS European domain)',
    );
  }

  const { concentrations, measuredAt } = await provider.fetchConcentrations(point);

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
  };
}
