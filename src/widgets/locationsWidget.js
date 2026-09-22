// -----------------------------------------------------------------------------
// Dashboard widget: ALL the locations, one line each.
//
// The companion of the station card: no settings at all, because there is
// nothing to choose — it shows the list the Configuration screen manages. One
// row per location, worst first, with its class and the pollutant responsible
// for it.
//
// It stops at ten rows, which is the `status` component's own cap: the
// locations beyond are counted in the caption rather than silently dropped, and
// only the rows actually shown are read from the provider.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { readAirQuality } from '../airQuality/index.js';
import { pollutantName } from '../airQuality/scale.js';
import { refreshLocations, watchedLocations } from '../devices/airQualityStation.js';
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

const logger = createLogger({ name: WIDGET_KEYS.LOCATIONS });

/** The `status` component takes 1 to 10 rows. */
export const MAX_ROWS = 10;

const NO_LOCATION = {
  en: 'No location configured yet: add one in the integration settings.',
  fr: "Aucun lieu configuré : ajoutez-en un dans les réglages de l'intégration.",
};
const UNREADABLE = { en: 'unavailable', fr: 'indisponible' };
const SOURCE = { en: 'Source: CAMS (Copernicus)', fr: 'Source : CAMS (Copernicus)' };
const MORE_LOCATIONS = {
  en: (shown, total) => `${shown} of ${total} locations · CAMS (Copernicus)`,
  fr: (shown, total) => `${shown} lieux sur ${total} · CAMS (Copernicus)`,
};

/** One row: the location, its class, and the pollutant that sets it. */
function locationRow(location, reading, language) {
  if (!reading || reading.overall.level === null) {
    return {
      label: clip(location.name, 40),
      value: inLanguage(UNREADABLE, language),
      color: levelColor(null),
    };
  }
  const { level, pollutant } = reading.overall;
  return {
    label: clip(location.name, 40),
    value: clip(
      `${levelText(level, language)}${pollutant ? ` — ${pollutantName(pollutant, language)}` : ''}`,
      40,
    ),
    color: levelColor(level),
  };
}

export const locationsWidget = {
  key: WIDGET_KEYS.LOCATIONS,

  /**
   * Build the card. No settings: the list IS the content.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} config the integration configuration
   * @param {{ language?: string }} options
   */
  async getContent(gladys, config, { language } = {}) {
    const lang = widgetLanguage(language, config);
    const every = watchedLocations(config);
    if (every.length === 0) {
      return emptyState(NO_LOCATION);
    }

    // Only the rows that will be shown are read: the locations past the cap
    // would cost a request each for a line nobody sees.
    const shown = every.slice(0, MAX_ROWS);
    const rows = await Promise.all(
      shown.map(async (location) => {
        try {
          return locationRow(location, await readAirQuality(location), lang);
        } catch (err) {
          // One location failing is one row saying so, never a card saying
          // nothing about the others.
          logger.error(`Widget row failed for ${location.name}`, err);
          return locationRow(location, null, lang);
        }
      }),
    );

    return {
      ttl_seconds: CONTENT_TTL_SECONDS,
      components: [
        { type: 'status', items: rows },
        {
          type: 'text',
          variant: 'caption',
          text: clip(
            every.length > shown.length
              ? inLanguage(MORE_LOCATIONS, lang)(shown.length, every.length)
              : inLanguage(SOURCE, lang),
            80,
          ),
        },
        refreshButton(),
      ],
    };
  },

  /** The `refresh` pill: re-read every location at once. */
  async onAction(gladys, config) {
    const { refreshed, failed } = await refreshLocations(
      gladys,
      watchedLocations(config),
      config.language,
    );
    return failed === 0
      ? { en: `${refreshed} location(s) refreshed.`, fr: `${refreshed} lieu(x) rafraîchi(s).` }
      : {
          en: `${refreshed} refreshed, ${failed} failing.`,
          fr: `${refreshed} rafraîchi(s), ${failed} en échec.`,
        };
  },
};
