// -----------------------------------------------------------------------------
// Device type: AIR QUALITY STATION.
//
// One device per configured location. Unlike the template's device blueprints,
// the device list is not known at build time: it is a projection of
// `config.locations`, so every function here works on the locations of the
// configuration it is handed.
//
// FEATURES, and why they are what they are:
//   - the overall INDEX (1-6) — the one to use in a scene, "should I close the
//     windows?" answered by a single number;
//   - the same thing as TEXT ("Bon", "Dégradé"...), because a bare 4 on a
//     dashboard tells you nothing, and the core has no label set for this
//     category;
//   - the DOMINANT POLLUTANT as text, because the index is the worst pollutant
//     and knowing which one is half the information;
//   - one SUB-INDEX per pollutant, which is literally what the index is made
//     of, and what lets a scene watch ozone alone in summer;
//   - the raw CONCENTRATION of every pollutant in µg/m³, because a sub-index is
//     a band and a band hides the trend inside it: an ozone afternoon climbing
//     from 55 to 128 µg/m³ never leaves class 3. Each of the five has its own
//     Gladys category — `pm25-sensor`, `pm10-sensor`, and the `no2-sensor`,
//     `o3-sensor`, `so2-sensor` the core gained for the three gases;
//   - the hour the data itself was produced, as text. It belongs HERE, on every
//     device, rather than on one integration-wide device: it is the hour of the
//     model run over THAT point, in the local time of THAT point, so two
//     locations can legitimately disagree — and a global "last refresh" would
//     say the timer fired, not that this location got a fresh number.
//
// The identity of a device is `<type>:<location id>`, and the location id is
// generated once when the user adds the location: renaming a location keeps the
// device, its history and its place in the rooms and scenes.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  allPollutants,
  findProvider,
  prefetchAirQuality,
  readAirQuality,
} from '../airQuality/index.js';
import {
  CONCENTRATION_MAX,
  INDEX_LABELS,
  INDEX_MAX,
  INDEX_MIN,
  pollutantName,
} from '../airQuality/scale.js';
import { formatMeasuredAt } from '../datetime.js';
import { DEFAULT_LANGUAGE, inLanguage } from '../language.js';
import { shortReason } from '../reason.js';
import { publishIndexEvents } from '../scenes/indexEvents.js';
import { nudgeWidgets } from '../widgets/keys.js';
import {
  describeLocation,
  LOCATION_LINE_SEPARATOR,
  locationLine,
  positionOf,
  usableLocations,
} from '../locations.js';

export const DEVICE_TYPE = 'air-quality-station';

const logger = createLogger({ name: DEVICE_TYPE });

// When a location could not be read, how long to wait before trying THAT
// location again — once after 30 s, once more after 2 min, then nothing until
// the next scheduled cycle. The interval is at least 15 min: without these, a
// timeout or a 502 from a free public API would leave a device without a value
// for a whole cycle. Two short tries absorb a blip; more would hammer a
// service that is really down. A `Retry-After` sent with a 429 lengthens the
// wait, and a retry that would land after the next cycle is not scheduled.
export const RETRY_DELAYS_MS = [30_000, 120_000];

/** Non-pollutant features. Prefixed to never collide with a pollutant key. */
export const FEATURE = {
  INDEX: 'index',
  INDEX_TEXT: 'index-text',
  DOMINANT_POLLUTANT: 'dominant-pollutant',
  MEASURED_AT: 'measured-at',
};

/** Suffix of the per-pollutant features, so the two never share an id. */
const SUB_INDEX_SUFFIX = 'sub-index';
const CONCENTRATION_SUFFIX = 'concentration';

/**
 * The three gas categories the core gained WITH this feature, spelled out
 * because the SDK did not carry them when they were adopted (0.14.0 exports
 * them, and the `??` below picks the constant up).
 *
 * The literal IS the contract: `setDiscoveredDevices` validates `category`
 * against `DEVICE_FEATURE_CATEGORIES_LIST`, a flat list of these very strings,
 * so the SDK constant is a convenience and not the authority. The `??` picks
 * the constant up on its own the day the SDK ships it, and the manifest's
 * `gladys_version` is what keeps an older core — which would refuse the WHOLE
 * batch on an unknown category — from ever seeing them.
 */
const NO2_SENSOR = DEVICE_FEATURE_CATEGORIES.NO2_SENSOR ?? 'no2-sensor';
const O3_SENSOR = DEVICE_FEATURE_CATEGORIES.O3_SENSOR ?? 'o3-sensor';
const SO2_SENSOR = DEVICE_FEATURE_CATEGORIES.SO2_SENSOR ?? 'so2-sensor';

/**
 * Category of the concentration feature of each pollutant. Every one of the
 * five now has a dedicated one, so the concentrations get their icon, their
 * label, their colour bands and their place in the "climate" group of the
 * history — no `unknown` fallback anywhere.
 *
 * Do NOT reach for `no2-matter-index-sensor` for NO₂: despite the name it is an
 * INTEGER Matter index (unknown/low/medium/high/critical), not a
 * concentration, and the front would render a µg/m³ value as one of those five
 * words. `no2-sensor` is the concentration category.
 */
const CONCENTRATION_CATEGORIES = {
  pm2_5: DEVICE_FEATURE_CATEGORIES.PM25_SENSOR,
  pm10: DEVICE_FEATURE_CATEGORIES.PM10_SENSOR,
  nitrogen_dioxide: NO2_SENSOR,
  ozone: O3_SENSOR,
  sulphur_dioxide: SO2_SENSOR,
};

/** Names of the features that are not about one pollutant. */
const FEATURE_NAMES = {
  [FEATURE.INDEX]: { en: 'Air quality index', fr: "Indice de qualité de l'air" },
  [FEATURE.INDEX_TEXT]: { en: 'Air quality (text)', fr: "Qualité de l'air (texte)" },
  [FEATURE.DOMINANT_POLLUTANT]: { en: 'Dominant pollutant', fr: 'Polluant dominant' },
  [FEATURE.MEASURED_AT]: { en: 'Last data update', fr: 'Dernière mise à jour des données' },
};

/** How the name of a pollutant becomes the name of its sub-index feature. */
const SUB_INDEX_FEATURE_NAME = {
  en: (name) => `${name} sub-index`,
  fr: (name) => `Sous-indice ${name}`,
};

/** What the "dominant pollutant" feature says when the air is good. */
const NO_DOMINANT_POLLUTANT = { en: 'None', fr: 'Aucun' };

/** External ids of the device of a location. */
export function deviceExternalIds(gladys, location) {
  return gladys.externalIds(DEVICE_TYPE, location.id);
}

/**
 * The locations a device can be published for: a usable point, covered by an
 * air quality provider.
 *
 * Coverage is checked when the location is added, but a stored one can carry a
 * point no provider answers for — and publishing a device the source says
 * nothing about would leave a sensor stuck on "no recent value" forever.
 * @param {{ locations: import('../locations.js').Location[] }} config
 */
export function watchedLocations(config) {
  return usableLocations(config.locations).filter((location) => Boolean(findProvider(location)));
}

/**
 * The location a device external_id designates, or undefined.
 *
 * Every `source: "devices"` field — a widget setting, a scene trigger filter, a
 * scene action field — stores a device external_id, and this is the single
 * place that maps one back to a location.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('../locations.js').Location[] }} config
 * @param {unknown} externalId
 */
export function findLocationByDeviceId(gladys, config, externalId) {
  return watchedLocations(config).find(
    (candidate) => deviceExternalIds(gladys, candidate).device === externalId,
  );
}

/** Shape shared by every index feature: a read-only 1-6 class. */
function indexFeature(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.AIRQUALITY_SENSOR.AQI,
    unit: DEVICE_FEATURE_UNITS.AQI,
    // `t_device_feature.min`/`max` are NOT NULL with no default in the core: a
    // feature without them is refused when the user adds the device.
    min: INDEX_MIN,
    max: INDEX_MAX,
    read_only: true, // sensor: no action possible
    has_feedback: false,
    keep_history: true, // keep history to draw the episodes on a chart
  };
}

/** Shape shared by every concentration feature: a read-only µg/m³ decimal. */
function concentrationFeature(externalId, name, category, max) {
  return {
    name,
    external_id: externalId,
    category,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER,
    min: 0,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/** Shape shared by every text feature. */
function textFeature(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // Meaningless for a label, but the core columns are NOT NULL (see above).
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false, // a label, not a measure: nothing to chart
  };
}

/** External id of the sub-index feature of a pollutant. */
export function subIndexFeatureId(ids, pollutant) {
  return ids.feature(`${pollutant}-${SUB_INDEX_SUFFIX}`);
}

/** External id of the concentration feature of a pollutant. */
export function concentrationFeatureId(ids, pollutant) {
  return ids.feature(`${pollutant}-${CONCENTRATION_SUFFIX}`);
}

/**
 * Build the discovery payload of one location.
 *
 * The names are written in the configured language and nowhere else: a device
 * name and a feature name are plain strings the core copies into its own tables
 * when the user creates the device, so this is the ONE place where the
 * integration has to pick a language instead of handing Gladys `{ en, fr }`.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location} location
 * @param {string} [language] one of LANGUAGES (see src/language.js)
 */
export function buildDevice(gladys, location, language = DEFAULT_LANGUAGE) {
  const ids = deviceExternalIds(gladys, location);
  const featureName = (key) => inLanguage(FEATURE_NAMES[key], language);
  const deviceName = language === 'en' ? 'Air quality' : "Qualité de l'air";

  return {
    name: `${deviceName} — ${location.name}`,
    external_id: ids.device,
    // NO poll_frequency on purpose: the core only accepts a fixed enum of
    // intervals in MILLISECONDS, capped at one minute, and anything else has
    // the WHOLE batch refused — which is what leaves the Discovery tab empty.
    // The analysis is hourly, so the integration drives its own refresh
    // instead; see startPolling below.
    //
    // Keep the resolved place and position on the device: useful when debugging
    // a wrong town, and it survives a restart independently of the
    // configuration.
    params: [
      { name: 'LOCATION_ID', value: location.id },
      { name: 'LOCATION_NAME', value: location.name },
      { name: 'ADDRESS_LABEL', value: location.address_label ?? '' },
      { name: 'LATITUDE', value: String(location.latitude) },
      { name: 'LONGITUDE', value: String(location.longitude) },
    ],
    features: [
      // The one to use in a scene: the class of the worst pollutant.
      indexFeature(ids.feature(FEATURE.INDEX), featureName(FEATURE.INDEX)),
      textFeature(ids.feature(FEATURE.INDEX_TEXT), featureName(FEATURE.INDEX_TEXT)),
      textFeature(ids.feature(FEATURE.DOMINANT_POLLUTANT), featureName(FEATURE.DOMINANT_POLLUTANT)),
      textFeature(ids.feature(FEATURE.MEASURED_AT), featureName(FEATURE.MEASURED_AT)),
      ...allPollutants().map((pollutant) =>
        indexFeature(
          subIndexFeatureId(ids, pollutant),
          inLanguage(SUB_INDEX_FEATURE_NAME, language)(pollutantName(pollutant, language)),
        ),
      ),
      ...allPollutants()
        .filter((pollutant) => CONCENTRATION_CATEGORIES[pollutant])
        .map((pollutant) =>
          concentrationFeature(
            concentrationFeatureId(ids, pollutant),
            pollutantName(pollutant, language),
            CONCENTRATION_CATEGORIES[pollutant],
            CONCENTRATION_MAX[pollutant],
          ),
        ),
    ],
  };
}

/**
 * Build the `publishStates` batch of one location from a provider reading.
 * Split out of `poll()` so the mapping "reading -> states" is testable without
 * a Gladys connection.
 *
 * The TEXT states are written in the same language as the features that
 * carry them: a stored state is a string like a feature name, translated by
 * nobody downstream.
 * @param {string} [language] one of LANGUAGES (see src/language.js)
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function buildStates(ids, reading, language = DEFAULT_LANGUAGE) {
  const states = [];

  for (const [pollutant, level] of Object.entries(reading.subIndexes)) {
    // A pollutant the source has no value for publishes nothing at all: an
    // absent measurement is not a good air quality, and writing 1 would pollute
    // the history and could fire an "air is clean again" scene.
    if (level !== null && level !== undefined) {
      states.push({ device_feature_external_id: subIndexFeatureId(ids, pollutant), state: level });
    }
  }

  for (const [pollutant, concentration] of Object.entries(reading.concentrations)) {
    if (
      concentration !== null &&
      concentration !== undefined &&
      CONCENTRATION_CATEGORIES[pollutant]
    ) {
      states.push({
        device_feature_external_id: concentrationFeatureId(ids, pollutant),
        state: concentration,
      });
    }
  }

  if (reading.overall.level !== null) {
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURE.INDEX),
        state: reading.overall.level,
      },
      {
        device_feature_external_id: ids.feature(FEATURE.INDEX_TEXT),
        text: inLanguage(INDEX_LABELS[reading.overall.level], language),
      },
      {
        device_feature_external_id: ids.feature(FEATURE.DOMINANT_POLLUTANT),
        text: reading.overall.pollutant
          ? pollutantName(reading.overall.pollutant, language)
          : inLanguage(NO_DOMINANT_POLLUTANT, language),
      },
    );
  }

  // The freshness of the numbers above, published only when there ARE numbers
  // above: "updated at 12:00" next to a device holding nothing would date a
  // measurement that was never made.
  if (states.length > 0) {
    const measuredAt = formatMeasuredAt(reading.measuredAt, language, reading.timeZone);
    if (measuredAt) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.MEASURED_AT),
        text: measuredAt,
      });
    }
  }

  return states;
}

/**
 * Read one location and publish its states.
 * Throws on an unreadable answer — `refresh` is what never throws.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location} location
 * @param {string} [language] language of the published TEXT states
 */
export async function poll(gladys, location, language = DEFAULT_LANGUAGE) {
  const ids = deviceExternalIds(gladys, location);
  logger.info(`Polling air quality for ${location.name}...`);

  // ------------------------------------------------------------------ //
  // DO THE WORK: read the pollutant concentrations and grade them.
  // ------------------------------------------------------------------ //
  const reading = await readAirQuality(location);

  const states = buildStates(ids, reading, language);
  if (states.length === 0) {
    logger.warn(`No air quality data for ${location.name}, nothing published`);
    return reading;
  }

  // The logs stay English whatever the devices are named: they are read in the
  // container output, next to the SDK's own.
  const label = INDEX_LABELS[reading.overall.level]?.en ?? 'unknown';
  logger.info(
    `${location.name}: index ${reading.overall.level} (${label})` +
      `${reading.overall.pollutant ? `, dominant ${pollutantName(reading.overall.pollutant, 'en')}` : ''}`,
  );

  // One request for every feature of the device (batch, up to 100).
  await gladys.publishStates(states);

  // Then the scene triggers, which are about what MOVED rather than about what
  // the values are: never throws, so a refused event costs nothing.
  await publishIndexEvents(gladys, {
    location,
    deviceExternalId: ids.device,
    reading,
    language,
  });
  return reading;
}

/**
 * Read a list of locations and publish what they answer, turning each failure
 * into an outcome instead of a rejection: one location failing must never cost
 * the others their refresh.
 *
 * The ONE loop every refresh goes through — the scheduled cycle, its retries,
 * the scene action, the widget buttons, a device just created. The points are
 * read ahead first, one request per CAMS domain rather than one per location
 * (`prefetchAirQuality`); `poll` then finds each answer in the cache.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location[]} locations
 * @param {string} [language] language of the published TEXT states
 * @returns {Promise<Array<{ location: import('../locations.js').Location, error: unknown }>>}
 *   one outcome per location, `error` null when it was refreshed
 */
async function pollEach(gladys, locations, language = DEFAULT_LANGUAGE) {
  prefetchAirQuality(locations);
  return Promise.all(
    locations.map(async (location) => {
      try {
        await poll(gladys, location, language);
        return { location, error: null };
      } catch (err) {
        logger.error(`Air quality refresh failed for ${describeLocation(location)}`, err);
        return { location, error: err ?? new Error('unknown failure') };
      }
    }),
  );
}

/**
 * Refresh a list of locations ON DEMAND and count the outcome.
 *
 * Shared by the scene action, the widget buttons and the device creation,
 * because they all owe their caller a count rather than a stack trace. The
 * scheduled cycle has its own reporting (see `refresh`).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location[]} locations
 * @param {string} [language] language of the published TEXT states
 * @returns {Promise<{ refreshed: number, failed: number }>}
 */
export async function refreshLocations(gladys, locations, language = DEFAULT_LANGUAGE) {
  const outcomes = await pollEach(gladys, locations, language);
  const failed = outcomes.filter((outcome) => outcome.error).length;
  return { refreshed: outcomes.length - failed, failed };
}

/** Why a location could not be read, WITHOUT naming it (the line already does). */
function failureDetail(err) {
  const reason = shortReason(err, 120);
  return {
    en: `air quality refresh failed: ${reason}`,
    fr: `le rafraîchissement de la qualité de l'air a échoué : ${reason}`,
  };
}

/** The same reason, named, for the one-line connection status. */
function failureMessage(err, locationName) {
  const detail = failureDetail(err);
  return {
    en: `${locationName}: ${detail.en}`,
    fr: `${locationName} : ${detail.fr}`,
  };
}

const NO_LOCATION_MESSAGE = {
  en: 'No location with usable coordinates yet. Add one with "Add a location".',
  fr: 'Aucun lieu avec des coordonnées utilisables. Ajoutez-en un avec « Ajouter un lieu ».',
};

/**
 * A header plus one line per location, in both languages — EXACTLY the format
 * of the location listing (`• n. name — detail`, built by the same
 * `locationLine`), because both actions answer about the same list under the
 * same numbers.
 */
function report(header, lines) {
  const join = (language) =>
    lines
      .map((line) => locationLine(line.position, line.name, line[language]))
      .join(LOCATION_LINE_SEPARATOR);
  return {
    en: `${header.en}${LOCATION_LINE_SEPARATOR}${join('en')}`,
    fr: `${header.fr}${LOCATION_LINE_SEPARATOR}${join('fr')}`,
  };
}

/**
 * Run `read` on every location, turning a failure into a LINE rather than into
 * a rejection: one location the provider refuses must not hide the answer of
 * the others, and a bare error naming no location helps nobody.
 */
async function readEachLocation(config, locations, read) {
  const lines = await Promise.all(
    locations.map(async (location) => {
      const entry = { position: positionOf(config.locations, location.id), name: location.name };
      try {
        return { ...entry, failed: false, ...(await read(location)) };
      } catch (err) {
        logger.error(`Air quality query failed for ${location.name}`, err);
        return { ...entry, failed: true, ...failureDetail(err) };
      }
    }),
  );
  return { lines, failed: lines.filter((line) => line.failed).length };
}

/**
 * One refresh cycle over `locations`, reported in the Supervision screen.
 * NEVER throws: it runs inside a timer callback, where a rejection would take
 * the container down; outages go through `setConnectionStatus` instead.
 * @returns {Promise<Array<{ location: object, error: unknown }>>} the failures
 */
async function refreshCycle(gladys, config, locations) {
  const outcomes = await pollEach(gladys, locations, config.language);

  // The device-bound gauge of the station card follows the published states
  // on its own; its status rows and its forecast curve do not, so one nudge
  // per cycle tells the open dashboards to re-pull them.
  nudgeWidgets(gladys);

  const failures = outcomes.filter((outcome) => outcome.error);
  if (failures.length === 0) {
    await gladys.setConnectionStatus(true).catch(() => {});
    return failures;
  }
  // Only the first reason is spelled out: the status line is one line, and
  // two stack traces in it help nobody.
  const first = failureMessage(failures[0].error, failures[0].location.name);
  const others =
    failures.length > 1
      ? {
          en: ` (+${failures.length - 1} other location(s) failing)`,
          fr: ` (+${failures.length - 1} autre(s) lieu(x) en échec)`,
        }
      : { en: '', fr: '' };
  await gladys
    .setConnectionStatus(false, { en: `${first.en}${others.en}`, fr: `${first.fr}${others.fr}` })
    .catch(() => {});
  return failures;
}

/**
 * How long to wait before the retry number `attempt` (0-based) of these
 * failures: the planned delay, or longer when the server asked for it.
 * @param {Array<{ error: { retryAfterMs?: number } }>} failures
 * @param {number} attempt
 */
export function retryDelay(failures, attempt) {
  const asked = Math.max(
    0,
    ...failures.map(({ error }) => (Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : 0)),
  );
  return Math.max(RETRY_DELAYS_MS[attempt], asked);
}

export const airQualityStation = {
  key: DEVICE_TYPE,

  /** The external_id of ONE location's device, watched or not. */
  locationDeviceId(gladys, location) {
    return deviceExternalIds(gladys, location).device;
  },

  /** Every external_id this type publishes, one per watched location. */
  deviceExternalIds(gladys, config) {
    return watchedLocations(config).map((location) => deviceExternalIds(gladys, location).device);
  },

  buildDevices(gladys, config) {
    return watchedLocations(config).map((location) =>
      buildDevice(gladys, location, config.language),
    );
  },

  // Manifest actions owned by this device type (see the `actions` field of
  // `gladys-assistant-integration.json`).
  actions: {
    /**
     * Live check of the data source, on EVERY location: "is it working?" is a
     * question about the install, not about one entry of a list, and nothing in
     * this screen designates a single location anyway.
     */
    async test_provider(gladys, { config }) {
      const locations = watchedLocations(config);
      if (locations.length === 0) {
        return NO_LOCATION_MESSAGE;
      }
      logger.info(`Action test_provider -> live request for ${locations.length} location(s)`);
      prefetchAirQuality(locations);

      const { lines, failed } = await readEachLocation(config, locations, async (location) => {
        const reading = await readAirQuality(location);
        const level = reading.overall.level;
        if (level === null) {
          return {
            en: 'no value returned for any pollutant',
            fr: 'aucune valeur retournée pour aucun polluant',
          };
        }
        const dominant = reading.overall.pollutant;
        return {
          en:
            `index ${level}/${INDEX_MAX} (${INDEX_LABELS[level].en})` +
            `${dominant ? `, dominant ${pollutantName(dominant, 'en')}` : ''} — ${reading.provider}`,
          fr:
            `indice ${level}/${INDEX_MAX} (${INDEX_LABELS[level].fr})` +
            `${dominant ? `, dominant ${pollutantName(dominant, 'fr')}` : ''} — ${reading.provider}`,
        };
      });

      // "Provider OK" only when it actually is: the header counts the locations
      // that failed, and each of their lines says why.
      const header =
        failed === 0
          ? {
              en: `Air quality provider OK — ${locations.length} location(s):`,
              fr: `Fournisseur de qualité de l'air OK — ${locations.length} lieu(x) :`,
            }
          : {
              en: `Air quality provider — ${failed} of ${locations.length} location(s) failing:`,
              fr: `Fournisseur de qualité de l'air — ${failed} lieu(x) en échec sur ${locations.length} :`,
            };
      return report(header, lines);
    },
  },

  /**
   * Refresh ONE device, on a poll request Gladys sends for it. The devices
   * declare no poll_frequency, so this normally never fires; it stays because a
   * device created by an older version may still carry one.
   * @param {string} externalId external_id of the device to refresh
   */
  async onPoll(gladys, config, externalId) {
    const location = findLocationByDeviceId(gladys, config, externalId);
    if (!location) {
      throw new Error(`No location watches the device ${externalId}`);
    }
    await poll(gladys, location, config.language);
  },

  /**
   * Refresh the device the user just created, and only that one.
   *
   * Until that click the core silently dropped every state published for it
   * (the features did not exist), so it is empty until it is read again.
   * Never throws: a device of another type, or of a location since removed, is
   * simply not refreshed.
   * @param {string} externalId external_id of the created device
   * @returns {Promise<boolean>} whether a location was refreshed
   */
  async refreshDevice(gladys, config, externalId) {
    const location = findLocationByDeviceId(gladys, config, externalId);
    if (!location) {
      return false;
    }
    const { failed } = await refreshLocations(gladys, [location], config.language);
    nudgeWidgets(gladys);
    return failed === 0;
  },

  /**
   * Drive the refresh ourselves.
   *
   * Gladys' own polling is not usable here: `poll_frequency` is a fixed enum of
   * intervals in milliseconds whose slowest value is one minute, while the CAMS
   * analysis is hourly. So the devices declare no poll_frequency and we run our
   * own timer at the configured interval (kept within the manifest bounds,
   * 900-86400 s, by `normalizeConfig`).
   *
   * A location that fails is tried again on its own, after RETRY_DELAYS_MS,
   * rather than left empty until the next cycle.
   * @returns {() => void} cleanup: stops the timer AND any pending retry
   */
  startPolling(gladys, config) {
    const intervalMs = config.poll_frequency * 1000;
    const count = watchedLocations(config).length;
    logger.info(`Refreshing ${count} location(s) every ${Math.round(intervalMs / 1000)} s`);

    let stopped = false;
    let retryTimer = null;
    // Bumped by every scheduled cycle: a retry chain started by an older one
    // must not outlive it.
    let generation = 0;

    const cancelRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    /** One cycle, then the retry of what failed. Never rejects. */
    const run = async (locations, attempt, cycleGeneration) => {
      try {
        const failures = await refreshCycle(gladys, config, locations);
        if (
          stopped ||
          cycleGeneration !== generation ||
          failures.length === 0 ||
          attempt >= RETRY_DELAYS_MS.length
        ) {
          return;
        }
        const delayMs = retryDelay(failures, attempt);
        if (delayMs >= intervalMs) {
          // The next scheduled cycle comes first, and reads them anyway.
          return;
        }
        logger.info(
          `Retrying ${failures.length} location(s) in ${Math.round(delayMs / 1000)} s ` +
            `(attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
        );
        cancelRetry();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          run(
            failures.map((failure) => failure.location),
            attempt + 1,
            cycleGeneration,
          );
        }, delayMs);
      } catch (err) {
        logger.error('Refresh cycle failed', err);
      }
    };

    const scheduled = () => {
      generation += 1;
      cancelRetry();
      run(watchedLocations(config), 0, generation);
    };

    // Refresh straight away: waiting a full hour for the first value would
    // leave a freshly added device empty on the dashboard.
    scheduled();
    const timer = setInterval(scheduled, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
      cancelRetry();
    };
  },

  /**
   * One refresh cycle over every location, which NEVER throws (see
   * `refreshCycle`). No retry is scheduled from here: that is the timer's job.
   * @returns {Promise<Array<{ location: object, error: unknown }>>} the failures
   */
  async refresh(gladys, config) {
    return refreshCycle(gladys, config, watchedLocations(config));
  },
};
