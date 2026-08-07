// -----------------------------------------------------------------------------
// The four buttons of the Configuration screen, exercised with no Gladys and
// no network: the editor takes its whole outside world by injection.
//
// Every expected outcome is RETURNED as an { en, fr } object — a thrown error
// would reach the user as a bare English string — so the assertions read the
// French message, which is what a French user sees.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { MAX_LISTED_CANDIDATES } from '../src/geocoding.js';
import { HOUSE_ACCESS_DENIED } from '../src/houses.js';
import { createLocationEditor } from '../src/locationEditor.js';
import { LOCATIONS_KEY, MAX_LOCATIONS } from '../src/locations.js';

const NANTES = {
  name: 'Nantes',
  latitude: 47.2172,
  longitude: -1.5534,
  country: 'France',
  country_code: 'FR',
  admin1: 'Pays de la Loire',
  admin2: 'Loire-Atlantique',
  admin3: '',
  postcodes: ['44000'],
};

const TOKYO = {
  ...NANTES,
  name: 'Tokyo',
  latitude: 35.6895,
  longitude: 139.6917,
  country: 'Japon',
  country_code: 'JP',
  admin1: 'Tokyo',
  admin2: '',
  postcodes: [],
};

/**
 * An editor over an in-memory configuration, plus the handles a test needs:
 * what was written, how many times the devices were re-published, and which
 * queries were geocoded.
 */
function createEditor({
  locations = [],
  resolve = null,
  isCovered = () => true,
  houses = [],
  houseError = null,
} = {}) {
  const state = { config: normalizeConfig({ [LOCATIONS_KEY]: locations }) };
  const written = [];
  const queries = [];
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
    async resolvePlace(query, language) {
      queries.push({ query, language });
      // Default: one unambiguous place, whatever was typed.
      const candidates = resolve ? resolve(query) : [NANTES];
      return { match: candidates.length === 1 ? candidates[0] : null, candidates };
    },
    findCreatedDevice: async () => null,
    async listHouses() {
      if (houseError) {
        throw houseError;
      }
      return houses;
    },
  });

  return {
    ...editor.actions,
    state,
    written,
    queries,
    get republished() {
      return republished;
    },
  };
}

test('adding a town stores the point it geocodes to', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ place: 'Nantes' });

  assert.match(message.fr, /Lieu 1 « Nantes » ajouté/);
  assert.match(message.fr, /Découverte/, 'the user must be told where the device shows up');
  assert.equal(editor.state.config.locations.length, 1);

  const [location] = editor.state.config.locations;
  assert.equal(location.latitude, 47.2172);
  assert.equal(location.longitude, -1.5534);
  assert.equal(location.address_label, 'Nantes, Loire-Atlantique, France');
});

test('a town on the other side of the planet is added like any other', async () => {
  // The whole point of dropping the country registry: nothing here is French.
  const editor = createEditor({ resolve: () => [TOKYO] });
  const message = await editor.add_location({ place: 'Tokyo' });

  assert.match(message.fr, /« Tokyo » ajouté/);
  const [location] = editor.state.config.locations;
  assert.equal(location.latitude, 35.6895);
  assert.equal(location.address_label, 'Tokyo, Tokyo, Japon');
});

test('adding persists the list and re-publishes the devices', async () => {
  const editor = createEditor();
  await editor.add_location({ place: 'Nantes' });

  assert.equal(editor.written.length, 1);
  assert.ok(Array.isArray(editor.written[0][LOCATIONS_KEY]));
  assert.equal(editor.republished, 1, 'without this the Discovery tab stays stale');
});

test('the geocoder is asked in the language of the device names', async () => {
  const editor = createEditor();
  await editor.add_location({ place: 'Munich' });
  assert.equal(editor.queries[0].language, 'fr');
});

test('a name given by the user wins over the name of the place', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', place: 'Nantes' });
  assert.equal(editor.state.config.locations[0].name, 'Maison');
});

test('an empty form asks for a town instead of querying anything', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ place: '  ' });

  assert.match(message.fr, /commune/i);
  assert.equal(editor.queries.length, 0, 'an empty field must not cost a request');
  assert.equal(editor.state.config.locations.length, 0);
});

test('a town nobody knows says so and stores nothing', async () => {
  const editor = createEditor({ resolve: () => [] });
  const message = await editor.add_location({ place: 'Zzzz' });

  assert.match(message.fr, /Aucun lieu trouvé/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('a name several places share asks WHICH ONE, and lists them', async () => {
  // Picking the first would silently report another town's air.
  const editor = createEditor({
    resolve: () => [
      { ...NANTES, name: 'Paris', admin2: 'Paris' },
      { ...NANTES, name: 'Paris', country: 'États-Unis', admin1: 'Texas', admin2: 'Lamar County' },
    ],
  });
  const message = await editor.add_location({ place: 'Paris' });

  assert.match(message.fr, /Plusieurs lieux s'appellent/);
  assert.match(message.fr, /Lamar County, États-Unis/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('a long candidate list is truncated rather than flooding the message', async () => {
  const many = Array.from({ length: MAX_LISTED_CANDIDATES + 5 }, (_, index) => ({
    ...NANTES,
    admin2: `Zone ${index}`,
  }));
  const editor = createEditor({ resolve: () => many });
  const message = await editor.add_location({ place: 'Nantes' });

  assert.match(message.fr, /Zone 0/);
  assert.ok(!/Zone 9/.test(message.fr), 'the list stops at MAX_LISTED_CANDIDATES');
});

test('two coordinates win over the town, and are used as they are', async () => {
  const editor = createEditor();
  // A comma decimal separator is what a French keyboard produces.
  const message = await editor.add_location({
    place: 'Maison',
    latitude: '48,8566',
    longitude: '2,3522',
  });

  assert.match(message.fr, /ajouté/);
  assert.equal(editor.queries.length, 0, 'a typed point must not be geocoded');
  const [location] = editor.state.config.locations;
  assert.equal(location.latitude, 48.8566);
  assert.equal(location.longitude, 2.3522);
  assert.equal(location.address_label, 'Maison', 'the typed text stays as the label');
});

test('a lone coordinate is refused rather than paired with a zero', async () => {
  // Longitude 0 with a real latitude silently watches the Gulf of Guinea.
  const editor = createEditor();
  const message = await editor.add_location({ place: 'Maison', latitude: '48.8566' });

  assert.match(message.fr, /vont ensemble/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('an out-of-range coordinate is refused too', async () => {
  const editor = createEditor();
  const message = await editor.add_location({ latitude: '300', longitude: '2.3522' });
  assert.match(message.fr, /-90/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('the same point is not watched twice, and the duplicate is named', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', place: 'Nantes' });
  const message = await editor.add_location({ place: 'Nantes' });

  assert.match(message.fr, /déjà surveillé par le lieu 1 « Maison »/);
  assert.equal(editor.state.config.locations.length, 1);
});

test('a point no source covers is refused rather than published empty', async () => {
  const editor = createEditor({ isCovered: () => false });
  const message = await editor.add_location({ place: 'Nantes' });

  assert.match(message.fr, /Aucune source de qualité de l'air ne couvre/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('the cap is enforced before anything is queried', async () => {
  const locations = Array.from({ length: MAX_LOCATIONS }, (_, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: String(40 + index),
    longitude: '2.5',
  }));
  const editor = createEditor({ locations });
  const message = await editor.add_location({ place: 'Nantes' });

  assert.match(message.fr, new RegExp(`Maximum ${MAX_LOCATIONS}`));
  assert.equal(editor.queries.length, 0);
});

/** One house as `GET /house` hands it over, coordinates included or not. */
function house(name, latitude = null, longitude = null) {
  return { id: `h-${name}`, name, selector: name.toLowerCase(), latitude, longitude };
}

test('the Gladys houses become locations in one click', async () => {
  const editor = createEditor({
    houses: [house('Maison', 47.2172, -1.5534), house('Chalet', 46.5, 6.6)],
  });

  const message = await editor.import_houses();

  assert.match(message.fr, /2 maison\(s\) Gladys ajoutée\(s\)/);
  assert.match(message.fr, /Découverte/, 'the answer says where the devices show up');
  assert.equal(editor.state.config.locations.length, 2);
  const [maison, chalet] = editor.state.config.locations;
  assert.equal(maison.name, 'Maison');
  assert.equal(maison.latitude, 47.2172);
  assert.equal(maison.address_label, '', 'a house is a point, not an address');
  assert.equal(chalet.name, 'Chalet');
  assert.equal(editor.queries.length, 0, 'a house needs no geocoding: it IS a point');
  assert.equal(editor.written.length, 1, 'the whole import is ONE write');
  assert.equal(editor.republished, 1, 'and ONE Discovery refresh');
});

test('a house already watched is named rather than added twice', async () => {
  const editor = createEditor({
    locations: [{ id: 'loc-1', name: 'Domicile', latitude: '47.2172', longitude: '-1.5534' }],
    houses: [house('Maison', 47.2172, -1.5534), house('Chalet', 46.5, 6.6)],
  });

  const message = await editor.import_houses();

  assert.match(message.fr, /1 maison\(s\) Gladys ajoutée\(s\)/);
  assert.match(message.fr, /déjà le lieu 1 « Domicile »/);
  assert.equal(editor.state.config.locations.length, 2);
});

test('a house with no position on the map is not watched at (0, 0)', async () => {
  const editor = createEditor({ houses: [house('Bureau'), house('Maison', 47.2172, -1.5534)] });

  const message = await editor.import_houses();

  assert.match(message.fr, /Sans position sur la carte/);
  assert.match(message.fr, /« Bureau »/);
  assert.match(message.fr, /Réglages > Maisons/);
  assert.equal(editor.state.config.locations.length, 1);
  assert.equal(editor.state.config.locations[0].name, 'Maison');
});

test('a house no source covers is named rather than published empty', async () => {
  const editor = createEditor({
    houses: [house('Maison', 47.2172, -1.5534)],
    isCovered: () => false,
  });

  const message = await editor.import_houses();

  assert.match(message.fr, /Aucune source de qualité de l'air/);
  assert.match(message.fr, /« Maison »/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('nothing to import writes nothing at all', async () => {
  const editor = createEditor({
    locations: [{ id: 'loc-1', name: 'Domicile', latitude: '47.2172', longitude: '-1.5534' }],
    houses: [house('Maison', 47.2172, -1.5534)],
  });

  const message = await editor.import_houses();

  assert.match(message.fr, /Aucune maison à ajouter/);
  assert.equal(editor.written.length, 0, 'no write means no needless Discovery refresh');
  assert.equal(editor.republished, 0);
});

test('an instance with no house says where to create one', async () => {
  const editor = createEditor({ houses: [] });
  const message = await editor.import_houses();

  assert.match(message.fr, /aucune maison/i);
  assert.match(message.fr, /Réglages > Maisons/);
});

test('a refused permission tells the user to re-install, not to retry', async () => {
  // A 403 is the install screen's answer, not an outage: nothing the user does
  // in this screen grants it.
  const denied = Object.assign(new Error('HTTP 403'), { code: HOUSE_ACCESS_DENIED });
  const editor = createEditor({ houseError: denied });

  const message = await editor.import_houses();

  assert.match(message.fr, /réinstallez/i);
  assert.match(message.en, /re-install/i);
  assert.equal(editor.state.config.locations.length, 0);
});

test('the houses being unreadable falls back on the town name, and never throws', async () => {
  const editor = createEditor({ houseError: new Error('Gladys host API HTTP 500') });
  const message = await editor.import_houses();

  assert.match(message.fr, /HTTP 500/);
  assert.match(message.fr, /commune/);
});

test('the import respects the cap and names what it left out', async () => {
  const locations = Array.from({ length: MAX_LOCATIONS - 1 }, (_, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: String(40 + index),
    longitude: '2.5',
  }));
  const editor = createEditor({
    locations,
    houses: [house('Maison', 47.2172, -1.5534), house('Chalet', 46.5, 6.6)],
  });

  const message = await editor.import_houses();

  assert.equal(editor.state.config.locations.length, MAX_LOCATIONS);
  assert.match(message.fr, new RegExp(`Maximum de ${MAX_LOCATIONS} lieux`));
  assert.match(message.fr, /« Chalet »/);
});

test('an imported house is an ordinary location, deleted like any other', async () => {
  const editor = createEditor({ houses: [house('Maison', 47.2172, -1.5534)] });
  await editor.import_houses();

  const message = await editor.remove_location({ location: '1', confirmation: true });

  assert.match(message.fr, /supprimé/);
  assert.equal(editor.state.config.locations.length, 0);
});

test('the listing numbers the locations the delete dropdown offers', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', place: 'Nantes' });
  await editor.add_location({
    name: 'Bureau',
    place: 'Tokyo',
    latitude: '35.6895',
    longitude: '139.6917',
  });

  const message = await editor.list_locations();
  assert.match(message.fr, /2\/20 lieu\(x\)/);
  // The name is bolded with Mathematical Alphanumeric Symbols (src/richText.js),
  // so the plain text to look for is the detail the line ends with.
  assert.match(message.fr, /Nantes, Loire-Atlantique, France/);
  assert.match(message.fr, /35\.6895/);
  assert.equal(message.fr.split('\n').length, 3, 'a header plus one line per location');
});

test('an empty list points at the button that fills it', async () => {
  const editor = createEditor();
  const message = await editor.list_locations();
  assert.match(message.fr, /Ajouter un lieu/);
});

test('deleting asks for a confirmation, and changes nothing until it gets one', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', place: 'Nantes' });

  const message = await editor.remove_location({ location: '1' });
  assert.match(message.fr, /Cochez « Je confirme »/);
  assert.match(message.fr, /Maison/);
  assert.equal(editor.state.config.locations.length, 1);
});

test('a confirmed deletion removes the location and re-publishes', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', place: 'Nantes' });
  const before = editor.republished;

  const message = await editor.remove_location({ location: '1', confirmation: true });
  assert.match(message.fr, /supprimé/);
  assert.equal(editor.state.config.locations.length, 0);
  assert.equal(editor.republished, before + 1);
});

test('deleting a middle location warns that the numbers moved', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'A', latitude: '47.1', longitude: '-1.5' });
  await editor.add_location({ name: 'B', latitude: '47.2', longitude: '-1.5' });
  await editor.add_location({ name: 'C', latitude: '47.3', longitude: '-1.5' });

  const message = await editor.remove_location({ location: '2', confirmation: true });
  assert.match(message.fr, /remontent d'un rang/);
});

test('deleting the last location says nothing about renumbering', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'A', place: 'Nantes' });
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
    resolvePlace: async () => ({ match: NANTES, candidates: [NANTES] }),
    // An integration cannot delete a Gladys device: the message must say so
    // rather than leave a sensor that never updates again.
    findCreatedDevice: async () => ({ name: "Qualité de l'air — Maison" }),
  }).actions;

  await editor.add_location({ name: 'Maison', place: 'Nantes' });
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
    resolvePlace: async () => ({ match: NANTES, candidates: [NANTES] }),
    findCreatedDevice: async () => {
      throw new Error('host unreachable');
    },
  }).actions;

  await editor.add_location({ name: 'Maison', place: 'Nantes' });
  const message = await editor.remove_location({ location: '1', confirmation: true });

  assert.match(message.fr, /supprimé/);
  assert.equal(state.config.locations.length, 0);
});

test('deleting a position that does not exist lists the ones that do', async () => {
  const editor = createEditor();
  await editor.add_location({ name: 'Maison', place: 'Nantes' });

  const message = await editor.remove_location({ location: '7', confirmation: true });
  assert.match(message.fr, /Il n'y a pas de lieu 7/);
  assert.match(message.fr, /Nantes, Loire-Atlantique/);
  assert.equal(editor.state.config.locations.length, 1);
});

test('deleting from an empty list points at the button that fills it', async () => {
  const editor = createEditor();
  const message = await editor.remove_location({ location: '1', confirmation: true });
  assert.match(message.fr, /Ajouter un lieu/);
});

test('every action answers in both languages, never as a bare string', async () => {
  const editor = createEditor({ houses: [house('Chalet', 46.5, 6.6)] });
  const messages = [
    await editor.add_location({ place: 'Nantes' }),
    await editor.import_houses(),
    await editor.list_locations(),
    await editor.remove_location({ location: '1' }),
  ];
  for (const message of messages) {
    assert.equal(typeof message.en, 'string', 'a thrown/plain string loses the translation');
    assert.equal(typeof message.fr, 'string');
  }
});
