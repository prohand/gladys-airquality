// -----------------------------------------------------------------------------
// The language the DEVICES speak.
//
// Everything this integration says under a button — an action result, a
// connection status — travels as an `{ en, fr }` object and is rendered by
// Gladys in the language of the user reading it: the core picks the key, we
// never choose. Device and feature NAMES are the exception. They are plain
// strings, copied into `t_device_feature.name` the day the user creates the
// device, and the host API tells an integration nothing about who is reading:
// the only language it ever exposes is the one of a messaging contact linked to
// a communication integration (`getContacts()`), which this integration has
// none of.
//
// So the language of the names is a configuration field, and its default is
// FRENCH: the vocabulary of the index — bon, dégradé, très mauvais — is the one
// of the French ATMO bulletin, and Gladys' own audience is largely French. The
// locations themselves are worldwide (see src/geocoding.js), and this field is
// also what the geocoder answers in: "Munich" or "München" for the same town.
//
// Note that Gladys renames nothing on re-publish: it upserts the params of the
// devices already created, never their name. Changing the language therefore
// renames the features of the devices still to be created, and leaves the
// existing ones as they were — deleting the device and adding it again from the
// Discovery tab is what renames it.
// -----------------------------------------------------------------------------

/** The languages the device names are written in, in manifest order. */
export const LANGUAGES = ['fr', 'en'];

/** The one used when the configuration says nothing, or says nonsense. */
export const DEFAULT_LANGUAGE = 'fr';

/**
 * Coerce whatever the form (or an older config) holds into a supported
 * language. A regional code — `fr-FR`, `en-US` — keeps its first subtag.
 * @param {unknown} value
 * @returns {string} one of LANGUAGES
 */
export function normalizeLanguage(value) {
  const code = String(value ?? '')
    .trim()
    .slice(0, 2)
    .toLowerCase();
  return LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
}

/**
 * The entry of a multi-language object for a language, falling back to the
 * default one and then to English — the key the SDK guarantees.
 * @param {Record<string, unknown>} entries e.g. `{ en: 'Good', fr: 'Bon' }`
 * @param {string} language
 */
export function inLanguage(entries, language) {
  return entries[language] ?? entries[DEFAULT_LANGUAGE] ?? entries.en;
}

/**
 * Case- and accent-insensitive form of a text, for comparing what the user
 * typed with what an API answered: "Saint-Étienne" must match "saint-etienne".
 * @param {unknown} value
 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
