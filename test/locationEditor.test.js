// -----------------------------------------------------------------------------
// The three buttons of the Configuration screen, exercised with no Gladys and
// no network: the editor takes its whole outside world by injection.
//
// Every expected outcome is RETURNED as an { en, fr } object — a thrown error
// would reach the user as a bare English string — so the assertions read the
// French message, which is what a French user sees.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createLocationEditor, MAX_LISTED_PLACES } from '../src/locationEditor.js';
import { LOCATIONS_KEY, MAX_LOCATIONS } from '../src/locations.js';

const NANTES = {
  name: 'Nantes',
  postal_code: '44000',
  context: 'Loire-Atlantique',
  latitude: 47.2172,
  longitude: -1.5534,
};

/**
 * An editor over an in-memory configuration, plus the handles a test needs:
 * what was written, how many times the devices were re-published, and which
 * lookups were made.
 */
function createEditor({ locations = [], places = null, isCovered = () => true } = {}) {
  // Default: one commune, carrying the postal code that was asked for — a stub
  // answering a fixed code would make every second add look like a duplicate.
  const resolve = places ?? ((postalCode) => [{ ...NANTES, postal_code: postalCode }]);
  const state = { config: normalizeConfig({ [LOCATIONS_KEY]: locations }) };
  const written = [];
  const lookups = [];
  let republished = 0;

  const editor = createLocationEditor({
    getConfig: () => state.config,
    async setConfig(patch) {
      written.push(patch);
      state.config = normalizeConfig({ ...state.config, ...patch });
    },
    onLocationsChanged: async () => {
      republished += 1;
    },
    isCovered,
    async lookupPlaces(countryCode, postalCode) {
      lookups.push({ countryCode, postalCode });
      return typeof resolve === 'function' ? resolve(postalCode) : resolve;
    },
    findCreatedDevice: async () => null,
  });

  return {
    ...editor.actions,
    state,
    written,
    lookups,
    get republished() {
      return republished;
    },
  };
}

test('adding a postal code stores the commune it resolves to', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ country: 'FR', postal_code: '44000' });

  assert.match(message.fr, /Lieu 1 « Nantes » ajouté/);
  assert.match(message.fr, /Découverte/, 'the user must be told where the device shows up');
  assert.equal(editor.state.config.locations.length, 1);

  const [location] = editor.state.config.locations;
  assert.equal(location.city, 'Nantes');
  assert.equal(location.postal_code, '44000');
  assert.equal(location.country, 'FR');
  assert.equal(location.latitude, 47.2172);
  assert.equal(location.address_label, 'Nantes (44000), Loire-Atlantique');
});

test('adding persists the list and re-publishes the devices', async () => {
  const editor = createEditor();
  await editor.add_location({ postal_code: '44000' });

  assert.equal(editor.written.length, 1);
  assert.ok(Array.isArray(editor.written[0][LOCATIONS_KEY]));
  assert.equal(editor.republished, 1, 'without this the Discovery tab stays stale');
});

test('a name given by the user wins over the commune name', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', postal_code: '44000' });
  assert.equal(editor.state.config.locations[0].name, 'Maison');
});

test('an empty postal code asks for one instead of querying anything', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ postal_code: '  ' });

  assert.match(message.fr, /code postal/i);
  assert.equal(editor.lookups.length, 0, 'an empty field must not cost a request');
  assert.equal(editor.state.config.locations.length, 0);
});

test('a malformed postal code is refused before the request, and says the shape', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ postal_code: '440' });

  assert.match(message.fr, /n'est pas un code postal/);
  assert.match(message.fr, /44000/, 'the expected shape must be shown');
  assert.equal(editor.lookups.length, 0);
});

test('an unknown country code falls back to the default instead of failing', async () => {
  const editor = createEditor();
  // Unreachable through the form, reachable through a hand-written config: the
  // country select only offers registered codes.
  const message = await editor.add_location({ country: 'ZZ', postal_code: '44000' });
  // normalizeCountry falls back to the default, so this resolves normally —
  // what matters is that nothing crashes and the location lands somewhere real.
  assert.equal(editor.state.config.locations[0]?.country, 'FR');
  assert.match(message.fr, /ajouté/);
});

test('an unknown postal code says so and stores nothing', async () => {
  const editor = createEditor({ places: [] });
  const message = await editor.add_location({ postal_code: '99999' });

  assert.match(message.fr, /Aucune commune trouvée/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('a postal code covering several communes asks WHICH ONE, and lists them', async () => {
  // Picking the first would silently report another town's air.
  const editor = createEditor({
    places: [
      { ...NANTES, name: 'Châtillon-sur-Chalaronne', postal_code: '01400', context: 'Ain' },
      { ...NANTES, name: 'Romans', postal_code: '01400', context: 'Ain' },
    ],
  });
  const message = await editor.add_location({ postal_code: '01400' });

  assert.match(message.fr, /couvre 2 communes/);
  assert.match(message.fr, /Châtillon-sur-Chalaronne/);
  assert.match(message.fr, /Romans/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('a long candidate list is truncated rather than flooding the message', async () => {
  const places = Array.from({ length: MAX_LISTED_PLACES + 5 }, (_, index) => ({
    ...NANTES,
    name: `Commune ${index}`,
  }));
  const editor = createEditor({ places });
  const message = await editor.add_location({ postal_code: '44000' });

  assert.match(message.fr, /\(\+5\)/);
});

test('naming the commune resolves an ambiguous postal code', async () => {
  const editor = createEditor({
    places: [
      { ...NANTES, name: 'Châtillon-sur-Chalaronne', postal_code: '01400', context: 'Ain' },
      { ...NANTES, name: 'Romans', postal_code: '01400', context: 'Ain' },
    ],
  });
  const message = await editor.add_location({ postal_code: '01400', city: 'romans' });

  assert.match(message.fr, /ajouté/);
  assert.equal(editor.state.config.locations[0].city, 'Romans');
});

test('the commune is matched without accents, as nobody types them in a form', async () => {
  const editor = createEditor({
    places: [{ ...NANTES, name: 'Saint-Étienne', postal_code: '42000', context: 'Loire' }],
  });
  await editor.add_location({ postal_code: '42000', city: 'saint-etienne' });
  assert.equal(editor.state.config.locations[0].city, 'Saint-Étienne');
});

test('an exact commune name wins over a longer one that starts the same', async () => {
  const editor = createEditor({
    places: [
      { ...NANTES, name: 'Nantes' },
      { ...NANTES, name: 'Nantes-en-Ratier' },
    ],
  });
  await editor.add_location({ postal_code: '44000', city: 'Nantes' });
  assert.equal(editor.state.config.locations[0].city, 'Nantes');
});

test('a commune the postal code does not cover lists the ones it does', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ postal_code: '44000', city: 'Rennes' });

  assert.match(message.fr, /aucune commune nommée/);
  assert.match(message.fr, /Nantes/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('the same commune is not added twice, and the duplicate is named', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', postal_code: '44000' });
  const message = await editor.add_location({ postal_code: '44000' });

  assert.match(message.fr, /déjà surveillé par le lieu 1 « Maison »/);
  assert.equal(editor.state.config.locations.length, 1);
});

test('a point no source covers is refused rather than published empty', async () => {
  const editor = createEditor({ isCovered: () => false });
  const message = await editor.add_location({ postal_code: '44000' });

  assert.match(message.fr, /Aucune source de qualité de l'air ne couvre/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('the cap is enforced before anything is queried', async () => {
  const locations = Array.from({ length: MAX_LOCATIONS }, (_, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    country: 'FR',
    postal_code: '44000',
    city: `Commune ${index}`,
    latitude: '47.2',
    longitude: '-1.5',
  }));
  const editor = createEditor({ locations });
  const message = await editor.add_location({ postal_code: '75001' });

  assert.match(message.fr, new RegExp(`Maximum ${MAX_LOCATIONS}`));
  assert.equal(editor.lookups.length, 0);
});

test('the listing numbers the locations the delete dropdown offers', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', postal_code: '44000' });
  await editor.add_location({ name: 'Bureau', postal_code: '44100' });

  const message = await editor.list_locations();
  assert.match(message.fr, /2\/20 lieu\(x\)/);
  // The name is bolded with Mathematical Alphanumeric Symbols (src/richText.js),
  // so the plain text to look for is the detail the line ends with.
  assert.match(message.fr, /Nantes \(44000\)/);
  assert.match(message.fr, /Nantes \(44100\)/);
  assert.equal(message.fr.split('\n').length, 3, 'a header plus one line per location');
});

test('an empty list points at the button that fills it', async () => {
  const editor = createEditor();
  const message = await editor.list_locations();
  assert.match(message.fr, /Ajouter un lieu/);
});

test('deleting asks for a confirmation, and changes nothing until it gets one', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', postal_code: '44000' });

  const message = await editor.remove_location({ location: '1' });
  assert.match(message.fr, /Cochez « Je confirme »/);
  assert.match(message.fr, /Maison/);
  assert.equal(editor.state.config.locations.length, 1);
});

test('a confirmed deletion removes the location and re-publishes', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', postal_code: '44000' });
  const before = editor.republished;

  const message = await editor.remove_location({ location: '1', confirmation: true });
  assert.match(message.fr, /supprimé/);
  assert.equal(editor.state.config.locations.length, 0);
  assert.equal(editor.republished, before + 1);
});

test('deleting a middle location warns that the numbers moved', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'A', postal_code: '44000' });
  await editor.add_location({ name: 'B', postal_code: '44100' });
  await editor.add_location({ name: 'C', postal_code: '44200' });

  const message = await editor.remove_location({ location: '2', confirmation: true });
  assert.match(message.fr, /remontent d'un rang/);
});

test('deleting the last location says nothing about renumbering', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'A', postal_code: '44000' });
  const message = await editor.remove_location({ location: '1', confirmation: true });
  assert.ok(!/remontent/.test(message.fr));
});

test('a location whose device exists says the device stays behind', async () => {
  const state = { config: normalizeConfig({}) };
  const editor = createLocationEditor({
    getConfig: () => state.config,
    async setConfig(patch) {
      state.config = normalizeConfig({ ...state.config, ...patch });
    },
    onLocationsChanged: async () => {},
    lookupPlaces: async () => [NANTES],
    // An integration cannot delete a Gladys device: the message must say so
    // rather than leave a sensor that never updates again.
    findCreatedDevice: async () => ({ name: "Qualité de l'air — Maison" }),
  }).actions;

  await editor.add_location({ name: 'Maison', postal_code: '44000' });
  const message = await editor.remove_location({ location: '1', confirmation: true });

  assert.match(message.fr, /existe toujours dans Gladys/);
  assert.match(message.fr, /Qualité de l'air — Maison/);
});

test('a device lookup failure does not block the deletion the user asked for', async () => {
  const state = { config: normalizeConfig({}) };
  const editor = createLocationEditor({
    getConfig: () => state.config,
    async setConfig(patch) {
      state.config = normalizeConfig({ ...state.config, ...patch });
    },
    onLocationsChanged: async () => {},
    lookupPlaces: async () => [NANTES],
    findCreatedDevice: async () => {
      throw new Error('host unreachable');
    },
  }).actions;

  await editor.add_location({ name: 'Maison', postal_code: '44000' });
  const message = await editor.remove_location({ location: '1', confirmation: true });

  assert.match(message.fr, /supprimé/);
  assert.equal(state.config.locations.length, 0);
});

test('deleting a position that does not exist lists the ones that do', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', postal_code: '44000' });

  const message = await editor.remove_location({ location: '7', confirmation: true });
  assert.match(message.fr, /Il n'y a pas de lieu 7/);
  assert.match(message.fr, /Nantes \(44000\)/);
  assert.equal(editor.state.config.locations.length, 1);
});

test('deleting from an empty list points at the button that fills it', async () => {
  const editor = createEditor();
  const message = await editor.remove_location({ location: '1', confirmation: true });
  assert.match(message.fr, /Ajouter un lieu/);
});

test('every action answers in both languages, never as a bare string', async () => {
  const editor = createEditor();
  const messages = [
    await editor.add_location({ postal_code: '44000' }),
    await editor.list_locations(),
    await editor.remove_location({ location: '1' }),
  ];
  for (const message of messages) {
    assert.equal(typeof message.en, 'string', 'a thrown/plain string loses the translation');
    assert.equal(typeof message.fr, 'string');
  }
});
