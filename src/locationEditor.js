// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// WHAT THE USER SEES: four buttons and nothing else. Locations are added with
// "Ajouter un lieu" (a town, anywhere in the world) or, in one click, with
// "Ajouter mes maisons Gladys", listed by "Afficher mes lieux" and removed with
// "Supprimer un lieu". The Configuration screen holds NO field about them.
//
// WHY EVERYTHING HAPPENS UNDER A BUTTON. The screen is generated from the
// manifest, which is a static file, and every field it renders that is not a
// `section` is an `<input>`: no read-only widget, no repeatable one. A list
// built at runtime is not something that screen can show as fields. An ACTION's
// result message, on the other hand, is displayed under its button, live, and
// is the ONLY thing the screen shows of what an integration has to say — so the
// listing is an action too.
//
// WHY THERE IS NO COUNTRY FIELD. There used to be one, because a postal code is
// only readable by the country that issues it, and it made the whole
// integration French while its data source covers the planet. A worldwide
// geocoder (`src/geocoding.js`) takes a town name in any country instead, so
// the country is not something the user has to pick nor something the code has
// to know about.
//
// WHY A LOCATION IS NOT EDITABLE. Designating one entry of the list needs a
// dropdown, and a `select` in a manifest has STATIC options: they can only ever
// be POSITIONS, never the location names. Adding and deleting need no selection
// at all, and they are enough: a location is a point, and a point that moved is
// another location.
//
// WHY THE MESSAGES ARE RETURNED AND NEVER THROWN. The SDK acknowledges a thrown
// handler error as a plain `error: e.message` string, which loses the
// multi-language object. Every expected outcome — a town nobody knows, an
// ambiguous name, a pair of coordinates that is not a point — is RETURNED as
// `{ en, fr, de, es }`; only unexpected failures throw.
//
// WHY THE ACTIONS RUN ONE AT A TIME. Each of them reads the list, waits on the
// network (the geocoder, the houses, the device list), then writes a new list.
// Two clicks in the same second would both read the list of before, and the
// second write would silently drop the first one's location. So they are
// queued (`exclusive`), and each one RE-READS the list right before it writes:
// a configuration saved meanwhile is not overwritten either.
//
// Everything the outside world provides is injected (`getConfig`, `setConfig`,
// `resolvePlace`, `isCovered`, `listHouses`), so the whole set is testable
// without a Gladys server nor a network: see `test/locationEditor.test.js`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatPoint, toCoordinate } from './coordinates.js';
import {
  describePlace,
  MAX_LISTED_CANDIDATES,
  placeContext,
  resolvePlace as geocodePlace,
} from './geocoding.js';
import { HOUSE_ACCESS_DENIED } from './houses.js';
import { byLanguage, inLanguage } from './language.js';
import { shortReason } from './reason.js';
import {
  describeLocation,
  describeLocations,
  findLocationAtPoint,
  findLocationById,
  hasCoordinates,
  LOCATION_LINE_MARKER,
  LOCATION_LINE_SEPARATOR,
  LOCATIONS_KEY,
  locationAtPosition,
  locationsMissingIds,
  locationDetail,
  locationLine,
  MAX_LOCATIONS,
  newLocationId,
  positionOf,
  removeLocation,
  serializeLocations,
  upsertLocation,
} from './locations.js';

const logger = createLogger({ name: 'locations' });

/** What every action answers once the list is full. */
const CAP_REACHED = {
  en: `Maximum ${MAX_LOCATIONS} locations. Delete one first.`,
  fr: `Maximum ${MAX_LOCATIONS} lieux. Supprimez-en un d'abord.`,
  de: `Maximal ${MAX_LOCATIONS} Orte. Entferne zuerst einen.`,
  es: `Máximo ${MAX_LOCATIONS} lugares. Elimine uno primero.`,
};

/** How each language quotes a name: "Home", « Maison », „Zuhause“, «Casa». */
const QUOTE = {
  en: (text) => `"${text}"`,
  fr: (text) => `« ${text} »`,
  de: (text) => `„${text}“`,
  es: (text) => `«${text}»`,
};

/** `text` between the quotes of `language`. */
function quote(text, language) {
  return inLanguage(QUOTE, language)(text);
}

/** The tail of `savedButNotPublished`, after the clause saying what was saved. */
const NOT_PUBLISHED = {
  en: (reason) =>
    `, but publishing the devices to the Discover tab failed: ${reason}. The change is saved; the Discover tab will follow at the next successful publication (a scan, a restart or another change).`,
  fr: (reason) =>
    `, mais la publication des appareils dans l'onglet Découverte a échoué : ${reason}. La modification est enregistrée ; l'onglet Découverte suivra à la prochaine publication réussie (une recherche, un redémarrage ou une autre modification).`,
  de: (reason) =>
    `, aber die Veröffentlichung der Geräte im Tab „Entdecken“ ist fehlgeschlagen: ${reason}. Die Änderung ist gespeichert; der Tab „Entdecken“ folgt bei der nächsten erfolgreichen Veröffentlichung (ein Scan, ein Neustart oder eine weitere Änderung).`,
  es: (reason) =>
    `, pero la publicación de los dispositivos en la pestaña «Descubrir» ha fallado: ${reason}. El cambio está guardado; la pestaña «Descubrir» se actualizará en la próxima publicación correcta (una búsqueda, un reinicio u otro cambio).`,
};

/**
 * A change that WAS saved, but whose devices could not be published.
 *
 * The list is the source of truth and it holds the change: saying "failed"
 * would make the user click again and add the location twice; saying nothing
 * would leave them looking for a device the Discovery tab does not show.
 * @param {Record<string, string>} saved what was saved, as a clause, per language
 * @param {string} reason why the publication failed
 * @param {string} [details] appended as it is: the lines of a list
 */
function savedButNotPublished(saved, reason, details = '') {
  return byLanguage(
    (language) => `${saved[language]}${inLanguage(NOT_PUBLISHED, language)(reason)}${details}`,
  );
}

/**
 * The sentences of the house import naming the houses it did NOT add, per
 * language. Each takes the house names already quoted (see `quote`).
 */
const IMPORT_NOTES = {
  en: {
    duplicate: (house, position, location) => `${house} (already location ${position} ${location})`,
    duplicates: (list) => ` Already watched: ${list}.`,
    unlocated: (names) =>
      ` Not placed on the map in Gladys, so there is no point to watch: ${names}. Set their location in Settings > Houses and click again.`,
    uncovered: (names) => ` No air quality source covers them: ${names}.`,
    overflow: (names) => ` Maximum ${MAX_LOCATIONS} locations reached, left out: ${names}.`,
  },
  fr: {
    duplicate: (house, position, location) => `${house} (déjà le lieu ${position} ${location})`,
    duplicates: (list) => ` Déjà surveillé(s) : ${list}.`,
    unlocated: (names) =>
      ` Sans position sur la carte dans Gladys, donc sans point à surveiller : ${names}. Renseignez leur emplacement dans Réglages > Maisons puis relancez l'action.`,
    uncovered: (names) => ` Aucune source de qualité de l'air ne les couvre : ${names}.`,
    overflow: (names) =>
      ` Maximum de ${MAX_LOCATIONS} lieux atteint, laissée(s) de côté : ${names}.`,
  },
  de: {
    duplicate: (house, position, location) => `${house} (bereits Ort ${position} ${location})`,
    duplicates: (list) => ` Bereits überwacht: ${list}.`,
    unlocated: (names) =>
      ` In Gladys nicht auf der Karte platziert, daher ohne Punkt zum Überwachen: ${names}. Lege ihre Position unter Einstellungen > Zuhause fest und klicke erneut.`,
    uncovered: (names) => ` Keine Luftqualitätsquelle deckt sie ab: ${names}.`,
    overflow: (names) => ` Maximum von ${MAX_LOCATIONS} Orten erreicht, ausgelassen: ${names}.`,
  },
  es: {
    duplicate: (house, position, location) => `${house} (ya es el lugar ${position} ${location})`,
    duplicates: (list) => ` Ya vigilada(s): ${list}.`,
    unlocated: (names) =>
      ` Sin posición en el mapa de Gladys, por lo que no hay ningún punto que vigilar: ${names}. Indique su ubicación en Configuración > Viviendas y vuelva a pulsar.`,
    uncovered: (names) => ` Ninguna fuente de calidad del aire las cubre: ${names}.`,
    overflow: (names) => ` Máximo de ${MAX_LOCATIONS} lugares alcanzado, omitida(s): ${names}.`,
  },
};

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
 * @param {typeof geocodePlace} [deps.resolvePlace] injected in tests
 * @param {() => Promise<import('./houses.js').House[]>} [deps.listHouses] the
 *   houses configured in Gladys (`fetchHouses` bound to the SDK in `index.js`)
 */
export function createLocationEditor({
  getConfig,
  setConfig,
  onLocationsChanged,
  findCreatedDevice = async () => null,
  isCovered = () => true,
  resolvePlace = geocodePlace,
  listHouses = async () => {
    throw new Error('listHouses is not wired');
  },
}) {
  // Tail of the queue the list-changing work runs in, one task at a time.
  let queue = Promise.resolve();

  /**
   * Run `task` once every task queued before it has settled, whatever their
   * outcome: a failed action must not block the next click.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function exclusive(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  /**
   * Persist a new list, then re-publish the devices on it.
   *
   * A failed write throws: nothing was saved, and that is an unexpected
   * failure. A failed PUBLICATION does not: the list is saved, so the caller
   * answers that it is, and why the Discovery tab does not show it yet.
   * @param {Array<object>} locations the new list
   * @returns {Promise<string|null>} why the devices could not be published, or
   *   null when everything went through
   */
  async function commit(locations) {
    await setConfig({ [LOCATIONS_KEY]: serializeLocations(locations) });
    try {
      await onLocationsChanged();
      return null;
    } catch (err) {
      logger.error('The locations are saved, but the devices could not be published', err);
      return shortReason(err);
    }
  }

  /**
   * The point typed by hand in the add form, when there is one.
   *
   * Both coordinates or neither: a lone latitude is not a point, and taking it
   * with a longitude of 0 would silently watch the Gulf of Guinea. They are
   * `string` fields — see src/coordinates.js for why — so `toCoordinate` is what
   * parses them, comma included, and what rejects a latitude of 300.
   * @param {object} fields
   * @returns {{ point?: object, problem?: Record<string, string> }} both
   *   absent when the user typed no coordinate at all
   */
  function typedPoint(fields) {
    const rawLatitude = String(fields.latitude ?? '').trim();
    const rawLongitude = String(fields.longitude ?? '').trim();
    if (rawLatitude === '' && rawLongitude === '') {
      return {};
    }
    const latitude = toCoordinate(rawLatitude, 'latitude');
    const longitude = toCoordinate(rawLongitude, 'longitude');
    if (latitude === null || longitude === null) {
      return {
        problem: {
          en: `Latitude and longitude go together, in WGS-84 decimal degrees (latitude -90 to 90, longitude -180 to 180): "48.8566" and "2.3522". Received "${rawLatitude}" and "${rawLongitude}".`,
          fr: `La latitude et la longitude vont ensemble, en degrés décimaux WGS-84 (latitude de -90 à 90, longitude de -180 à 180) : « 48,8566 » et « 2,3522 ». Reçu « ${rawLatitude} » et « ${rawLongitude} ».`,
          de: `Breitengrad und Längengrad gehören zusammen, in WGS-84-Dezimalgrad (Breitengrad -90 bis 90, Längengrad -180 bis 180): „48.8566“ und „2.3522“. Erhalten: „${rawLatitude}“ und „${rawLongitude}“.`,
          es: `La latitud y la longitud van juntas, en grados decimales WGS-84 (latitud de -90 a 90, longitud de -180 a 180): «48,8566» y «2,3522». Recibido: «${rawLatitude}» y «${rawLongitude}».`,
        },
      };
    }
    return { point: { latitude, longitude } };
  }

  /**
   * Turn a place name into a point, or say why it could not be one.
   *
   * Most names are shared — several Montauban in France alone, a Paris in Texas,
   * a Springfield per state — so an ambiguous answer asks instead of picking:
   * the wrong pick silently reports another town's air.
   * @param {string} query
   * @param {string} language the language the place names come back in
   * @returns {Promise<{ point?: object, place?: object, problem?: object }>}
   */
  async function geocode(query, language) {
    const { match, candidates } = await resolvePlace(query, language);
    if (candidates.length === 0) {
      return {
        problem: {
          en: `No place found for "${query}". Check the spelling, or narrow it down with a comma: "Montauban, Tarn-et-Garonne", "Springfield, Illinois".`,
          fr: `Aucun lieu trouvé pour « ${query} ». Vérifiez l'orthographe, ou précisez après une virgule : « Montauban, Tarn-et-Garonne », « Springfield, Illinois ».`,
          de: `Kein Ort für „${query}“ gefunden. Prüfe die Schreibweise oder präzisiere nach einem Komma: „Montauban, Tarn-et-Garonne“, „Springfield, Illinois“.`,
          es: `No se ha encontrado ningún lugar para «${query}». Compruebe la ortografía o precise tras una coma: «Montauban, Tarn-et-Garonne», «Springfield, Illinois».`,
        },
      };
    }
    if (!match) {
      const list = candidates.slice(0, MAX_LISTED_CANDIDATES).map(describePlace).join(' | ');
      return {
        problem: {
          en: `Several places are named "${query}". Add a comma and the region, the country or the postal code: ${list}`,
          fr: `Plusieurs lieux s'appellent « ${query} ». Ajoutez une virgule puis la région, le pays ou le code postal : ${list}`,
          de: `Mehrere Orte heißen „${query}“. Füge ein Komma und die Region, das Land oder die Postleitzahl hinzu: ${list}`,
          es: `Varios lugares se llaman «${query}». Añada una coma y la región, el país o el código postal: ${list}`,
        },
      };
    }
    return {
      point: { latitude: match.latitude, longitude: match.longitude },
      place: match,
    };
  }

  /**
   * The houses of a report, quoted the way each language quotes.
   *
   * A house is named by the user in Gladys, so the name is the only thing that
   * tells "Maison" from "Bureau" in a sentence about three of them.
   * @param {Array<{ name: string }>} houses
   * @param {string} language one of LANGUAGES
   */
  function quoteNames(houses, language) {
    return houses.map((house) => quote(house.name, language)).join(', ');
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

  // --- Manifest actions ---------------------------------------------------
  // The handlers as written; `actions` below is what is registered, each one
  // queued behind the others.
  const handlers = {
    /**
     * Add a location, from a place name or straight from a point.
     *
     * The place name is the normal way in — nobody knows their town's
     * coordinates by heart. The two coordinate fields are the way out of the
     * cases the geocoder cannot serve: a hamlet it does not know, or a point
     * read off a map. Given both, they WIN over the name, which is then only
     * kept as the label of the location.
     */
    async add_location(fields = {}) {
      const query = String(fields.place ?? '').trim();
      logger.info(
        `Action add_location <- ${fields.name ?? ''} / ${query} / ` +
          `${fields.latitude ?? ''},${fields.longitude ?? ''}`,
      );

      const typed = typedPoint(fields);
      if (typed.problem) {
        return typed.problem;
      }
      if (!typed.point && query === '') {
        return {
          en: 'Type the town of the location to add, anywhere in the world, or its latitude and its longitude.',
          fr: "Saisissez la commune du lieu à ajouter, n'importe où dans le monde, ou sa latitude et sa longitude.",
          de: 'Gib den Ort ein, der hinzugefügt werden soll — überall auf der Welt —, oder seinen Breiten- und Längengrad.',
          es: 'Escriba el municipio del lugar que desea añadir, en cualquier parte del mundo, o su latitud y su longitud.',
        };
      }

      // Checked before anything is queried: a full list needs no geocoding.
      const { locations, language } = getConfig();
      if (locations.length >= MAX_LOCATIONS) {
        return CAP_REACHED;
      }

      // A typed point is used as it is: the user gave the answer the geocoder
      // would only have guessed at.
      const geocoded = typed.point ? null : await geocode(query, language);
      if (geocoded?.problem) {
        return geocoded.problem;
      }
      const point = typed.point ?? geocoded.point;

      // The global model covers the planet, so this only ever refuses what is
      // not a point at all — but it is checked HERE rather than published as a
      // device that never holds a value.
      if (!isCovered(point)) {
        return {
          en: `No air quality source covers ${formatPoint(point)}. This location was not added.`,
          fr: `Aucune source de qualité de l'air ne couvre ${formatPoint(point)}. Ce lieu n'a pas été ajouté.`,
          de: `Keine Luftqualitätsquelle deckt ${formatPoint(point)} ab. Dieser Ort wurde nicht hinzugefügt.`,
          es: `Ninguna fuente de calidad del aire cubre ${formatPoint(point)}. Este lugar no se ha añadido.`,
        };
      }

      // RE-READ: the geocoder took its time, and a configuration saved
      // meanwhile must not be overwritten by the list of before.
      const current = getConfig().locations;
      if (current.length >= MAX_LOCATIONS) {
        return CAP_REACHED;
      }

      // The forecast is read on a grid cell kilometres wide: two devices on
      // the same point would report the same numbers under two names.
      const duplicate = findLocationAtPoint(current, point);
      if (duplicate) {
        return {
          en: `That point is already watched by location ${positionOf(current, duplicate.id)} "${duplicate.name}".`,
          fr: `Ce point est déjà surveillé par le lieu ${positionOf(current, duplicate.id)} « ${duplicate.name} ».`,
          de: `Dieser Punkt wird bereits von Ort ${positionOf(current, duplicate.id)} „${duplicate.name}“ überwacht.`,
          es: `Ese punto ya lo vigila el lugar ${positionOf(current, duplicate.id)} «${duplicate.name}».`,
        };
      }

      // A location the user did not name is named after the place it is in —
      // "Qualité de l'air — Montauban" beats two decimals. A typed point with
      // no name at all falls back to its coordinates.
      const name =
        String(fields.name ?? '').trim() || geocoded?.place?.name || query || formatPoint(point);
      // What the listing shows after the name: where the point actually is.
      // A geocoded place carries its region and country; a typed point keeps
      // whatever the user wrote in the place field, and nothing when they
      // wrote nothing (the geocoder has no reverse endpoint to ask).
      const addressLabel = geocoded?.place
        ? [geocoded.place.name, placeContext(geocoded.place)].filter(Boolean).join(', ')
        : query;

      const id = newLocationId(current);
      const notPublished = await commit(
        upsertLocation(current, { id, name, address_label: addressLabel, ...point }),
      );

      const saved = findLocationById(getConfig().locations, id);
      const position = positionOf(getConfig().locations, id);
      if (notPublished) {
        return savedButNotPublished(
          {
            en: `Location ${position} "${name}" saved (${describeLocation(saved)})`,
            fr: `Lieu ${position} « ${name} » enregistré (${describeLocation(saved)})`,
            de: `Ort ${position} „${name}“ gespeichert (${describeLocation(saved)})`,
            es: `Lugar ${position} «${name}» guardado (${describeLocation(saved)})`,
          },
          notPublished,
        );
      }
      return {
        en: `Location ${position} "${name}" added: ${describeLocation(saved)}. Add its device from the Discover tab; "Show my locations" lists them all.`,
        fr: `Lieu ${position} « ${name} » ajouté : ${describeLocation(saved)}. Ajoutez son appareil depuis l'onglet Découverte ; « Afficher mes lieux » les liste tous.`,
        de: `Ort ${position} „${name}“ hinzugefügt: ${describeLocation(saved)}. Füge sein Gerät über den Tab „Entdecken“ hinzu; „Meine Orte anzeigen“ listet alle auf.`,
        es: `Lugar ${position} «${name}» añadido: ${describeLocation(saved)}. Añada su dispositivo desde la pestaña «Descubrir»; «Mostrar mis lugares» los muestra todos.`,
      };
    },

    /**
     * Add every house configured in Gladys that is not watched yet, in one
     * click.
     *
     * WHY IT EXISTS. The user has already placed their home on a map, in
     * Gladys. Making them type their own town again, in another form, to
     * watch the air above that same roof is asking twice for something the
     * core will hand over — see `src/houses.js` for the permission that makes
     * it readable.
     *
     * WHAT IT IS NOT. It is not a sync: the houses are READ once, when the
     * button is clicked, and what comes out is ordinary locations the user
     * renames and deletes like any other. A house moved in Gladys afterwards
     * leaves its location where it was — the same rule as everywhere else
     * here, a point that moved is another location.
     *
     * Nothing is written unless something is actually added, and everything
     * skipped is named: a button that answers "0 added" without saying why is
     * a button the user clicks again.
     *
     * ONE HOUSE OR ALL. The optional `house` field (a select with
     * `source: "houses"`, Gladys 5.2+) names one house by its selector: an
     * instance holding a house the user does not want watched no longer has
     * to import it and remove it. Empty, every house is imported, as before
     * the field existed.
     */
    async import_houses(fields = {}) {
      const selector = String(fields?.house ?? '').trim();
      logger.info(`Action import_houses <- house=${selector === '' ? 'all' : 'one'}`);

      let houses;
      try {
        houses = await listHouses();
      } catch (err) {
        if (err?.code === HOUSE_ACCESS_DENIED) {
          // Not an outage: the INSTALLED manifest never asked for the
          // permission, and only re-installing the integration grants it.
          logger.warn('The house coordinates are not granted to this integration');
          return {
            en: 'Gladys refuses to share the coordinates of your houses with this integration. That access is granted when the integration is installed: update it to a version that asks for it, or remove and re-install it, and accept the request shown on the install screen. Meanwhile "Add a location" works the same way with a town name.',
            fr: "Gladys refuse de partager les coordonnées de vos maisons avec cette intégration. Cet accès s'accorde à l'installation : mettez l'intégration à jour vers une version qui le demande, ou supprimez-la et réinstallez-la en acceptant la demande affichée sur l'écran d'installation. En attendant, « Ajouter un lieu » fait la même chose avec un nom de commune.",
            de: 'Gladys verweigert dieser Integration die Koordinaten deiner Häuser. Dieser Zugriff wird bei der Installation gewährt: Aktualisiere die Integration auf eine Version, die ihn anfordert, oder entferne sie und installiere sie neu, wobei du die Anfrage auf dem Installationsbildschirm annimmst. Bis dahin leistet „Ort hinzufügen“ dasselbe mit einem Ortsnamen.',
            es: 'Gladys se niega a compartir las coordenadas de sus viviendas con esta integración. Ese acceso se concede en la instalación: actualice la integración a una versión que lo solicite, o elimínela y vuelva a instalarla aceptando la solicitud que aparece en la pantalla de instalación. Mientras tanto, «Añadir un lugar» hace lo mismo con el nombre de un municipio.',
          };
        }
        logger.warn('Could not read the houses configured in Gladys', err);
        const reason = shortReason(err);
        return {
          en: `Could not read the houses configured in Gladys: ${reason}. Add the location by its town name instead.`,
          fr: `Impossible de lire les maisons configurées dans Gladys : ${reason}. Ajoutez plutôt le lieu par son nom de commune.`,
          de: `Die in Gladys konfigurierten Häuser konnten nicht gelesen werden: ${reason}. Füge den Ort stattdessen über seinen Namen hinzu.`,
          es: `No se han podido leer las viviendas configuradas en Gladys: ${reason}. Añada el lugar por el nombre de su municipio.`,
        };
      }

      if (houses.length === 0) {
        return {
          en: 'Gladys has no house configured. Create one in Settings > Houses, place it on the map, then click this button again.',
          fr: 'Gladys ne contient aucune maison. Créez-en une dans Réglages > Maisons, placez-la sur la carte, puis relancez cette action.',
          de: 'In Gladys ist kein Haus konfiguriert. Lege eines unter Einstellungen > Zuhause an, platziere es auf der Karte und klicke dann erneut auf diese Schaltfläche.',
          es: 'Gladys no tiene ninguna vivienda configurada. Cree una en Configuración > Viviendas, colóquela en el mapa y vuelva a pulsar este botón.',
        };
      }

      if (selector !== '') {
        // Matched against the houses as they are NOW: one deleted (or
        // renamed, which moves its selector) since the form was opened matches
        // nothing, and importing every house instead would do the opposite of
        // what was asked.
        const picked = houses.filter((house) => house.selector === selector);
        if (picked.length === 0) {
          return {
            en: 'The house you picked no longer exists in Gladys. Pick another one, or leave the field empty to add every house.',
            fr: "La maison choisie n'existe plus dans Gladys. Choisissez-en une autre, ou laissez le champ vide pour ajouter toutes les maisons.",
            de: 'Das gewählte Haus existiert in Gladys nicht mehr. Wähle ein anderes oder lass das Feld leer, um alle Häuser hinzuzufügen.',
            es: 'La vivienda elegida ya no existe en Gladys. Elija otra o deje el campo vacío para añadir todas las viviendas.',
          };
        }
        houses = picked;
      }

      // The whole import is computed against ONE list and written ONCE: a
      // setConfig per house would re-publish the Discovery tab as many times,
      // and a failure halfway would leave half an import behind. Read AFTER
      // the houses came back, so it is the list of now.
      const { locations } = getConfig();
      let updated = locations;
      const addedIds = [];
      const duplicates = [];
      const unlocated = [];
      const uncovered = [];
      const overflow = [];

      for (const house of houses) {
        // A house the user never placed on the map: `latitude` is null, and a
        // null taken as 0 would watch the Gulf of Guinea.
        if (!hasCoordinates(house)) {
          unlocated.push(house);
          continue;
        }
        const duplicate = findLocationAtPoint(updated, house);
        if (duplicate) {
          duplicates.push({ house, location: duplicate });
          continue;
        }
        // Same check as the add action: the global CAMS model covers the
        // planet, so this only ever catches a point that is not one.
        if (!isCovered(house)) {
          uncovered.push(house);
          continue;
        }
        if (updated.length >= MAX_LOCATIONS) {
          overflow.push(house);
          continue;
        }
        const id = newLocationId(updated);
        updated = upsertLocation(updated, {
          id,
          name: house.name,
          // A house is a point, not an address: the geocoder has no reverse
          // endpoint to name the town it sits in, and inventing one would be
          // worse than the coordinates the listing already prints.
          address_label: '',
          latitude: house.latitude,
          longitude: house.longitude,
        });
        addedIds.push(id);
      }

      const notPublished = addedIds.length > 0 ? await commit(updated) : null;

      const current = getConfig().locations;
      const lines = addedIds
        .map((id) => findLocationById(current, id))
        .map((location) =>
          locationLine(positionOf(current, location.id), location.name, locationDetail(location)),
        )
        .join(LOCATION_LINE_SEPARATOR);

      // Every house that did NOT become a location gets a sentence naming it.
      const notes = byLanguage((language) => {
        const text = inLanguage(IMPORT_NOTES, language);
        let note = '';
        if (duplicates.length > 0) {
          const list = duplicates
            .map(({ house, location }) =>
              text.duplicate(
                quote(house.name, language),
                positionOf(current, location.id),
                quote(location.name, language),
              ),
            )
            .join(', ');
          note += text.duplicates(list);
        }
        if (unlocated.length > 0) {
          note += text.unlocated(quoteNames(unlocated, language));
        }
        if (uncovered.length > 0) {
          note += text.uncovered(quoteNames(uncovered, language));
        }
        if (overflow.length > 0) {
          note += text.overflow(quoteNames(overflow, language));
        }
        return note;
      });

      if (notPublished) {
        return savedButNotPublished(
          {
            en: `${addedIds.length} Gladys house(s) saved as locations`,
            fr: `${addedIds.length} maison(s) Gladys enregistrée(s) comme lieux`,
            de: `${addedIds.length} Gladys-Haus/Häuser als Orte gespeichert`,
            es: `${addedIds.length} vivienda(s) de Gladys guardada(s) como lugares`,
          },
          notPublished,
          `${LOCATION_LINE_SEPARATOR}${lines}`,
        );
      }
      if (addedIds.length === 0) {
        return {
          en: `No house to add: your ${houses.length} Gladys house(s) are already watched or cannot be.${notes.en}`,
          fr: `Aucune maison à ajouter : vos ${houses.length} maison(s) Gladys sont déjà surveillées ou ne peuvent pas l'être.${notes.fr}`,
          de: `Kein Haus hinzuzufügen: Deine ${houses.length} Gladys-Haus/Häuser werden bereits überwacht oder können nicht überwacht werden.${notes.de}`,
          es: `Ninguna vivienda que añadir: sus ${houses.length} vivienda(s) de Gladys ya están vigiladas o no pueden estarlo.${notes.es}`,
        };
      }
      return {
        en: `${addedIds.length} Gladys house(s) added. Add their devices from the Discover tab:${LOCATION_LINE_SEPARATOR}${lines}${notes.en}`,
        fr: `${addedIds.length} maison(s) Gladys ajoutée(s). Ajoutez leurs appareils depuis l'onglet Découverte :${LOCATION_LINE_SEPARATOR}${lines}${notes.fr}`,
        de: `${addedIds.length} Gladys-Haus/Häuser hinzugefügt. Füge die Geräte über den Tab „Entdecken“ hinzu:${LOCATION_LINE_SEPARATOR}${lines}${notes.de}`,
        es: `${addedIds.length} vivienda(s) de Gladys añadida(s). Añada sus dispositivos desde la pestaña «Descubrir»:${LOCATION_LINE_SEPARATOR}${lines}${notes.es}`,
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
          de: 'Noch kein Ort. Füge einen mit „Ort hinzufügen“ hinzu.',
          es: 'Todavía no hay ningún lugar. Añada uno con «Añadir un lugar».',
        };
      }
      const listing = describeLocations(locations);
      return {
        en: `${locations.length}/${MAX_LOCATIONS} location(s), as "${LOCATION_LINE_MARKER}number. name — place (latitude, longitude)":${LOCATION_LINE_SEPARATOR}${listing}`,
        fr: `${locations.length}/${MAX_LOCATIONS} lieu(x), au format « ${LOCATION_LINE_MARKER}numéro. nom — lieu (latitude, longitude) » :${LOCATION_LINE_SEPARATOR}${listing}`,
        de: `${locations.length}/${MAX_LOCATIONS} Ort(e), im Format „${LOCATION_LINE_MARKER}Nummer. Name — Ort (Breitengrad, Längengrad)“:${LOCATION_LINE_SEPARATOR}${listing}`,
        es: `${locations.length}/${MAX_LOCATIONS} lugar(es), con el formato «${LOCATION_LINE_MARKER}número. nombre — lugar (latitud, longitud)»:${LOCATION_LINE_SEPARATOR}${listing}`,
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
          de: 'Noch kein Ort. Füge einen mit „Ort hinzufügen“ hinzu.',
          es: 'Todavía no hay ningún lugar. Añada uno con «Añadir un lugar».',
        };
      }

      const location = locationAtPosition(locations, fields.location);
      if (!location) {
        return {
          en: `There is no location ${fields.location}. Configured: ${describeLocations(locations)}`,
          fr: `Il n'y a pas de lieu ${fields.location}. Configurés : ${describeLocations(locations)}`,
          de: `Es gibt keinen Ort ${fields.location}. Konfiguriert: ${describeLocations(locations)}`,
          es: `No existe el lugar ${fields.location}. Configurados: ${describeLocations(locations)}`,
        };
      }
      if (fields.confirmation !== true) {
        // One click away from losing a location, in a screen full of buttons:
        // the checkbox is what makes it deliberate.
        return {
          en: `Tick "I confirm" to delete location ${fields.location} "${location.name}" (${describeLocation(location)}).`,
          fr: `Cochez « Je confirme » pour supprimer le lieu ${fields.location} « ${location.name} » (${describeLocation(location)}).`,
          de: `Setze das Häkchen bei „Ich bestätige“, um Ort ${fields.location} „${location.name}“ zu entfernen (${describeLocation(location)}).`,
          es: `Marque «Confirmo» para eliminar el lugar ${fields.location} «${location.name}» (${describeLocation(location)}).`,
        };
      }

      // Asked BEFORE the re-publish, while the location still has an
      // external_id to look for: a device the user has already created is the
      // one case an integration cannot clean up, and it must say so precisely
      // rather than leave a sensor that never updates again.
      const created = await createdDeviceOf(location);
      // RE-READ after that request: remove from the list of now, not from
      // the one read before it.
      const current = getConfig().locations;
      const notPublished = await commit(removeLocation(current, location.id));
      if (notPublished) {
        return savedButNotPublished(
          {
            en: `Location "${location.name}" removed`,
            fr: `Lieu « ${location.name} » supprimé`,
            de: `Ort „${location.name}“ entfernt`,
            es: `Lugar «${location.name}» eliminado`,
          },
          notPublished,
        );
      }

      // Deleting the third of four locations moves the fourth up a rank, and
      // those numbers are what this very dropdown offers.
      const renumbered =
        positionOf(current, location.id) < current.length
          ? {
              en: ' The locations after it moved up one rank: run "Show my locations" before deleting another one.',
              fr: " Les lieux suivants remontent d'un rang : lancez « Afficher mes lieux » avant d'en supprimer un autre.",
              de: ' Die nachfolgenden Orte rücken um eine Nummer auf: Führe „Meine Orte anzeigen“ aus, bevor du einen weiteren entfernst.',
              es: ' Los lugares siguientes suben un puesto: ejecute «Mostrar mis lugares» antes de eliminar otro.',
            }
          : { en: '', fr: '', de: '', es: '' };

      if (!created) {
        // Never created: re-publishing the list without it is enough, the
        // Discovery screen stops offering it on the spot.
        return {
          en: `Location "${location.name}" removed, and it is no longer offered in the Discover tab.${renumbered.en}`,
          fr: `Lieu « ${location.name} » supprimé, et il n'est plus proposé dans l'onglet Découverte.${renumbered.fr}`,
          de: `Ort „${location.name}“ entfernt; er wird im Tab „Entdecken“ nicht mehr angeboten.${renumbered.de}`,
          es: `Lugar «${location.name}» eliminado; ya no se ofrece en la pestaña «Descubrir».${renumbered.es}`,
        };
      }
      // An integration can only stop OFFERING a device; deleting one the user
      // created is not something the host API lets it do, at any version.
      return {
        en: `Location "${location.name}" removed. Its device "${created.name}" still exists in Gladys and will stop updating: delete it yourself from the integration's Devices tab — an integration is not allowed to delete a device.${renumbered.en}`,
        fr: `Lieu « ${location.name} » supprimé. Son appareil « ${created.name} » existe toujours dans Gladys et ne se mettra plus à jour : supprimez-le vous-même depuis l'onglet Appareils de l'intégration — une intégration n'a pas le droit de supprimer un appareil.${renumbered.fr}`,
        de: `Ort „${location.name}“ entfernt. Sein Gerät „${created.name}“ existiert in Gladys weiterhin und wird nicht mehr aktualisiert: Lösche es selbst im Tab „Geräte“ der Integration — eine Integration darf kein Gerät löschen.${renumbered.de}`,
        es: `Lugar «${location.name}» eliminado. Su dispositivo «${created.name}» sigue existiendo en Gladys y dejará de actualizarse: elimínelo usted mismo desde la pestaña «Dispositivos» de la integración; una integración no puede eliminar un dispositivo.${renumbered.es}`,
      };
    },
  };

  /**
   * Write the list back once if an entry was stored without an id.
   *
   * `normalizeLocations` gives such an entry a random id, a NEW one at every
   * read, and that id is its device's external_id: unwritten, the device the
   * user created would be orphaned at the next restart. Called with the raw
   * stored value whenever a configuration is loaded, BEFORE the devices are
   * published, so they are published under the ids that are kept. Queued with
   * the actions, so it never races one of them; it writes the in-memory list,
   * whose ids are the ones generated at that load. Never throws: a failed
   * write is logged, and the next load tries again.
   * @param {unknown} storedLocations the `locations` value as it was stored
   * @returns {Promise<boolean>} whether the list was written
   */
  function persistGeneratedIds(storedLocations) {
    return exclusive(async () => {
      if (!locationsMissingIds(storedLocations)) {
        return false;
      }
      try {
        const { locations } = getConfig();
        await setConfig({ [LOCATIONS_KEY]: serializeLocations(locations) });
        logger.info(`Stored the ids generated for ${locations.length} location(s)`);
        return true;
      } catch (err) {
        logger.error('Could not store the generated location ids', err);
        return false;
      }
    });
  }

  return {
    actions: Object.fromEntries(
      Object.entries(handlers).map(([key, handler]) => [
        key,
        (fields) => exclusive(() => handler(fields)),
      ]),
    ),
    persistGeneratedIds,
  };
}
