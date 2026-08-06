// -----------------------------------------------------------------------------
// The country registry and the French postal code lookup.
//
// `globalThis.fetch` is stubbed in every test — nothing here touches the
// network.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRIES,
  countryName,
  DEFAULT_COUNTRY,
  findCountry,
  normalizeCountry,
} from '../src/countries/index.js';
import { france } from '../src/countries/france.js';

const realFetch = globalThis.fetch;
let requestedUrls = [];

function stubFetch(body, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return { ok, status, json: async () => body };
  };
}

/** One commune as API Géo returns it, `centre` being a GeoJSON Point. */
function commune(nom, longitude, latitude, departement) {
  return {
    nom,
    code: '00000',
    centre: { type: 'Point', coordinates: [longitude, latitude] },
    departement: { code: '44', nom: departement },
  };
}

beforeEach(() => {
  requestedUrls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('every registered country exposes the whole contract', () => {
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/, 'code must be ISO 3166-1 alpha-2');
    assert.ok(country.name?.fr && country.name?.en, `${country.code} has no name`);
    assert.ok(country.postalCodeExample, `${country.code} has no postal code example`);
    assert.equal(typeof country.isValidPostalCode, 'function');
    assert.equal(typeof country.lookupPostalCode, 'function');
    assert.ok(
      country.isValidPostalCode(country.postalCodeExample),
      `${country.code}: its own example is refused by its validator`,
    );
  }
});

test('the default country is one of the registered ones', () => {
  assert.ok(findCountry(DEFAULT_COUNTRY));
});

test('a country code is found whatever its case, and an unknown one falls back', () => {
  assert.equal(findCountry('fr'), france);
  assert.equal(findCountry(' FR '), france);
  assert.equal(findCountry('ZZ'), undefined);
  assert.equal(normalizeCountry('zz'), DEFAULT_COUNTRY);
  assert.equal(normalizeCountry(undefined), DEFAULT_COUNTRY);
  assert.equal(normalizeCountry('fr'), 'FR');
});

test('a country is named in the reader language', () => {
  assert.equal(countryName('FR', 'fr'), 'France');
  assert.equal(countryName('FR', 'en'), 'France');
});

test('a French postal code is five digits, and nothing else', () => {
  for (const valid of ['44000', '01400', '97400']) {
    assert.ok(france.isValidPostalCode(valid), valid);
  }
  for (const invalid of ['4400', '440000', '4400A', '', '  ', 'Nantes', null]) {
    assert.ok(!france.isValidPostalCode(invalid), String(invalid));
  }
});

test('the lookup asks API Géo for the centre, which is not returned by default', async () => {
  stubFetch([commune('Nantes', -1.5534, 47.2172, 'Loire-Atlantique')]);
  await france.lookupPostalCode('44000');

  const url = decodeURIComponent(requestedUrls[0]);
  assert.match(url, /codePostal=44000/);
  assert.match(url, /centre/, 'without fields=centre nothing has coordinates');
});

test('a GeoJSON centre is unpacked as [longitude, latitude], not the reverse', async () => {
  // Getting this backwards puts French communes in Somalia.
  stubFetch([commune('Nantes', -1.5534, 47.2172, 'Loire-Atlantique')]);
  const [place] = await france.lookupPostalCode('44000');

  assert.equal(place.latitude, 47.2172);
  assert.equal(place.longitude, -1.5534);
  assert.equal(place.name, 'Nantes');
  assert.equal(place.postal_code, '44000');
  assert.equal(place.context, 'Loire-Atlantique');
});

test('a postal code shared by several communes returns them all', async () => {
  stubFetch([
    commune('Châtillon-sur-Chalaronne', 4.95, 46.12, 'Ain'),
    commune('Romans', 5.01, 46.13, 'Ain'),
  ]);
  const places = await france.lookupPostalCode('01400');
  assert.equal(places.length, 2);
});

test('an unknown postal code is an empty list, not a failure', async () => {
  stubFetch([]);
  assert.deepEqual(await france.lookupPostalCode('99999'), []);
});

test('a commune without a usable centre is dropped rather than published', async () => {
  stubFetch([
    { nom: 'Sans centre', code: '00000' },
    commune('Nantes', -1.5534, 47.2172, 'Loire-Atlantique'),
  ]);
  const places = await france.lookupPostalCode('44000');
  assert.deepEqual(
    places.map((place) => place.name),
    ['Nantes'],
  );
});

test('an HTTP failure is propagated, not turned into "no commune found"', async () => {
  stubFetch([], { ok: false, status: 502 });
  await assert.rejects(() => france.lookupPostalCode('44000'), /502/);
});
