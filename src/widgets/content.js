// -----------------------------------------------------------------------------
// The bits of widget-content vocabulary both cards share.
//
// The vocabulary is declarative and the core renders it: no HTML, no CSS, no
// colour codes — a `color` is a semantic name the theme resolves, so the card
// follows the user's dark mode without this integration knowing about it.
//
// The content budget the core enforces is worth keeping in mind while reading
// the two builders: 8 components, 1 focal (chart / card-list / image), 6 tiles
// (value / gauge), 2 texts (1 body), 1 status, 4 buttons. Beyond a cap the core
// DROPS components in content order, so what matters comes first.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { INDEX_LEVELS } from '../airQuality/scale.js';
import { LANGUAGES, normalizeLanguage } from '../language.js';

/**
 * How fast the data moves, in seconds: the CAMS analysis is produced once an
 * hour, so a quarter of an hour is already generous. The core re-pulls on
 * expiry, and `nudgeWidgets` short-circuits it when a refresh cycle has just
 * published something new.
 */
export const CONTENT_TTL_SECONDS = 900;

/**
 * The colour of an index class.
 *
 * The European scale paints six bands — green, green-blue, yellow, red, dark
 * red, purple — and the widget palette is a SEMANTIC one with neither orange
 * nor purple: `success`, `warning`, `danger` are all it has to say "fine",
 * "watch out", "bad". So the two good classes share `success`, "moderate" is
 * the `warning`, and the three bad ones share `danger` — painting a "Mauvais"
 * in the yellow of a "Dégradé" would understate exactly the class a user reads
 * the card for.
 */
const LEVEL_COLORS = {
  [INDEX_LEVELS.GOOD]: WIDGET_COLORS.SUCCESS,
  [INDEX_LEVELS.FAIR]: WIDGET_COLORS.SUCCESS,
  [INDEX_LEVELS.MODERATE]: WIDGET_COLORS.WARNING,
  [INDEX_LEVELS.POOR]: WIDGET_COLORS.DANGER,
  [INDEX_LEVELS.VERY_POOR]: WIDGET_COLORS.DANGER,
  [INDEX_LEVELS.EXTREMELY_POOR]: WIDGET_COLORS.DANGER,
};

/** Colour of a class, `neutral` for a class there is no value for. */
export function levelColor(level) {
  return LEVEL_COLORS[level] ?? WIDGET_COLORS.NEUTRAL;
}

/**
 * The language a widget is written in.
 *
 * Unlike a device name, a widget content is built for ONE reader and the core
 * says which language they read: that is the language to answer in. A reader
 * whose language this integration does not speak falls back to the configured
 * one rather than to the default, so an English install stays English for a
 * German visitor.
 * @param {string|undefined} requested the `language` of the widget.get options
 * @param {{ language?: string }} config
 */
export function widgetLanguage(requested, config) {
  const code = String(requested ?? '')
    .trim()
    .slice(0, 2)
    .toLowerCase();
  return LANGUAGES.includes(code) ? code : normalizeLanguage(config?.language);
}

/** Keep a text inside the budget the core would truncate it to anyway. */
export function clip(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * A card that says why it has nothing to show.
 *
 * An empty `components` array is a valid empty state, but a blank card looks
 * broken: one caption is what tells the user whether to configure the widget
 * or to wait for the provider.
 * @param {{ en: string, fr: string }} message
 */
export function emptyState(message) {
  return {
    ttl_seconds: CONTENT_TTL_SECONDS,
    components: [{ type: 'text', variant: 'caption', text: message }],
  };
}

/** The "re-read it now" pill both cards carry, wired to their `refresh` action. */
export function refreshButton() {
  return {
    type: 'button',
    label: { en: 'Refresh', fr: 'Rafraîchir' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: 'refresh' },
  };
}
