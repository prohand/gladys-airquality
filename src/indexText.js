// -----------------------------------------------------------------------------
// How an air quality index is SAID, in one place.
//
// Three surfaces put the same index into words: the data of a scene event, the
// outputs of a scene action and the rows of a dashboard widget. They all come
// here, so "4/6 (Mauvais)" is written the same way everywhere and a wording fix
// lands in all of them at once. The words themselves are the official ones
// (`INDEX_LABELS` in src/airQuality/scale.js: the EEA wording in English, the
// ATMO wording in French), so a card never contradicts the TEXT feature of the
// device next to it.
//
// Each helper takes a language rather than returning `{ en, fr }`, because
// everything it feeds is a PLAIN STRING the core stores or substitutes as it
// is: a scene event variable, an action output, a widget row. For the events
// and the action outputs that language is `config.language` — the same one the
// device names use, and for the same reason (see src/language.js); a widget is
// written in the language of the ONE reader pulling it (see
// src/widgets/content.js).
// -----------------------------------------------------------------------------

import { INDEX_LABELS, INDEX_MAX, pollutantName } from './airQuality/scale.js';
import { DEFAULT_LANGUAGE, inLanguage } from './language.js';

/** Wording of a class: `4` -> "Mauvais". An unknown class answers "?". */
export function levelLabel(level, language = DEFAULT_LANGUAGE) {
  const labels = INDEX_LABELS[level];
  return labels ? inLanguage(labels, language) : '?';
}

/** `4` -> "4/6 (Mauvais)", the scale and the word the whole integration uses. */
export function levelText(level, language = DEFAULT_LANGUAGE) {
  return `${level}/${INDEX_MAX} (${levelLabel(level, language)})`;
}

const OVERALL_SENTENCE = {
  en: (place, level, dominant) =>
    `Air quality in ${place}: index ${level}${dominant ? `, dominant ${dominant}` : ''}.`,
  fr: (place, level, dominant) =>
    `Qualité de l'air à ${place} : indice ${level}${dominant ? `, dominant ${dominant}` : ''}.`,
};

const POLLUTANT_SENTENCE = {
  en: (place, pollutant, level) => `${pollutant} in ${place}: index ${level}.`,
  fr: (place, pollutant, level) => `${pollutant} à ${place} : indice ${level}.`,
};

const NO_DATA_SENTENCE = {
  en: (place) => `Air quality in ${place}: no data available.`,
  fr: (place) => `Qualité de l'air à ${place} : données indisponibles.`,
};

/**
 * The one-line sentence a scene drops into a notification.
 *
 * `pollutant` is the DOMINANT one of an overall reading — null at class 1,
 * where naming a culprit would be alarming for nothing (see `overallIndex`).
 * @param {{ locationName: string, level: number, pollutant?: string|null }} reading
 * @param {string} [language] one of LANGUAGES
 * @returns {string} e.g. `Qualité de l'air à Nantes : indice 4/6 (Mauvais), dominant Ozone (O₃).`
 */
export function overallSummary(
  { locationName, level, pollutant = null },
  language = DEFAULT_LANGUAGE,
) {
  return inLanguage(OVERALL_SENTENCE, language)(
    locationName,
    levelText(level, language),
    pollutant ? pollutantName(pollutant, language) : null,
  );
}

/**
 * The same sentence about ONE pollutant, for the per-pollutant trigger and for
 * the scene action reading a single gas.
 * @param {{ locationName: string, pollutant: string, level: number }} reading
 * @param {string} [language] one of LANGUAGES
 * @returns {string} e.g. `Ozone (O₃) à Nantes : indice 3/6 (Dégradé).`
 */
export function pollutantSummary({ locationName, pollutant, level }, language = DEFAULT_LANGUAGE) {
  return inLanguage(POLLUTANT_SENTENCE, language)(
    locationName,
    pollutantName(pollutant, language),
    levelText(level, language),
  );
}

/**
 * What a reading says when the model has no value at all.
 *
 * Returned rather than thrown by the scene action: a scene action is never a
 * condition, so "I could not read it" has to travel as an output the scene
 * author can test, not as a failure that stops nothing.
 * @param {{ locationName: string }} reading
 * @param {string} [language] one of LANGUAGES
 */
export function noDataSummary({ locationName }, language = DEFAULT_LANGUAGE) {
  return inLanguage(NO_DATA_SENTENCE, language)(locationName);
}
