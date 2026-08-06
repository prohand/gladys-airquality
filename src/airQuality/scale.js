// -----------------------------------------------------------------------------
// Concentration (µg/m³) -> air quality INDEX.
//
// A provider returns raw pollutant concentrations. A raw concentration means
// nothing to a user: 45 µg/m³ is a quiet hour for ozone and a bad one for PM10.
// This module owns the per-pollutant thresholds that turn a concentration into
// the 1-6 index the Gladys features expose.
//
// WHICH SCALE, AND WHY IT IS BOTH EUROPEAN AND FRENCH. The thresholds below are
// the ones of the European Air Quality Index published by the European
// Environment Agency — and they are, band for band, the ones the French ATMO
// index has used since the arrêté du 10 juillet 2020 (in force since 1 January
// 2021), which aligned the national index on the European one: six classes,
// the same five regulated pollutants, the same bounds. So one table serves both
// the "European AQI" wording and the "indice ATMO" wording, and the labels a
// French user reads (bon, moyen, dégradé, mauvais, très mauvais, extrêmement
// mauvais) are the official ones.
//
// WHAT DIFFERS FROM THE PUBLISHED ATMO BULLETIN. ATMO is a DAILY index: it
// averages PM over the day and takes the daily maximum for the gases. This
// integration reads the CURRENT hour, which is how the European index is
// computed, so its value is an hourly one on the ATMO bands rather than a copy
// of the day's ATMO bulletin. It reacts within the hour, which is what a home
// automation scene wants; the daily bulletin is a different, slower number.
//
// The sub-index of every pollutant is exposed too, because that is what the
// index is made of: the worst pollutant sets the class, and the user deserves
// to see which one.
// -----------------------------------------------------------------------------

/**
 * The five regulated pollutants the index is computed from, in the order the
 * device features are built. Keys are used everywhere in this integration; a
 * provider maps its own variable names onto them.
 */
export const POLLUTANTS = ['pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide'];

/** Bounds of the index, mirrored in the `min`/`max` of every index feature. */
export const INDEX_MIN = 1;
export const INDEX_MAX = 6;

/** The six classes, by index value. */
export const INDEX_LEVELS = {
  GOOD: 1,
  FAIR: 2,
  MODERATE: 3,
  POOR: 4,
  VERY_POOR: 5,
  EXTREMELY_POOR: 6,
};

/**
 * Official wording of each class: the EEA one in English, the ATMO one in
 * French. Used by the TEXT feature, the action messages and the logs.
 */
export const INDEX_LABELS = {
  1: { en: 'Good', fr: 'Bon' },
  2: { en: 'Fair', fr: 'Moyen' },
  3: { en: 'Moderate', fr: 'Dégradé' },
  4: { en: 'Poor', fr: 'Mauvais' },
  5: { en: 'Very poor', fr: 'Très mauvais' },
  6: { en: 'Extremely poor', fr: 'Extrêmement mauvais' },
};

/** Display names of the pollutants, for the feature names and the messages. */
export const POLLUTANT_NAMES = {
  pm2_5: { en: 'PM2.5', fr: 'PM2,5' },
  pm10: { en: 'PM10', fr: 'PM10' },
  nitrogen_dioxide: { en: 'Nitrogen dioxide (NO₂)', fr: "Dioxyde d'azote (NO₂)" },
  ozone: { en: 'Ozone (O₃)', fr: 'Ozone (O₃)' },
  sulphur_dioxide: { en: 'Sulphur dioxide (SO₂)', fr: 'Dioxyde de soufre (SO₂)' },
};

// Upper bounds (µg/m³, EXCLUSIVE) of classes 1 to 5; anything at or above the
// last bound is class 6. Straight from the European Air Quality Index / arrêté
// du 10 juillet 2020 — do not "harmonize" them, each pollutant has its own
// toxicity.
const THRESHOLDS = {
  pm2_5: [10, 20, 25, 50, 75],
  pm10: [20, 40, 50, 100, 150],
  nitrogen_dioxide: [40, 90, 120, 230, 340],
  ozone: [50, 100, 130, 240, 380],
  sulphur_dioxide: [100, 200, 350, 500, 750],
};

/**
 * Highest concentration the scale still describes, per pollutant: the `max` of
 * the concentration features Gladys publishes. Well above the last threshold,
 * because an episode can go there and a clipped chart hides it.
 */
export const CONCENTRATION_MAX = {
  pm2_5: 1000,
  pm10: 1200,
  nitrogen_dioxide: 1000,
  ozone: 800,
  sulphur_dioxide: 1250,
};

/**
 * Display name of a pollutant. Also the value of the "dominant pollutant"
 * state, so a dashboard reads the same word as the feature it comes from.
 * @param {string} pollutant e.g. 'pm2_5'
 * @param {string} [language] the pollutant key is the last resort, for one a
 *   future provider adds without a translation
 */
export function pollutantName(pollutant, language = 'fr') {
  const names = POLLUTANT_NAMES[pollutant];
  return names ? (names[language] ?? names.fr ?? names.en) : pollutant;
}

/**
 * Convert a concentration into the 1-6 index of a given pollutant.
 * @param {string} pollutant e.g. 'pm10'
 * @param {number|null|undefined} concentration µg/m³, or null when the provider
 *   has no value for this pollutant at this point
 * @returns {number|null} the index class, or null when there is no data — an
 *   absent measurement is NOT a good air quality
 */
export function concentrationToIndex(pollutant, concentration) {
  if (concentration === null || concentration === undefined) {
    return null;
  }
  const value = Number(concentration);
  if (!Number.isFinite(value)) {
    return null;
  }
  // A small negative is a rounding artefact of the model, and it means
  // "nothing measurable" — which is class 1, the same as a value of 0. It falls
  // through the bands below on its own; only a NON-number is "no data".
  const bounds = THRESHOLDS[pollutant];
  if (!bounds) {
    // A pollutant no scale covers cannot be graded. Better no sub-index than a
    // number pulled out of another pollutant's bands.
    return null;
  }
  for (let index = 0; index < bounds.length; index += 1) {
    if (value < bounds[index]) {
      return index + INDEX_MIN;
    }
  }
  return INDEX_MAX;
}

/**
 * Overall index of a point: the WORST pollutant wins, which is exactly how both
 * the European index and the ATMO index are defined — no averaging, a single
 * bad pollutant makes the air bad.
 * @param {Record<string, number|null>} indexByPollutant
 * @returns {{ level: number|null, pollutant: string|null }} the class and the
 *   pollutant that set it; `pollutant` stays null at class 1, where naming a
 *   "dominant" pollutant would be alarming for nothing
 */
export function overallIndex(indexByPollutant = {}) {
  let level = null;
  let pollutant = null;
  for (const [key, value] of Object.entries(indexByPollutant)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (level === null || value > level) {
      level = value;
      pollutant = key;
    }
  }
  return { level, pollutant: level !== null && level > INDEX_LEVELS.GOOD ? pollutant : null };
}
