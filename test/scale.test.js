// -----------------------------------------------------------------------------
// The index thresholds: the one piece of pure arithmetic in this integration,
// and the one that decides what the user is told about the air they breathe.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  concentrationToIndex,
  INDEX_LABELS,
  INDEX_LEVELS,
  INDEX_MAX,
  INDEX_MIN,
  overallIndex,
  POLLUTANTS,
  pollutantName,
} from '../src/airQuality/scale.js';

test('a concentration below the first bound is "good"', () => {
  assert.equal(concentrationToIndex('pm2_5', 0), INDEX_LEVELS.GOOD);
  assert.equal(concentrationToIndex('pm2_5', 9.9), INDEX_LEVELS.GOOD);
  assert.equal(concentrationToIndex('ozone', 49), INDEX_LEVELS.GOOD);
});

test('the bounds are exclusive: the bound itself is the NEXT class', () => {
  // PM2.5 good is 0-10, fair 10-20: exactly 10 is fair, not good.
  assert.equal(concentrationToIndex('pm2_5', 10), INDEX_LEVELS.FAIR);
  assert.equal(concentrationToIndex('pm10', 20), INDEX_LEVELS.FAIR);
  assert.equal(concentrationToIndex('nitrogen_dioxide', 40), INDEX_LEVELS.FAIR);
});

test('each pollutant keeps its own bands', () => {
  // 45 µg/m³ is a different world depending on what it is made of.
  assert.equal(concentrationToIndex('pm2_5', 45), INDEX_LEVELS.POOR);
  assert.equal(concentrationToIndex('pm10', 45), INDEX_LEVELS.MODERATE);
  assert.equal(concentrationToIndex('nitrogen_dioxide', 45), INDEX_LEVELS.FAIR);
  assert.equal(concentrationToIndex('ozone', 45), INDEX_LEVELS.GOOD);
  assert.equal(concentrationToIndex('sulphur_dioxide', 45), INDEX_LEVELS.GOOD);
});

test('anything at or above the last bound is the worst class', () => {
  assert.equal(concentrationToIndex('pm2_5', 75), INDEX_MAX);
  assert.equal(concentrationToIndex('pm2_5', 5000), INDEX_MAX);
  assert.equal(concentrationToIndex('sulphur_dioxide', 750), INDEX_MAX);
});

test('a missing value is null, NEVER a good air quality', () => {
  for (const missing of [null, undefined, 'not a number', Number.NaN]) {
    assert.equal(concentrationToIndex('pm10', missing), null, `${missing} must not grade`);
  }
});

test('a pollutant no band covers is not graded rather than graded wrong', () => {
  assert.equal(concentrationToIndex('ammonia', 42), null);
});

test('every pollutant of the scale has bands, a name and a label per class', () => {
  for (const pollutant of POLLUTANTS) {
    assert.notEqual(
      concentrationToIndex(pollutant, 1),
      null,
      `${pollutant} has no thresholds in the scale`,
    );
    assert.notEqual(pollutantName(pollutant, 'fr'), pollutant, `${pollutant} has no French name`);
    assert.notEqual(pollutantName(pollutant, 'en'), pollutant, `${pollutant} has no English name`);
  }
  for (let level = INDEX_MIN; level <= INDEX_MAX; level += 1) {
    assert.ok(INDEX_LABELS[level]?.fr, `class ${level} has no French label`);
    assert.ok(INDEX_LABELS[level]?.en, `class ${level} has no English label`);
  }
});

test('the overall index is the WORST pollutant, and names it', () => {
  const overall = overallIndex({
    pm2_5: INDEX_LEVELS.FAIR,
    pm10: INDEX_LEVELS.GOOD,
    ozone: INDEX_LEVELS.POOR,
  });
  assert.deepEqual(overall, { level: INDEX_LEVELS.POOR, pollutant: 'ozone' });
});

test('a missing pollutant does not drag the overall index down', () => {
  const overall = overallIndex({ pm2_5: INDEX_LEVELS.MODERATE, ozone: null, pm10: undefined });
  assert.deepEqual(overall, { level: INDEX_LEVELS.MODERATE, pollutant: 'pm2_5' });
});

test('nothing measured at all gives no index and no dominant pollutant', () => {
  assert.deepEqual(overallIndex({ pm2_5: null, pm10: null }), { level: null, pollutant: null });
  assert.deepEqual(overallIndex({}), { level: null, pollutant: null });
});

test('good air has no "dominant" pollutant to point at', () => {
  const overall = overallIndex({ pm2_5: INDEX_LEVELS.GOOD, pm10: INDEX_LEVELS.GOOD });
  assert.deepEqual(overall, { level: INDEX_LEVELS.GOOD, pollutant: null });
});
