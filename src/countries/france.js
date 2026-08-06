// -----------------------------------------------------------------------------
// Country: FRANCE. Postal code -> commune -> point.
//
// Source: the API Découpage administratif of geo.api.gouv.fr (API Géo), the
// official French administrative-boundaries API published by the DINUM on
// data.gouv.fr, built on the INSEE COG and the IGN ADMIN-EXPRESS database. It
// is open data, needs NO account and NO API key, and it is authoritative for
// what a French postal code actually covers.
//
//   https://geo.api.gouv.fr/decoupage-administratif/communes
//
// WHY A POSTAL CODE IS NOT A POINT. A French postal code is a La Poste routing
// key, not an administrative area: it can cover a dozen communes (01400 covers
// Châtillon-sur-Chalaronne and its neighbours), and a single commune can hold
// several of them (Nantes has 44000, 44100, 44200, 44300). So the lookup
// answers a LIST of communes and the caller either finds ONE or asks the user
// which commune they meant — never picks the first, since the wrong pick
// silently reports another town's air.
//
// The point used is the commune's `centre`, the centroid API Géo publishes.
// For a commune the size of a city this lands within a couple of kilometres of
// anywhere in it, which is finer than the ~11 km grid the forecast is read on.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'country-fr' });

// Overridable for local development; the default is the public API.
const API_BASE_URL = process.env.FR_GEO_API_URL ?? 'https://geo.api.gouv.fr';

const REQUEST_TIMEOUT_MS = 15_000;

/** Five digits, nothing else: "44000", "01400", "97400". */
const POSTAL_CODE_PATTERN = /^\d{5}$/;

/**
 * The coordinates API Géo publishes for a commune.
 *
 * `centre` is a GeoJSON Point, so its `coordinates` are [longitude, latitude] —
 * in that order, which is the reverse of how everything else in this
 * integration reads. Getting it backwards puts French communes in Somalia, so
 * it is unpacked once, here.
 * @param {object} commune
 * @returns {{ latitude: number, longitude: number } | null}
 */
function toPoint(commune) {
  const coordinates = commune?.centre?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }
  const [longitude, latitude] = coordinates.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

/** The places of an answer: a commune with no usable centre is not one. */
function toPlaces(communes, postalCode) {
  return (Array.isArray(communes) ? communes : [])
    .map((commune) => {
      const point = toPoint(commune);
      if (point === null) {
        return null;
      }
      return {
        // The commune name as INSEE spells it — accents included.
        name: String(commune?.nom ?? ''),
        postal_code: postalCode,
        // What tells two communes of one postal code apart in the message.
        context: String(commune?.departement?.nom ?? commune?.region?.nom ?? ''),
        ...point,
      };
    })
    .filter((place) => place !== null && place.name !== '');
}

export const france = {
  // ISO 3166-1 alpha-2: the value stored in the location and offered by the
  // manifest `country` select.
  code: 'FR',

  name: { en: 'France', fr: 'France' },

  /** What the postal code field should look like, for the error messages. */
  postalCodeExample: '44000',

  /**
   * Whether a string can be a postal code of this country. Checked before the
   * request, so an obvious typo answers instantly instead of costing a call.
   * @param {string} postalCode
   */
  isValidPostalCode(postalCode) {
    return POSTAL_CODE_PATTERN.test(String(postalCode ?? '').trim());
  },

  /**
   * The communes a postal code covers.
   * @param {string} postalCode five digits
   * @returns {Promise<Array<{ name: string, postal_code: string, context: string,
   *   latitude: number, longitude: number }>>} possibly empty, never null
   */
  async lookupPostalCode(postalCode) {
    const code = String(postalCode ?? '').trim();
    const params = new URLSearchParams({
      codePostal: code,
      // `centre` is NOT returned by default: without it every commune comes
      // back without coordinates and nothing can be published.
      fields: 'nom,code,centre,codesPostaux,departement,region',
      format: 'json',
    });
    const url = `${API_BASE_URL}/communes?${params.toString()}`;
    logger.debug('API Géo request ->', url);

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`API Géo HTTP ${response.status}`);
    }

    // An unknown postal code is an EMPTY ARRAY, not an error: "no commune" is
    // an answer the caller turns into a message, not a failure.
    return toPlaces(await response.json(), code);
  },
};
