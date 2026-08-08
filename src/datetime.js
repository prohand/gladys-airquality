// -----------------------------------------------------------------------------
// Rendering the timestamp of a reading.
//
// Open-Meteo is asked with `timezone=auto`, so the hour it stamps a reading with
// is the LOCAL hour of the point, as a bare ISO string with no offset
// (`2026-08-06T12:00`). That is the useful form — "the data is for noon over
// there" — and it must stay that way: handing the string to `new Date()` would
// read it in the container's timezone and re-render it in the container's
// timezone, so a Tokyo location watched from a Paris server would drift by
// seven hours for no reason. Hence a plain regex over the parts, and no Date
// anywhere in this file.
//
// The zone abbreviation the API returns next to it (`CEST`, `GMT+9`) is
// appended when there is one: without it, "12:00" on a location abroad is a
// number the reader has no way to place.
//
// The result is a TEXT state, so it is written in the configured language like
// a feature name — nobody downstream translates a stored string.
// -----------------------------------------------------------------------------

/** `2026-08-06T12:00` or `2026-08-06T12:00:00`, which is all this API emits. */
const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** How each language writes a day and an hour. */
const FORMATS = {
  fr: ({ year, month, day, hour, minute }) => `${day}/${month}/${year} à ${hour}:${minute}`,
  en: ({ year, month, day, hour, minute }) => `${year}-${month}-${day} ${hour}:${minute}`,
};

/**
 * Turn the timestamp of a reading into the text of the "last update" feature.
 *
 * @param {unknown} measuredAt local ISO timestamp of the reading, as the
 *   provider returned it (null when the source gave none)
 * @param {string} language one of LANGUAGES (see src/language.js)
 * @param {unknown} [timeZone] zone abbreviation to append, when the source
 *   named one
 * @returns {string|null} null when there is nothing to display — an absent
 *   timestamp publishes no state at all, like an absent concentration
 */
export function formatMeasuredAt(measuredAt, language, timeZone) {
  const match = LOCAL_ISO.exec(String(measuredAt ?? ''));
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const format = FORMATS[language] ?? FORMATS.fr;
  const stamp = format({ year, month, day, hour, minute });

  const zone = String(timeZone ?? '').trim();
  return zone ? `${stamp} ${zone}` : stamp;
}
