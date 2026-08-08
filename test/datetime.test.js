// -----------------------------------------------------------------------------
// The "last update" text: reading the local ISO stamp Open-Meteo returns.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMeasuredAt } from '../src/datetime.js';

test('a reading time is written in the configured language', () => {
  assert.equal(formatMeasuredAt('2026-08-06T12:00', 'fr'), '06/08/2026 à 12:00');
  assert.equal(formatMeasuredAt('2026-08-06T12:00', 'en'), '2026-08-06 12:00');
});

test('the zone abbreviation is appended when the source names one', () => {
  // "12:00" alone on a location abroad is a number the reader cannot place.
  assert.equal(formatMeasuredAt('2026-08-06T12:00', 'fr', 'CEST'), '06/08/2026 à 12:00 CEST');
  assert.equal(formatMeasuredAt('2026-08-06T21:00', 'en', 'GMT+9'), '2026-08-06 21:00 GMT+9');
});

test('the hour is never shifted into the container timezone', () => {
  // The stamp is the LOCAL hour of the point (timezone=auto). Handing it to
  // `new Date()` would read AND re-render it where the container runs, so a
  // Tokyo location watched from a European server would drift by hours.
  const previous = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  try {
    assert.equal(formatMeasuredAt('2026-08-06T21:00', 'en', 'JST'), '2026-08-06 21:00 JST');
  } finally {
    process.env.TZ = previous;
  }
});

test('seconds are accepted and dropped', () => {
  assert.equal(formatMeasuredAt('2026-08-06T12:00:00', 'en'), '2026-08-06 12:00');
});

test('no timestamp at all is null, not a made-up date', () => {
  // A missing stamp publishes no state, like a missing concentration: dating a
  // reading with "now" would claim a freshness nobody measured.
  for (const value of [null, undefined, '', 'unknown', 42]) {
    assert.equal(formatMeasuredAt(value, 'fr'), null, `${value} should not be a date`);
  }
});

test('an unknown language falls back rather than losing the date', () => {
  assert.equal(formatMeasuredAt('2026-08-06T12:00', 'de'), '06/08/2026 à 12:00');
});
