// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// WHAT THE USER SEES: three buttons and nothing else. Locations are added with
// "Ajouter un lieu" (a country and a postal code), listed by "Afficher mes
// lieux" and removed with "Supprimer un lieu". The Configuration screen holds
// NO field about them.
//
// WHY EVERYTHING HAPPENS UNDER A BUTTON. The screen is generated from the
// manifest, which is a static file, and every field it renders that is not a
// `section` is an `<input>`: no read-only widget, no repeatable one. A list
// built at runtime is not something that screen can show as fields. An ACTION's
// result message, on the other hand, is displayed under its button, live, and
// is the ONLY thing the screen shows of what an integration has to say — so the
// listing is an action too.
//
// WHY A LOCATION IS NOT EDITABLE. Designating one entry of the list needs a
// dropdown, and a `select` in a manifest has STATIC options: they can only ever
// be POSITIONS, never the location names. Adding and deleting need no selection
// at all, and they are enough: a location is a commune, and another commune is
// another location.
//
// WHY THE MESSAGES ARE RETURNED AND NEVER THROWN. The SDK acknowledges a thrown
// handler error as a plain `error: e.message` string, which loses the
// multi-language object. Every expected outcome — a malformed postal code, an
// ambiguous one, a point outside the coverage — is RETURNED as `{ en, fr }`;
// only unexpected failures throw.
//
// Everything the outside world provides is injected (`getConfig`, `setConfig`,
// `lookupPlaces`, `isCovered`), so the whole set is testable without a Gladys
// server nor a network: see `test/locationEditor.test.js`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatPoint } from './coordinates.js';
import { countryName, DEFAULT_COUNTRY, findCountry, normalizeCountry } from './countries/index.js';
import { normalizeText } from './language.js';
import {
  buildAddressLabel,
  describeLocation,
  describeLocations,
  findLocationAtPlace,
  findLocationById,
  LOCATION_LINE_MARKER,
  LOCATION_LINE_SEPARATOR,
  LOCATIONS_KEY,
  locationAtPosition,
  MAX_LOCATIONS,
  newLocationId,
  positionOf,
  removeLocation,
  serializeLocations,
  upsertLocation,
} from './locations.js';

const logger = createLogger({ name: 'locations' });

/** How many communes a "be more precise" message lists before giving up. */
export const MAX_LISTED_PLACES = 8;

/**
 * The default way to turn a country code and a postal code into communes: ask
 * the country registry. Injected in tests so no request is ever made.
 * @param {string} countryCode
 * @param {string} postalCode
 */
async function lookupThroughRegistry(countryCode, postalCode) {
  const country = findCountry(countryCode);
  if (!country) {
    return [];
  }
  return country.lookupPostalCode(postalCode);
}

/**
 * Build the location manager.
 * @param {object} deps
 * @param {() => object} deps.getConfig the current normalized configuration
 * @param {(patch: Record<string, unknown>) => Promise<void>} deps.setConfig
 *   persist a partial configuration and refresh the in-memory one
 * @param {() => Promise<void>} deps.onLocationsChanged re-publish the devices
 *   and restart the refresh timer on the new list
 * @param {(location: object) => Promise<object|null>} [deps.findCreatedDevice]
 *   the Gladys device a location has already been given, if any
 * @param {(point: object) => boolean} [deps.isCovered] whether an air quality
 *   provider has data for a point
 * @param {typeof lookupThroughRegistry} [deps.lookupPlaces] injected in tests
 */
export function createLocationEditor({
  getConfig,
  setConfig,
  onLocationsChanged,
  findCreatedDevice = async () => null,
  isCovered = () => true,
  lookupPlaces = lookupThroughRegistry,
}) {
  /**
   * Persist a new list, then re-publish the devices on it.
   * @param {Array<object>} locations the new list
   */
  async function commit(locations) {
    await setConfig({ [LOCATIONS_KEY]: serializeLocations(locations) });
    await onLocationsChanged();
  }

  /** One commune of a candidate list, as the messages print it. */
  function describePlace(place) {
    return place.context ? `${place.name} (${place.context})` : place.name;
  }

  /** The candidates, truncated: a message under a button is not a directory. */
  function listPlaces(places) {
    const shown = places.slice(0, MAX_LISTED_PLACES).map(describePlace).join(' | ');
    return places.length > MAX_LISTED_PLACES
      ? `${shown} | … (+${places.length - MAX_LISTED_PLACES})`
      : shown;
  }

  /**
   * Turn a country + postal code + optional commune into ONE commune, or say
   * why it could not be one.
   *
   * A postal code is a routing key, not an area: several communes can share it.
   * When they do, the user names the one they meant in the "Commune" field —
   * nothing is picked by coin flip, since the wrong pick silently reports
   * another town's air.
   * @returns {Promise<{ place?: object, problem?: { en: string, fr: string } }>}
   */
  async function resolvePlace(country, postalCode, wantedCity) {
    const places = await lookupPlaces(country.code, postalCode);

    if (places.length === 0) {
      return {
        problem: {
          en: `No commune found for postal code "${postalCode}" in ${countryName(country.code, 'en')}. Check the code.`,
          fr: `Aucune commune trouvée pour le code postal « ${postalCode} » en ${countryName(country.code, 'fr')}. Vérifiez le code.`,
        },
      };
    }

    if (wantedCity === '') {
      if (places.length === 1) {
        return { place: places[0] };
      }
      // Several communes share this code: ask, and say which ones.
      return {
        problem: {
          en: `Postal code ${postalCode} covers ${places.length} communes. Fill the "Commune" field with the one you want: ${listPlaces(places)}`,
          fr: `Le code postal ${postalCode} couvre ${places.length} communes. Renseignez le champ « Commune » avec celle que vous voulez : ${listPlaces(places)}`,
        },
      };
    }

    // Accent- and case-insensitive: nobody types "Saint-Étienne" with the
    // accent in a form. An exact match wins over a prefix one, so "Nantes"
    // never resolves to "Nantes-en-Ratier" when both are offered.
    const wanted = normalizeText(wantedCity);
    const exact = places.filter((place) => normalizeText(place.name) === wanted);
    const matches =
      exact.length > 0
        ? exact
        : places.filter((place) => normalizeText(place.name).startsWith(wanted));

    if (matches.length === 0) {
      return {
        problem: {
          en: `Postal code ${postalCode} covers no commune named "${wantedCity}". Available: ${listPlaces(places)}`,
          fr: `Le code postal ${postalCode} ne couvre aucune commune nommée « ${wantedCity} ». Disponibles : ${listPlaces(places)}`,
        },
      };
    }
    if (matches.length > 1) {
      return {
        problem: {
          en: `"${wantedCity}" matches ${matches.length} communes of postal code ${postalCode}. Type the full name: ${listPlaces(matches)}`,
          fr: `« ${wantedCity} » correspond à ${matches.length} communes du code postal ${postalCode}. Saisissez le nom complet : ${listPlaces(matches)}`,
        },
      };
    }
    return { place: matches[0] };
  }

  /**
   * The device a location has already been given, or null.
   *
   * Never fatal: failing to read the device list must not stop a deletion the
   * user asked for — at worst the message is the vaguer of the two.
   */
  async function createdDeviceOf(location) {
    try {
      return await findCreatedDevice(location);
    } catch (err) {
      logger.warn('Could not tell whether the location had a device', err);
      return null;
    }
  }

  return {
    // --- Manifest actions ---------------------------------------------------
    actions: {
      /**
       * Add a location, from a country and a postal code.
       *
       * The postal code is the whole input: it is what the user knows by heart
       * about the place they live in, and the country registry
       * (`src/countries/`) is what turns it into the point everything
       * downstream works on.
       */
      async add_location(fields = {}) {
        const postalCode = String(fields.postal_code ?? '').trim();
        const wantedCity = String(fields.city ?? '').trim();
        const countryCode = normalizeCountry(fields.country ?? DEFAULT_COUNTRY);
        logger.info(
          `Action add_location <- ${countryCode} / ${postalCode} / ${wantedCity || '(any commune)'}`,
        );

        const country = findCountry(countryCode);
        if (!country) {
          // Unreachable through the form (the select only offers supported
          // codes) but reachable through a hand-written config.
          return {
            en: `Country "${fields.country}" is not supported yet.`,
            fr: `Le pays « ${fields.country} » n'est pas encore pris en charge.`,
          };
        }

        if (postalCode === '') {
          return {
            en: `Type the postal code of the location to add, e.g. "${country.postalCodeExample}".`,
            fr: `Saisissez le code postal du lieu à ajouter, par exemple « ${country.postalCodeExample} ».`,
          };
        }
        if (!country.isValidPostalCode(postalCode)) {
          return {
            en: `"${postalCode}" is not a valid ${countryName(country.code, 'en')} postal code. Expected something like "${country.postalCodeExample}".`,
            fr: `« ${postalCode} » n'est pas un code postal ${countryName(country.code, 'fr')} valide. Attendu quelque chose comme « ${country.postalCodeExample} ».`,
          };
        }

        const { locations } = getConfig();
        if (locations.length >= MAX_LOCATIONS) {
          return {
            en: `Maximum ${MAX_LOCATIONS} locations. Delete one first.`,
            fr: `Maximum ${MAX_LOCATIONS} lieux. Supprimez-en un d'abord.`,
          };
        }

        const { place, problem } = await resolvePlace(country, postalCode, wantedCity);
        if (problem) {
          return problem;
        }

        // Refused HERE rather than published as a device that never holds a
        // value: outside the covered domain the forecast has nothing to say,
        // so the device would sit forever on "no recent value".
        if (!isCovered(place)) {
          return {
            en: `No air quality source covers ${place.name} (${formatPoint(place)}): readings stop at the edge of the CAMS European domain. This location was not added.`,
            fr: `Aucune source de qualité de l'air ne couvre ${place.name} (${formatPoint(place)}) : les mesures s'arrêtent aux limites du domaine européen CAMS. Ce lieu n'a pas été ajouté.`,
          };
        }

        const candidate = {
          country: country.code,
          postal_code: place.postal_code,
          city: place.name,
        };
        const duplicate = findLocationAtPlace(locations, candidate);
        if (duplicate) {
          return {
            en: `${place.name} (${place.postal_code}) is already watched by location ${positionOf(locations, duplicate.id)} "${duplicate.name}".`,
            fr: `${place.name} (${place.postal_code}) est déjà surveillé par le lieu ${positionOf(locations, duplicate.id)} « ${duplicate.name} ».`,
          };
        }

        // A location the user did not name is named after its commune —
        // "Qualité de l'air — Nantes" beats two decimals.
        const name = String(fields.name ?? '').trim() || place.name;
        const id = newLocationId(locations);
        await commit(
          upsertLocation(locations, {
            id,
            name,
            ...candidate,
            address_label: buildAddressLabel({
              city: place.name,
              postal_code: place.postal_code,
              context: place.context,
            }),
            latitude: place.latitude,
            longitude: place.longitude,
          }),
        );

        const saved = findLocationById(getConfig().locations, id);
        const position = positionOf(getConfig().locations, id);
        return {
          en: `Location ${position} "${name}" added: ${describeLocation(saved)}. Add its device from the Discovery tab; "Show my locations" lists them all.`,
          fr: `Lieu ${position} « ${name} » ajouté : ${describeLocation(saved)}. Ajoutez son appareil depuis l'onglet Découverte ; « Afficher mes lieux » les liste tous.`,
        };
      },

      /**
       * List the configured locations, numbered.
       *
       * This is the whole "display" side of the integration: the Configuration
       * screen shows nothing else of what it holds, and these numbers are the
       * ones the delete dropdown offers.
       */
      async list_locations() {
        const { locations } = getConfig();
        logger.info(`Action list_locations -> ${locations.length} location(s)`);
        if (locations.length === 0) {
          return {
            en: 'No location yet. Add one with "Add a location".',
            fr: "Aucun lieu pour l'instant. Ajoutez-en un avec « Ajouter un lieu ».",
          };
        }
        const listing = describeLocations(locations);
        return {
          en: `${locations.length}/${MAX_LOCATIONS} location(s), as "${LOCATION_LINE_MARKER}number. name — commune (postal code), area (latitude, longitude)":${LOCATION_LINE_SEPARATOR}${listing}`,
          fr: `${locations.length}/${MAX_LOCATIONS} lieu(x), au format « ${LOCATION_LINE_MARKER}numéro. nom — commune (code postal), zone (latitude, longitude) » :${LOCATION_LINE_SEPARATOR}${listing}`,
        };
      },

      /**
       * Remove the location this action's dropdown names — by its POSITION in
       * the list, which is all a static `select` can offer.
       */
      async remove_location(fields = {}) {
        logger.info(
          `Action remove_location <- ${fields.location ?? ''} confirmation=${fields.confirmation ?? false}`,
        );
        const { locations } = getConfig();
        if (locations.length === 0) {
          return {
            en: 'No location yet. Add one with "Add a location".',
            fr: "Aucun lieu pour l'instant. Ajoutez-en un avec « Ajouter un lieu ».",
          };
        }

        const location = locationAtPosition(locations, fields.location);
        if (!location) {
          return {
            en: `There is no location ${fields.location}. Configured: ${describeLocations(locations)}`,
            fr: `Il n'y a pas de lieu ${fields.location}. Configurés : ${describeLocations(locations)}`,
          };
        }
        if (fields.confirmation !== true) {
          // One click away from losing a location, in a screen full of buttons:
          // the checkbox is what makes it deliberate.
          return {
            en: `Tick "I confirm" to delete location ${fields.location} "${location.name}" (${describeLocation(location)}).`,
            fr: `Cochez « Je confirme » pour supprimer le lieu ${fields.location} « ${location.name} » (${describeLocation(location)}).`,
          };
        }

        // Asked BEFORE the re-publish, while the location still has an
        // external_id to look for: a device the user has already created is the
        // one case an integration cannot clean up, and it must say so precisely
        // rather than leave a sensor that never updates again.
        const created = await createdDeviceOf(location);
        await commit(removeLocation(locations, location.id));

        // Deleting the third of four locations moves the fourth up a rank, and
        // those numbers are what this very dropdown offers.
        const renumbered =
          positionOf(locations, location.id) < locations.length
            ? {
                en: ' The locations after it moved up one rank: run "Show my locations" before deleting another one.',
                fr: " Les lieux suivants remontent d'un rang : lancez « Afficher mes lieux » avant d'en supprimer un autre.",
              }
            : { en: '', fr: '' };

        if (!created) {
          // Never created: re-publishing the list without it is enough, the
          // Discovery screen stops offering it on the spot.
          return {
            en: `Location "${location.name}" removed, and it is no longer offered in the Discovery tab.${renumbered.en}`,
            fr: `Lieu « ${location.name} » supprimé, et il n'est plus proposé dans l'onglet Découverte.${renumbered.fr}`,
          };
        }
        // An integration can only stop OFFERING a device; deleting one the user
        // created is not something the host API lets it do, at any version.
        return {
          en: `Location "${location.name}" removed. Its device "${created.name}" still exists in Gladys and will stop updating: delete it yourself from the integration's Devices tab — an integration is not allowed to delete a device.${renumbered.en}`,
          fr: `Lieu « ${location.name} » supprimé. Son appareil « ${created.name} » existe toujours dans Gladys et ne se mettra plus à jour : supprimez-le vous-même depuis l'onglet Appareils de l'intégration — une intégration n'a pas le droit de supprimer un appareil.${renumbered.fr}`,
        };
      },
    },
  };
}
