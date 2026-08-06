// -----------------------------------------------------------------------------
// The location list: normalization, round trip through the stored shape, and
// the numbering the delete dropdown depends on.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COUNTRY } from '../src/countries/index.js';
import {
  buildAddressLabel,
  describeLocation,
  describeLocations,
  findLocationAtPlace,
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
  country: 'FR',
  postal_code: '44000',
  city: 'Nantes',
  address_label: 'Nantes (44000), Loire-Atlantique',
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
  assert.equal(location.city, 'Nantes');
  assert.equal(location.country, 'FR');
  assert.ok(hasCoordinates(location));
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

test('an unknown stored country falls back instead of breaking the location', () => {
  const [location] = normalizeLocations([{ ...NANTES, country: 'ZZ' }]);
  assert.equal(location.country, DEFAULT_COUNTRY);
  assert.equal(location.postal_code, '44000', 'the postal code is still there to act on');
});

test('two entries sharing an id would fight over one device: one is dropped', () => {
  const locations = normalizeLocations([NANTES, { ...NANTES, name: 'Doublon' }]);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].name, 'Maison');
});

test('a location with no name is named after its commune', () => {
  const [location] = normalizeLocations([{ ...NANTES, name: '' }]);
  assert.equal(location.name, 'Nantes');
});

test('a fresh id is never one already in use', () => {
  const existing = Array.from({ length: 50 }, (_, index) => ({ id: `loc-${index}` }));
  const id = newLocationId(existing);
  assert.ok(!existing.some((location) => location.id === id));
  assert.match(id, /^loc-/);
});

test('an address label reads "commune (code), area"', () => {
  assert.equal(
    buildAddressLabel({ city: 'Nantes', postal_code: '44000', context: 'Loire-Atlantique' }),
    'Nantes (44000), Loire-Atlantique',
  );
  assert.equal(buildAddressLabel({ city: 'Nantes' }), 'Nantes');
  assert.equal(buildAddressLabel({}), '');
});

test('adding keeps the list immutable and appends at the end', () => {
  const locations = normalizeLocations([NANTES]);
  const next = upsertLocation(locations, {
    id: 'loc-22222222',
    name: 'Bureau',
    country: 'FR',
    postal_code: '75001',
    city: 'Paris',
    latitude: 48.8566,
    longitude: 2.3522,
  });
  assert.equal(locations.length, 1, 'the original list must not be mutated');
  assert.equal(next.length, 2);
  assert.equal(positionOf(next, 'loc-22222222'), 2);
});

test('renaming a location does not blank the commune it was resolved from', () => {
  const locations = normalizeLocations([NANTES]);
  const [renamed] = upsertLocation(locations, { id: NANTES.id, name: 'Chez moi' });
  assert.equal(renamed.name, 'Chez moi');
  assert.equal(renamed.city, 'Nantes');
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

test('the same commune is recognised whatever the case', () => {
  const locations = normalizeLocations([NANTES]);
  assert.ok(
    findLocationAtPlace(locations, { country: 'FR', postal_code: '44000', city: 'NANTES' }),
  );
  assert.ok(
    !findLocationAtPlace(locations, { country: 'FR', postal_code: '44100', city: 'Nantes' }),
    'another postal code of the same city is another location',
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
  assert.match(lines[0], /Nantes \(44000\)/);
});

test('an empty list still says something', () => {
  assert.match(describeLocations([]), /aucun lieu/);
});

test('the cap is a real number the delete dropdown can offer', () => {
  assert.ok(Number.isInteger(MAX_LOCATIONS) && MAX_LOCATIONS > 0);
});
