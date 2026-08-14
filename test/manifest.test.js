// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code registers nor how many positions the delete dropdown
// must offer — these tests keep them in sync so a forgotten step fails CI, not
// the install.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, POLL_FREQUENCY_LIMITS } from '../src/config.js';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../src/language.js';
import { createLocationEditor } from '../src/locationEditor.js';
import { LOCATIONS_KEY, MAX_LOCATIONS } from '../src/locations.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// Every action key the code actually registers: the device blueprints own the
// one about the data source, the location manager the ones about the list.
const HANDLED_ACTIONS = [
  ...DEVICE_BLUEPRINTS.flatMap((blueprint) => Object.keys(blueprint.actions ?? {})),
  ...Object.keys(
    createLocationEditor({
      getConfig: () => ({ locations: [] }),
      setConfig: async () => {},
      onLocationsChanged: async () => {},
    }).actions,
  ),
];

// The store schema only accepts these widget types — 'text' is NOT one of them,
// the free-text widget is called 'string'.
const ALLOWED_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

/** Every field of the manifest, config fields and action fields alike. */
function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
  ];
}

function action(key) {
  return (manifest.actions ?? []).find((a) => a.key === key);
}

function field(actionKey, fieldKey) {
  return (action(actionKey)?.fields ?? []).find((f) => f.key === fieldKey);
}

test('every manifest action has a registered handler, and vice versa', () => {
  for (const declared of manifest.actions ?? []) {
    assert.ok(
      HANDLED_ACTIONS.includes(declared.key),
      `manifest action "${declared.key}" has no handler in the code`,
    );
  }
  for (const handled of HANDLED_ACTIONS) {
    assert.ok(
      (manifest.actions ?? []).some((declared) => declared.key === handled),
      `handler "${handled}" is not declared in the manifest: no button runs it`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const f of manifest.config_schema) {
    if (f.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[f.key],
        f.default,
        `default of "${f.key}" differs between the manifest and src/config.js`,
      );
    }
  }
});

test('the refresh interval bounds are the ones the code clamps to', () => {
  const pollFrequency = manifest.config_schema.find((f) => f.key === 'poll_frequency');
  assert.equal(pollFrequency.min, POLL_FREQUENCY_LIMITS.min);
  assert.equal(pollFrequency.max, POLL_FREQUENCY_LIMITS.max);
});

test('the language select offers exactly the supported languages', () => {
  const language = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    language.options.map((option) => option.value),
    LANGUAGES,
  );
  assert.equal(language.default, DEFAULT_LANGUAGE);
});

test('nothing in the add form ties a location to one country', () => {
  // The geocoder is worldwide: a country select would be a list of static
  // options gating a search that needs none. Its absence is the feature.
  assert.equal(field('add_location', 'country'), undefined);
  assert.equal(field('add_location', 'postal_code'), undefined);
});

test('the location list is NOT a config_schema field', () => {
  // No static form can hold a list built at runtime: it is stored outside the
  // schema and manipulated through the actions. See src/locations.js.
  assert.ok(
    !manifest.config_schema.some((f) => f.key === LOCATIONS_KEY),
    `"${LOCATIONS_KEY}" must stay out of config_schema`,
  );
});

test('the delete dropdown offers exactly MAX_LOCATIONS positions', () => {
  const location = field('remove_location', 'location');
  assert.equal(location.options.length, MAX_LOCATIONS);
  assert.deepEqual(
    location.options.map((option) => option.value),
    Array.from({ length: MAX_LOCATIONS }, (_, index) => String(index + 1)),
  );
});

test('the deletion is guarded by a confirmation checkbox', () => {
  const confirmation = field('remove_location', 'confirmation');
  assert.equal(confirmation.type, 'boolean');
  assert.equal(confirmation.default, false);
});

test('no field of the add action is required: a town OR a point is enough', () => {
  // Marking the town required would forbid adding a point by its coordinates,
  // which is the way out when the geocoder does not know a hamlet. The handler
  // is what checks that one of the two ways in was used.
  for (const key of ['name', 'place', 'latitude', 'longitude']) {
    assert.equal(field('add_location', key).required, false, `${key} must stay optional`);
  }
});

test('the coordinates are string fields, never number ones', () => {
  // A `number` input is sanitized by the browser in its own locale: a French
  // one silently drops "48.8566". See src/coordinates.js.
  assert.equal(field('add_location', 'latitude').type, 'string');
  assert.equal(field('add_location', 'longitude').type, 'string');
});

test('every field uses a widget type the store accepts', () => {
  for (const f of allFields()) {
    assert.ok(ALLOWED_FIELD_TYPES.includes(f.type), `field "${f.key}": unsupported type ${f.type}`);
  }
});

test('a section is a heading, never a value', () => {
  for (const f of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(f.default, undefined, `section "${f.key}" must not carry a default`);
    assert.equal(f.required, undefined, `section "${f.key}" must not be required`);
  }
});

test('every label and description is written in both languages', () => {
  const bilingual = (value, path) => {
    assert.equal(typeof value?.en, 'string', `${path}: missing English`);
    assert.equal(typeof value?.fr, 'string', `${path}: missing French`);
  };

  bilingual(manifest.description, 'manifest.description');
  for (const f of allFields()) {
    bilingual(f.label, `field ${f.key}.label`);
    for (const option of f.options ?? []) {
      bilingual(option.label, `option ${f.key}=${option.value}`);
    }
  }
  for (const declared of manifest.actions ?? []) {
    bilingual(declared.label, `action ${declared.key}.label`);
    bilingual(declared.description, `action ${declared.key}.description`);
  }
});

// The catalog card is a card: `name` and `description` are the title and the
// one-liner under it, and the store schema bounds both. A description that
// overflows is refused with "the integration manifest is invalid", at install
// time, with nothing pointing at the field — the long explanation belongs to
// the `intro` section, whose description allows 1000 characters.
test('the catalog card text fits what the store schema accepts', () => {
  assert.ok(
    manifest.name.length >= 3 && manifest.name.length <= 30,
    `name: ${manifest.name.length} characters, must be 3-30`,
  );
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language}: ${text.length} characters, must be 10-100`,
    );
  }
});

test('every action declares a timeout long enough for its network calls', () => {
  for (const declared of manifest.actions ?? []) {
    assert.ok(
      Number.isInteger(declared.timeout_seconds) && declared.timeout_seconds > 0,
      `action ${declared.key} has no usable timeout_seconds`,
    );
  }
});

test('the manifest asks for the house coordinates the import button reads', () => {
  // `GET /house` is an authorization contract, not just an endpoint: without
  // this line the core answers 403 and "Add my Gladys houses" can only apologize.
  assert.equal(manifest.location, true, 'import_houses reads GET /house');
  assert.ok(
    (manifest.actions ?? []).some((declared) => declared.key === 'import_houses'),
    'the permission is asked for a button that must exist',
  );
});

test('the compatibility range covers the version that opened GET /house', () => {
  // Before 4.85.0 the endpoint does not exist at all, and the one-click import
  // is the only way in that needs nothing typed.
  assert.match(manifest.gladys_version, /^>=4\.(8[5-9]|9\d|\d{3,})\./);
});

test('the compatibility range covers the version that added the gas categories', () => {
  // 4.86.0 is the first core that knows `no2-sensor`, `o3-sensor` and
  // `so2-sensor`. This is NOT a cosmetic floor: an unknown category has the
  // WHOLE discovery batch refused, so on an older core the Discovery tab would
  // be empty of every device, not just of the three gas concentrations.
  assert.match(manifest.gladys_version, /^>=4\.(8[6-9]|9\d|\d{3,})\./);
});

test('the manifest declares the image and the version the release workflow rewrites', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});
