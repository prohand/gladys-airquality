// -----------------------------------------------------------------------------
// Scene TRIGGERS: "the air quality index changed".
//
// Why a scene event at all, when the index is already a device feature a Gladys
// scene can watch: a feature trigger answers "the number crossed 4", one
// feature at a time, and hands the scene a bare number. What a user actually
// wants to write is "when the air gets bad at home, tell me WHICH pollutant and
// HOW MUCH" — one card, whatever the gas, with the words already in it. That is
// an event, and the variables it declares are what make the message writable
// ({{triggerEvent.data.summary}}).
//
// The doctrine that shapes everything here:
//
//   - ONE EVENT PER TRANSITION. The refresh cycle re-reads the same analysis
//     every hour and CAMS only produces one per hour, so firing on every
//     reading would fire the same event all day. Only a class that actually
//     MOVED is an event; the classes themselves stay device states.
//   - NOTHING ON THE FIRST READING. Right after a restart the previous class is
//     unknown, and "unknown -> 4" is not a transition: it would fire every
//     trigger of every location at boot, which is exactly the notification
//     storm a user remembers.
//   - NO DATA IS NOT A CLASS 1. A pollutant the model has no value for
//     publishes no state (see buildStates) and fires no event either; the last
//     known class is kept, so the next real value is compared with a real one.
//   - NEVER THROWS. This runs inside the refresh cycle, which a rejection would
//     take down along with the container.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { pollutantName } from '../airQuality/scale.js';
import { formatMeasuredAt } from '../datetime.js';
import { levelLabel, overallSummary, pollutantSummary } from '../indexText.js';
import { DEFAULT_LANGUAGE } from '../language.js';

const logger = createLogger({ name: 'scene-events' });

/** The trigger keys declared in the manifest `scene_triggers`. */
export const SCENE_TRIGGERS = {
  INDEX_LEVEL_CHANGED: 'index_level_changed',
  POLLUTANT_INDEX_LEVEL_CHANGED: 'pollutant_index_level_changed',
};

// Last known classes, per location id: `{ overall: 3, pollutants: { ozone: 4 } }`.
// In memory only, and deliberately so — a class remembered across a restart
// would fire a transition against an analysis nobody read. Bounded by
// MAX_LOCATIONS entries.
const lastLevels = new Map();

/**
 * Forget every remembered class (the tests only).
 *
 * Deliberately NOT called on a disconnection: a reconnection an hour later
 * compares the new reading with the class that was really last seen, which is
 * a transition worth firing. Clearing it would swallow it.
 */
export function resetIndexMemory() {
  lastLevels.clear();
}

/** A transition is only one when both ends are known. */
function transition(previous, next) {
  if (next === null || next === undefined) {
    return null; // no data: not a return to "good"
  }
  if (previous === null || previous === undefined || previous === next) {
    return null; // first reading, or nothing moved
  }
  return { from: previous, to: next, direction: next > previous ? 'rising' : 'falling' };
}

/**
 * Compare a reading with the last one of the same location and record it.
 *
 * Pure apart from the memory it keeps, so the whole "when does it fire?"
 * question is testable without a Gladys.
 * @param {string} locationId
 * @param {{ subIndexes: Record<string, number|null>, overall: { level: number|null } }} reading
 * @returns {{ overall: object|null, pollutants: Array<{ pollutant: string } & object> }}
 */
export function indexTransitions(locationId, reading) {
  const known = lastLevels.get(locationId) ?? { overall: null, pollutants: {} };

  const overall = transition(known.overall, reading.overall?.level);
  const pollutants = [];
  for (const [pollutant, level] of Object.entries(reading.subIndexes ?? {})) {
    const moved = transition(known.pollutants[pollutant], level);
    if (moved) {
      pollutants.push({ pollutant, ...moved });
    }
  }

  // Record only what the reading actually carries: a pollutant with no value
  // keeps the class it was last known at.
  const levels = { ...known.pollutants };
  for (const [pollutant, level] of Object.entries(reading.subIndexes ?? {})) {
    if (level !== null && level !== undefined) {
      levels[pollutant] = level;
    }
  }
  lastLevels.set(locationId, {
    overall: reading.overall?.level ?? known.overall,
    pollutants: levels,
  });

  return { overall, pollutants };
}

/** The keys every event of this integration carries, whatever its trigger. */
function commonData({ deviceExternalId, location, reading, language }) {
  return {
    // The value of the trigger's `location` filter: a `source: "devices"`
    // select stores the device external_id, so the event has to speak the same
    // id the user picked in the scene editor.
    location: deviceExternalId,
    location_name: location.name,
    measured_at: formatMeasuredAt(reading.measuredAt, language, reading.timeZone) ?? '',
  };
}

/**
 * The class as the FILTER sees it: a string.
 *
 * A `multi_select` stores the option values, which a manifest can only declare
 * as strings ("1".."6"), and the core compares the event value with them. A
 * number would be comparing 4 with "4" and matching nothing.
 */
function levelData(level, language) {
  return { level: String(level), level_label: levelLabel(level, language) };
}

function previousLevelData(level, language) {
  return {
    previous_level: String(level),
    previous_level_label: levelLabel(level, language),
  };
}

/**
 * Fire the scene events of one reading, if anything moved.
 *
 * The device external_id is handed in rather than rebuilt here: this module
 * must not import the device blueprint that calls it.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} context
 * @param {import('../locations.js').Location} context.location
 * @param {string} context.deviceExternalId external_id of the location's device
 * @param {object} context.reading what `readAirQuality` returned
 * @param {string} [context.language] one of LANGUAGES
 * @returns {Promise<number>} how many events were accepted by the core
 */
export async function publishIndexEvents(
  gladys,
  { location, deviceExternalId, reading, language = DEFAULT_LANGUAGE },
) {
  const { overall, pollutants } = indexTransitions(location.id, reading);
  const events = [];

  if (overall) {
    const dominant = reading.overall?.pollutant ?? null;
    events.push({
      key: SCENE_TRIGGERS.INDEX_LEVEL_CHANGED,
      data: {
        ...commonData({ deviceExternalId, location, reading, language }),
        ...levelData(overall.to, language),
        ...previousLevelData(overall.from, language),
        direction: overall.direction,
        pollutant: dominant ?? '',
        pollutant_name: dominant ? pollutantName(dominant, language) : '',
        summary: overallSummary(
          { locationName: location.name, level: overall.to, pollutant: dominant },
          language,
        ),
      },
    });
  }

  for (const moved of pollutants) {
    const concentration = reading.concentrations?.[moved.pollutant];
    events.push({
      key: SCENE_TRIGGERS.POLLUTANT_INDEX_LEVEL_CHANGED,
      data: {
        ...commonData({ deviceExternalId, location, reading, language }),
        pollutant: moved.pollutant,
        pollutant_name: pollutantName(moved.pollutant, language),
        ...levelData(moved.to, language),
        ...previousLevelData(moved.from, language),
        direction: moved.direction,
        concentration: Number.isFinite(concentration) ? concentration : null,
        summary: pollutantSummary(
          { locationName: location.name, pollutant: moved.pollutant, level: moved.to },
          language,
        ),
      },
    });
  }

  let accepted = 0;
  for (const event of events) {
    try {
      await gladys.publishSceneEvent(event.key, event.data);
      accepted += 1;
    } catch (err) {
      // A refused event must not cost the refresh its published states: the
      // core answers 404 on a key it does not know (an old Gladys, a manifest
      // not reloaded) and 429 past its rate limit, and neither is worth taking
      // the cycle down for.
      logger.error(`Scene event "${event.key}" refused for ${location.name}`, err);
    }
  }
  if (accepted > 0) {
    logger.info(`${location.name}: ${accepted} scene event(s) fired`);
  }
  return accepted;
}
