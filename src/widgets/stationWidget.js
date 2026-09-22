// -----------------------------------------------------------------------------
// Dashboard widget: ONE location.
//
// What it adds over the core's "device in a room" box, which already shows the
// features of an air quality station:
//   - it puts the class, the word and the concentration of every pollutant on
//     ONE line each, instead of eleven separate tiles to read one by one;
//   - it can be narrowed to the pollutants the reader actually cares about —
//     ozone in summer, PM in winter — and the number on the gauge then follows
//     that choice;
//   - it draws the hours AHEAD, which no device feature can: a forecast has not
//     happened yet, so the core keeps no history of it. That is exactly what
//     the `chart` component's inline series are for.
//
// The card is built for ONE reader, in the language the core says they read —
// unlike a device name, which is stored once and read by everyone.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { allPollutants, readAirQuality, readAirQualityForecast } from '../airQuality/index.js';
import { INDEX_MAX, INDEX_MIN, overallIndex, pollutantName } from '../airQuality/scale.js';
import { formatMeasuredAt } from '../datetime.js';
import {
  deviceExternalIds,
  FEATURE,
  findLocationByDeviceId,
  refreshLocations,
} from '../devices/airQualityStation.js';
import { levelText } from '../indexText.js';
import { inLanguage } from '../language.js';
import {
  clip,
  CONTENT_TTL_SECONDS,
  emptyState,
  levelColor,
  refreshButton,
  widgetLanguage,
} from './content.js';
import { WIDGET_KEYS } from './keys.js';

const logger = createLogger({ name: WIDGET_KEYS.STATION });

/** A `chart` component takes at most four series; beyond that, one is clearer. */
const MAX_CHART_SERIES = 4;

const NO_LOCATION = {
  en: 'Pick a location in the widget settings.',
  fr: 'Choisissez un lieu dans les réglages du widget.',
};
const NO_DATA = {
  en: 'No air quality data for this location right now.',
  fr: "Aucune donnée de qualité de l'air pour ce lieu actuellement.",
};
const OVERALL_LABEL = { en: 'Air quality', fr: "Qualité de l'air" };
const FILTERED_LABEL = { en: 'Your index', fr: 'Votre indice' };
const DOMINANT_LABEL = { en: 'Dominant', fr: 'Dominant' };
const UNAVAILABLE = { en: 'no value', fr: 'pas de valeur' };
const CHART_TITLE = { en: 'Today and tomorrow', fr: "Aujourd'hui et demain" };

/**
 * The pollutants a widget instance follows: the ticked ones, or all of them.
 *
 * A `multi_select` stores an array of option values; nothing ticked is the
 * wildcard, and an option the code no longer knows is dropped rather than
 * carried into a lookup that would answer undefined.
 * @param {unknown} setting
 * @returns {string[]}
 */
export function selectedPollutants(setting) {
  const every = allPollutants();
  const picked = (Array.isArray(setting) ? setting : [])
    .map(String)
    .filter((pollutant) => every.includes(pollutant));
  return picked.length > 0 ? picked : every;
}

/** Sub-indexes restricted to the pollutants this instance follows. */
function filterIndexes(subIndexes, pollutants) {
  return Object.fromEntries(
    pollutants.map((pollutant) => [pollutant, subIndexes?.[pollutant] ?? null]),
  );
}

/** A concentration, rounded to the tenth the models are meaningful at. */
function formatConcentration(value) {
  return Number.isFinite(value) ? `${Math.round(value * 10) / 10} µg/m³` : null;
}

/**
 * The gauge: the class, on the 1-6 scale of the European index.
 *
 * When the reader follows EVERY pollutant, the tile is bound to the device
 * feature instead of carrying a number: a device-bound tile follows the
 * published states in real time and needs no refresh at all. A filtered
 * instance cannot — no feature holds "the worst of the two pollutants you
 * ticked" — so it carries the value this content computed.
 */
function indexGauge(ids, level, pollutants, language) {
  const everyPollutant = pollutants.length === allPollutants().length;
  const common = {
    type: 'gauge',
    label: inLanguage(everyPollutant ? OVERALL_LABEL : FILTERED_LABEL, language),
    color: levelColor(level),
  };
  return everyPollutant
    ? { ...common, device_feature: ids.feature(FEATURE.INDEX) }
    : { ...common, value: level, min: INDEX_MIN, max: INDEX_MAX };
}

/**
 * The tile naming the pollutant that SETS the class.
 *
 * A gauge says "4", the rows below say what every pollutant is doing, but
 * neither answers the question a reader asks first — "4 because of WHAT?". The
 * dominant pollutant is what `overallIndex()` already picked to build that
 * number.
 *
 * The word is computed here rather than read from the `dominant-pollutant`
 * feature: a stored state carries `config.language`, a card is written in the
 * language of the ONE reader pulling it.
 *
 * Never built at class 1 — `overallIndex()` reports no dominant pollutant
 * there, and naming one would be inventing it.
 */
function dominantTile(pollutant, level, language) {
  return {
    type: 'value',
    label: inLanguage(DOMINANT_LABEL, language),
    // A `value` tile takes 12 characters, which "Dioxyde d'azote (NO₂)" is
    // well past: the short form is the formula the label already implies.
    value: clip(pollutantName(pollutant, language).replace(/^.*\(([^)]+)\)$/, '$1'), 12),
    icon: 'wind',
    color: levelColor(level),
  };
}

/**
 * The class IN WORDS, then one row per followed pollutant, worst first.
 *
 * The gauge above draws a `4` on an arc, which is a shape, not a sentence: the
 * first row spells the very same reading out — "4/6 (Mauvais)" — with the
 * wording `src/indexText.js` gives the scene events and the list card, so the
 * number and the word never disagree. It also guarantees the `status` the one
 * item the core requires of it.
 *
 * Each pollutant row carries its CONCENTRATION next to its class, because a
 * class is a band and a band hides the trend inside it: an ozone afternoon
 * climbing from 55 to 128 µg/m³ never leaves class 3.
 */
function pollutantStatus(subIndexes, concentrations, level, pollutants, language) {
  const everyPollutant = pollutants.length === allPollutants().length;
  const overallRow = {
    label: clip(inLanguage(everyPollutant ? OVERALL_LABEL : FILTERED_LABEL, language), 40),
    value: clip(levelText(level, language), 40),
    color: levelColor(level),
  };

  const rows = pollutants
    .slice()
    // Worst first; a pollutant with no value at all goes last, where it reads
    // as the footnote it is.
    .sort((a, b) => (subIndexes[b] ?? 0) - (subIndexes[a] ?? 0))
    .map((pollutant) => {
      const subIndex = subIndexes[pollutant];
      const concentration = formatConcentration(concentrations?.[pollutant]);
      return {
        label: clip(pollutantName(pollutant, language), 40),
        value: clip(
          subIndex === null || subIndex === undefined
            ? inLanguage(UNAVAILABLE, language)
            : `${levelText(subIndex, language)}${concentration ? ` · ${concentration}` : ''}`,
          40,
        ),
        color: levelColor(subIndex),
      };
    });

  return { type: 'status', items: [overallRow, ...rows] };
}

/**
 * The forecast curve: one series per followed pollutant, or a single "worst of
 * them" series when there are too many to read (which is the default — five
 * pollutants do not fit in four series).
 * @returns {object|null} the chart component, or null when there is nothing to draw
 */
export function forecastChart(hours, pollutants, language) {
  const points = (values) => values.filter((point) => Number.isFinite(point.v));

  const series =
    pollutants.length <= MAX_CHART_SERIES
      ? pollutants.map((pollutant) => ({
          name: clip(pollutantName(pollutant, language), 24),
          points: points(hours.map((hour) => ({ t: hour.t, v: hour.subIndexes?.[pollutant] }))),
        }))
      : [
          {
            name: clip(inLanguage(OVERALL_LABEL, language), 24),
            points: points(
              hours.map((hour) => ({
                t: hour.t,
                v: overallIndex(filterIndexes(hour.subIndexes, pollutants)).level,
              })),
            ),
          },
        ];

  const drawable = series.filter((one) => one.points.length > 0);
  if (drawable.length === 0) {
    return null;
  }
  return {
    type: 'chart',
    // A class holds until the next hour: a step is what it looks like, a
    // smooth line would suggest a value between 3 and 4 that does not exist.
    chart_type: 'stepline',
    title: inLanguage(CHART_TITLE, language),
    series: drawable,
    now_marker: true,
  };
}

export const stationWidget = {
  key: WIDGET_KEYS.STATION,

  /**
   * Build the card of one instance.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} config the integration configuration
   * @param {{ settings: Record<string, unknown>, language?: string }} options
   */
  async getContent(gladys, config, { settings, language } = {}) {
    const lang = widgetLanguage(language, config);
    const location = findLocationByDeviceId(gladys, config, settings?.location);
    if (!location) {
      // Either nothing is picked yet, or the device the instance points at is
      // gone: the same sentence fixes both.
      return emptyState(NO_LOCATION);
    }

    const pollutants = selectedPollutants(settings?.pollutants);
    let reading;
    try {
      reading = await readAirQuality(location);
    } catch (err) {
      // A provider outage costs the card its numbers, never the dashboard its
      // layout: the widget says so and the next pull tries again.
      logger.error(`Widget content failed for ${location.name}`, err);
      return emptyState(NO_DATA);
    }

    const subIndexes = filterIndexes(reading.subIndexes, pollutants);
    const { level, pollutant: dominant } = overallIndex(subIndexes);
    if (level === null) {
      return emptyState(NO_DATA);
    }

    const ids = deviceExternalIds(gladys, location);
    const components = [
      // First, because the core drops what overflows the budget in content
      // order — and because several instances of this widget look alike.
      { type: 'text', variant: 'heading', text: clip(location.name, 40) },
      indexGauge(ids, level, pollutants, lang),
    ];
    if (dominant) {
      components.push(dominantTile(dominant, level, lang));
    }
    components.push(pollutantStatus(subIndexes, reading.concentrations, level, pollutants, lang));

    if (settings?.forecast !== false && settings?.forecast !== 'false') {
      const chart = await stationWidget.buildForecast(location, pollutants, lang);
      if (chart) {
        components.push(chart);
      }
    }

    const measuredAt = formatMeasuredAt(reading.measuredAt, lang, reading.timeZone);
    components.push(
      {
        type: 'text',
        variant: 'caption',
        text: clip(measuredAt ? `CAMS · ${measuredAt}` : 'CAMS', 80),
      },
      refreshButton(),
    );

    return { ttl_seconds: CONTENT_TTL_SECONDS, components };
  },

  /** The curve, or nothing: a missing forecast never costs the card its index. */
  async buildForecast(location, pollutants, language) {
    try {
      const { hours } = await readAirQualityForecast(location);
      return forecastChart(hours, pollutants, language);
    } catch (err) {
      logger.warn(`Forecast unavailable for ${location.name}`, err);
      return null;
    }
  },

  /**
   * The `refresh` pill: re-read this instance's location and republish its
   * states.
   * @returns {Promise<{ en: string, fr: string }>} the toast shown to the user
   */
  async onAction(gladys, config, actionKey, params, { settings } = {}) {
    const location = findLocationByDeviceId(gladys, config, settings?.location);
    if (!location) {
      return { en: 'No location to refresh.', fr: 'Aucun lieu à rafraîchir.' };
    }
    const { failed } = await refreshLocations(gladys, [location], config.language);
    return failed === 0
      ? { en: `${location.name} refreshed.`, fr: `${location.name} rafraîchi.` }
      : {
          en: `Could not refresh ${location.name}.`,
          fr: `Impossible de rafraîchir ${location.name}.`,
        };
  },
};
