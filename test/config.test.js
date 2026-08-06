// -----------------------------------------------------------------------------
// Configuration normalization: what arrives from a form is all strings, and
// what arrives from an older install may be anything.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isConfigured,
  normalizeConfig,
  POLL_FREQUENCY_LIMITS,
} from '../src/config.js';
import { DEFAULT_LANGUAGE, inLanguage, LANGUAGES, normalizeLanguage } from '../src/language.js';
import { LOCATIONS_KEY } from '../src/locations.js';

test('an empty configuration is the defaults, with no location', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.language, DEFAULT_CONFIG.language);
  assert.deepEqual(config.locations, []);
  assert.ok(!isConfigured(config));
});

test('a refresh interval typed in a form arrives as a string and is a number here', () => {
  assert.equal(normalizeConfig({ poll_frequency: '1800' }).poll_frequency, 1800);
});

test('the refresh interval is clamped to the bounds the manifest declares', () => {
  assert.equal(normalizeConfig({ poll_frequency: 1 }).poll_frequency, POLL_FREQUENCY_LIMITS.min);
  assert.equal(
    normalizeConfig({ poll_frequency: 999_999 }).poll_frequency,
    POLL_FREQUENCY_LIMITS.max,
  );
  assert.equal(
    normalizeConfig({ poll_frequency: 'nonsense' }).poll_frequency,
    DEFAULT_CONFIG.poll_frequency,
  );
});

test('the device language falls back rather than producing untranslated names', () => {
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('fr-FR'), 'fr');
  assert.equal(normalizeLanguage('de'), DEFAULT_LANGUAGE);
  assert.equal(normalizeLanguage(undefined), DEFAULT_LANGUAGE);
  assert.ok(LANGUAGES.includes(DEFAULT_LANGUAGE));
});

test('a multi-language entry falls back to the default language then to English', () => {
  assert.equal(inLanguage({ en: 'Good', fr: 'Bon' }, 'fr'), 'Bon');
  assert.equal(inLanguage({ en: 'Good', fr: 'Bon' }, 'de'), 'Bon');
  assert.equal(inLanguage({ en: 'Good' }, 'de'), 'Good');
});

test('a configuration with one usable location is configured', () => {
  const config = normalizeConfig({
    [LOCATIONS_KEY]: [{ id: 'loc-1', name: 'Maison', latitude: '47.2', longitude: '-1.5' }],
  });
  assert.ok(isConfigured(config));
});

test('a configuration whose only location has no point is NOT configured', () => {
  // Publishing a device pinned to nowhere is worse than publishing none.
  const config = normalizeConfig({
    [LOCATIONS_KEY]: [{ id: 'loc-1', name: 'Maison', latitude: '', longitude: '' }],
  });
  assert.ok(!isConfigured(config));
});

test('unknown stored keys are carried through untouched', () => {
  // getIntegrationConfig returns every stored variable, schema or not: an
  // integration cannot delete a key an older version wrote.
  const config = normalizeConfig({ legacy_key: 'still here' });
  assert.equal(config.legacy_key, 'still here');
});
