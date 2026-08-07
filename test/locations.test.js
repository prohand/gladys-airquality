// -----------------------------------------------------------------------------
// The location list: normalization, round trip through the stored shape, and
// the numbering the delete dropdown depends on.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeLocation,
  describeLocations,
  findLocationAtPoint,
  findLocationById,
  hasCoordinates,
  LOCATION_LINE_MARKER,
  LOCATIONS_KEY,
  locationAtPosition,
  MAX_LOCATIONS,
  newLocationId,
  normalizeLocations,
  positionOf,
  removeLocation,
  serializeLocations,
  upsertLocation,
  usableLocations,
} from '../src/locations.js';

const NANTES = {
  id: 'loc-11111111',
  name: 'Maison',
  address_label: 'Nantes, Loire-Atlantique, France',
  latitude: '47.2172',
  longitude: '-1.5534',
};

test('the config key is deliberately not a schema field', () => {
  // Guards the decision documented in src/locations.js: no static form can hold
  // a list built at runtime, so the list lives outside config_schema.
  assert.equal(LOCATIONS_KEY, 'locations');
});

test('a stored location comes back with numeric coordinates', () => {
  const [location] = normalizeLocations([NANTES]);
  assert.equal(location.latitude, 47.2172);
  assert.equal(location.longitude, -1.5534);
  assert.equal(location.address_label, 'Nantes, Loire-Atlantique, France');
  assert.ok(hasCoordinates(location));
});

test('a location stored by the France-only version keeps its point and its label', () => {
  // Migration: those entries carry a commune and a postal code and no label.
  // Dropping them would leave an existing device pointing at nothing.
  const [location] = normalizeLocations([
    {
      id: 'loc-legacy01',
      name: '',
      country: 'FR',
      postal_code: '44000',
      city: 'Nantes',
      latitude: '47.2172',
      longitude: '-1.5534',
    },
  ]);
  assert.equal(location.id, 'loc-legacy01', 'the id is the device external_id: it must survive');
  assert.equal(location.name, 'Nantes', 'an unnamed one falls back to its commune');
  assert.equal(location.address_label, 'Nantes (44000)');
  assert.ok(hasCoordinates(location));
  assert.equal(location.country, undefined, 'the country is not a location field any more');
});

test('the list survives a round trip through the stored shape', () => {
  const locations = normalizeLocations([NANTES]);
  assert.deepEqual(normalizeLocations(serializeLocations(locations)), locations);
});

test('the list is read back when the host hands it over as a JSON string', () => {
  assert.equal(normalizeLocations(JSON.stringify([NANTES])).length, 1);
  assert.deepEqual(normalizeLocations('not json'), []);
  assert.deepEqual(normalizeLocations(undefined), []);
  assert.deepEqual(normalizeLocations({ nope: true }), []);
});

test('an entry with unusable coordinates is KEPT but not published', () => {
  // Dropping it would lose a location because one stored value was malformed;
  // the listing shows it with a dash so the user can delete and re-add it.
  const [location] = normalizeLocations([{ ...NANTES, latitude: 'abcd', longitude: '' }]);
  assert.equal(location.latitude, null);
  assert.equal(location.longitude, null);
  assert.ok(!hasCoordinates(location));
  assert.equal(usableLocations([location]).length, 0);
  assert.match(describeLocation(location), /—/);
});

test('an out-of-range coordinate is refused like a malformed one', () => {
  const [location] = normalizeLocations([{ ...NANTES, latitude: '300' }]);
  assert.equal(location.latitude, null);
});

test('two entries sharing an id would fight over one device: one is dropped', () => {
  const locations = normalizeLocations([NANTES, { ...NANTES, name: 'Doublon' }]);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].name, 'Maison');
});

test('a location with no name at all still has one', () => {
  const [location] = normalizeLocations([{ ...NANTES, name: '' }]);
  assert.equal(location.name, 'Lieu');
});

test('a fresh id is never one already in use', () => {
  const existing = Array.from({ length: 50 }, (_, index) => ({ id: `loc-${index}` }));
  const id = newLocationId(existing);
  assert.ok(!existing.some((location) => location.id === id));
  assert.match(id, /^loc-/);
});

test('adding keeps the list immutable and appends at the end', () => {
  const locations = normalizeLocations([NANTES]);
  const next = upsertLocation(locations, {
    id: 'loc-22222222',
    name: 'Bureau',
    address_label: 'Tokyo, Tokyo, Japon',
    latitude: 35.6895,
    longitude: 139.6917,
  });
  assert.equal(locations.length, 1, 'the original list must not be mutated');
  assert.equal(next.length, 2);
  assert.equal(positionOf(next, 'loc-22222222'), 2);
});

test('renaming a location does not blank the place it was resolved from', () => {
  const locations = normalizeLocations([NANTES]);
  const [renamed] = upsertLocation(locations, { id: NANTES.id, name: 'Chez moi' });
  assert.equal(renamed.name, 'Chez moi');
  assert.equal(renamed.address_label, 'Nantes, Loire-Atlantique, France');
  assert.equal(renamed.latitude, 47.2172);
});

test('a position designates a location, and an impossible one designates none', () => {
  const locations = normalizeLocations([NANTES]);
  assert.equal(locationAtPosition(locations, '1')?.id, NANTES.id);
  assert.equal(locationAtPosition(locations, '2'), null);
  assert.equal(locationAtPosition(locations, '0'), null);
  assert.equal(locationAtPosition(locations, 'abc'), null);
  assert.equal(positionOf(locations, 'nope'), 0);
});

test('the same point is recognised whatever the name it was added under', () => {
  const locations = normalizeLocations([NANTES]);
  assert.ok(findLocationAtPoint(locations, { latitude: 47.2172, longitude: -1.5534 }));
  assert.ok(
    !findLocationAtPoint(locations, { latitude: 47.3, longitude: -1.5534 }),
    'another point is another location',
  );
  assert.ok(
    !findLocationAtPoint(locations, {}),
    'nothing is not a point, and must not match the first entry',
  );
});

test('removing leaves the others alone and renumbers them', () => {
  const locations = normalizeLocations([
    NANTES,
    { ...NANTES, id: 'loc-22222222', name: 'Bureau' },
    { ...NANTES, id: 'loc-33333333', name: 'Parents' },
  ]);
  const next = removeLocation(locations, 'loc-22222222');
  assert.equal(next.length, 2);
  assert.equal(findLocationById(next, 'loc-22222222'), undefined);
  assert.equal(positionOf(next, 'loc-33333333'), 2, 'the third moved up one rank');
});

test('the listing opens every entry with the marker and its number', () => {
  const locations = normalizeLocations([NANTES, { ...NANTES, id: 'loc-2', name: 'Bureau' }]);
  const lines = describeLocations(locations).split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(line.startsWith(LOCATION_LINE_MARKER), line);
  }
  assert.match(lines[0], /Nantes, Loire-Atlantique, France \(47\.21720, -1\.55340\)/);
});

test('an empty list still says something', () => {
  assert.match(describeLocations([]), /aucun lieu/);
});

test('the cap is a real number the delete dropdown can offer', () => {
  assert.ok(Number.isInteger(MAX_LOCATIONS) && MAX_LOCATIONS > 0);
});
