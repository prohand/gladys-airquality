// -----------------------------------------------------------------------------
// Country registry: how a postal code becomes a point.
//
// This is THE extension point for the next country. Everything downstream — the
// provider, the index, the devices, the features — works on a latitude and a
// longitude and knows nothing about countries; the country only ever exists
// here, as the thing that knows how to read a national postal code.
//
// To add one:
//   1. create `src/countries/<yourCountry>.js` exposing
//      { code, name, postalCodeExample, isValidPostalCode(code),
//        lookupPostalCode(code) -> Promise<Place[]> },
//      where a Place is { name, postal_code, context, latitude, longitude };
//   2. append it to COUNTRIES below;
//   3. add the matching option to the `country` select of the `add_location`
//      action in `gladys-assistant-integration.json`.
//
// Step 3 cannot be skipped and cannot be automated: a manifest `select` has
// STATIC options, because the manifest is a file the store reads without
// running anything. `test/manifest.test.js` fails when the two lists diverge,
// so a country added in the code but not in the form is a red CI, not a
// mystery in production.
//
// Check as well that the new country is inside the coverage of an air quality
// provider (`src/airQuality/`): today that is the CAMS European domain. A
// country outside it needs its own provider registered too, otherwise adding a
// location there is refused — on purpose, rather than publishing a device that
// never holds a value.
// -----------------------------------------------------------------------------

import { france } from './france.js';

/** Every supported country, in the order the manifest offers them. */
export const COUNTRIES = [france];

/** The one the form pre-selects, and the one an older stored location gets. */
export const DEFAULT_COUNTRY = france.code;

/**
 * The country a stored code designates.
 * @param {unknown} code ISO 3166-1 alpha-2, case-insensitive
 * @returns {object|undefined}
 */
export function findCountry(code) {
  const wanted = String(code ?? '')
    .trim()
    .toUpperCase();
  return COUNTRIES.find((country) => country.code === wanted);
}

/**
 * Coerce whatever is stored into a supported country code. An unknown one falls
 * back to the default rather than making the location unusable: the postal code
 * is still there, and a lookup on the wrong country answers "no commune found",
 * which the user can act on.
 * @param {unknown} code
 * @returns {string} one of COUNTRIES' codes
 */
export function normalizeCountry(code) {
  return findCountry(code)?.code ?? DEFAULT_COUNTRY;
}

/**
 * Name of a country in one language, for the messages and the location labels.
 * @param {unknown} code
 * @param {string} [language]
 */
export function countryName(code, language = 'fr') {
  const country = findCountry(code);
  if (!country) {
    return String(code ?? '');
  }
  return country.name[language] ?? country.name.fr ?? country.name.en;
}
