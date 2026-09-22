// -----------------------------------------------------------------------------
// Scene ACTIONS: what a scene can ASK this integration to do.
//
// Two of them, and the first is the reason the second exists:
//
//   - `get_air_quality` reads a location NOW and hands the scene the class, the
//     dominant pollutant and a ready-made sentence. That is what turns "every
//     day at 7 am" into "every day at 7 am, tell me the air quality": a scene
//     can read a device feature, but it cannot turn 4 into "indice 4/6
//     (Mauvais), dominant Ozone (O₃)" on its own.
//   - `refresh_air_quality` re-reads and republishes, for the scene that wants
//     a fresh value before looking at the features themselves.
//
// Two rules of the contract shape the code below:
//
//   - AN ACTION IS NEVER A CONDITION. Throwing fails this action only; the
//     scene logs it and runs the next one anyway. So "no data" is an OUTPUT
//     (`level: null`) the scene author can test, not an exception. Only a
//     genuinely broken call — an unknown device, an unreachable provider —
//     throws.
//   - OUTPUTS ARE SCALARS, under the declared keys: the core drops everything
//     else and coerces each value to its declared type.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { readAirQuality } from '../airQuality/index.js';
import { pollutantName } from '../airQuality/scale.js';
import { formatMeasuredAt } from '../datetime.js';
import {
  findLocationByDeviceId,
  refreshLocations,
  watchedLocations,
} from '../devices/airQualityStation.js';
import { levelLabel, noDataSummary, overallSummary, pollutantSummary } from '../indexText.js';
import { DEFAULT_LANGUAGE } from '../language.js';
import { nudgeWidgets } from '../widgets/keys.js';

const logger = createLogger({ name: 'scene-actions' });

/** The `pollutant` option that means "the worst pollutant of the moment". */
export const OVERALL_POLLUTANT = 'overall';

/** A concentration is a number or nothing: `Number(null)` is a clean sky. */
function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * The location a scene field designates, or a thrown error naming the id.
 *
 * Throwing is right here: a scene pointing at a device this integration no
 * longer watches is a scene to fix, and the message is what the scene log
 * shows its author.
 */
function requireLocation(gladys, config, externalId) {
  const location = findLocationByDeviceId(gladys, config, String(externalId ?? ''));
  if (!location) {
    throw new Error(`No location watches the device ${externalId}`);
  }
  return location;
}

export const SCENE_ACTION_HANDLERS = {
  /**
   * Read one location and answer the declared outputs.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ fields: Record<string, unknown>, config: object }} context
   */
  async get_air_quality(gladys, { fields, config }) {
    const language = config.language ?? DEFAULT_LANGUAGE;
    const location = requireLocation(gladys, config, fields?.location);
    const wanted = String(fields?.pollutant ?? OVERALL_POLLUTANT);
    logger.info(`Scene action get_air_quality -> ${location.name} (${wanted})`);

    const reading = await readAirQuality(location);
    const measuredAt = formatMeasuredAt(reading.measuredAt, language, reading.timeZone) ?? '';

    // Which number the scene asked for: the worst pollutant of the moment, or
    // one named gas.
    const overall = wanted === OVERALL_POLLUTANT;
    const level = overall ? reading.overall.level : (reading.subIndexes?.[wanted] ?? null);
    // For the overall reading the pollutant is the DOMINANT one, which is null
    // at class 1 — naming one there would be inventing it.
    const pollutant = overall ? reading.overall.pollutant : wanted;

    if (level === null || level === undefined) {
      // The model has no value for this point, or for this pollutant. Not a
      // failure: an output the scene can branch on.
      return {
        level: null,
        level_label: '',
        pollutant: overall ? '' : wanted,
        pollutant_name: overall ? '' : pollutantName(wanted, language),
        concentration: null,
        location_name: location.name,
        measured_at: measuredAt,
        summary: noDataSummary({ locationName: location.name }, language),
      };
    }

    return {
      level,
      level_label: levelLabel(level, language),
      pollutant: pollutant ?? '',
      pollutant_name: pollutant ? pollutantName(pollutant, language) : '',
      concentration: pollutant ? numberOrNull(reading.concentrations?.[pollutant]) : null,
      location_name: location.name,
      measured_at: measuredAt,
      summary: overall
        ? overallSummary({ locationName: location.name, level, pollutant }, language)
        : pollutantSummary({ locationName: location.name, pollutant: wanted, level }, language),
    };
  },

  /**
   * Re-read one location, or every one of them, and republish the states.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ fields: Record<string, unknown>, config: object }} context
   */
  async refresh_air_quality(gladys, { fields, config }) {
    const language = config.language ?? DEFAULT_LANGUAGE;
    // An empty `location` is the wildcard the field documents: every location.
    const chosen = String(fields?.location ?? '').trim();
    const locations = chosen ? [requireLocation(gladys, config, chosen)] : watchedLocations(config);
    logger.info(`Scene action refresh_air_quality -> ${locations.length} location(s)`);

    // One location failing must not cost the others their refresh: the scene
    // gets the two counts rather than a stack trace.
    const counts = await refreshLocations(gladys, locations, language);
    nudgeWidgets(gladys);
    return counts;
  },
};
