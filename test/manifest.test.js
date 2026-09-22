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
import { allPollutants } from '../src/airQuality/index.js';
import { INDEX_LABELS, INDEX_MAX, INDEX_MIN } from '../src/airQuality/scale.js';
import { DEFAULT_CONFIG, POLL_FREQUENCY_LIMITS } from '../src/config.js';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../src/language.js';
import { createLocationEditor } from '../src/locationEditor.js';
import { LOCATIONS_KEY, MAX_LOCATIONS } from '../src/locations.js';
import { OVERALL_POLLUTANT, SCENE_ACTION_HANDLERS, SCENE_TRIGGERS } from '../src/scenes/index.js';
import { WIDGETS } from '../src/widgets/index.js';

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

// The shelves of the store catalog an integration can be browsed under. They
// have nothing to do with the `category` of a device feature: those name what
// the core renders, these name where the store lists the integration.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
];

/**
 * Every field of the manifest: the configuration form, the action mini-forms,
 * the widget settings and the scene cards. They are all rendered by the same
 * `config_schema` engine, so the rules below apply to all of them.
 */
function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
    ...sceneDeclarations().flatMap((declaration) => declaration.fields ?? []),
  ];
}

/** The scene cards of the manifest, triggers and actions alike. */
function sceneDeclarations() {
  return [...(manifest.scene_triggers ?? []), ...(manifest.scene_actions ?? [])];
}

/** Their `variables` (triggers) and `outputs` (actions): the same shape. */
function sceneScalars(declaration) {
  return declaration.variables ?? declaration.outputs ?? [];
}

function widget(key) {
  return (manifest.widgets ?? []).find((w) => w.key === key);
}

function sceneTrigger(key) {
  return (manifest.scene_triggers ?? []).find((t) => t.key === key);
}

function sceneAction(key) {
  return (manifest.scene_actions ?? []).find((a) => a.key === key);
}

function fieldOf(declaration, key) {
  return (declaration.fields ?? declaration.settings ?? []).find((f) => f.key === key);
}

/** The `options` values of a field, in order. */
function optionValues(f) {
  return (f.options ?? []).map((option) => option.value);
}

function action(key) {
  return (manifest.actions ?? []).find((a) => a.key === key);
}

function field(actionKey, fieldKey) {
  return (action(actionKey)?.fields ?? []).find((f) => f.key === fieldKey);
}

/**
 * Whether the `>=X.Y.Z` floor of the manifest is at least `major.minor`.
 *
 * Compared as numbers: a regex over the digits broke the day the floor moved
 * from 4.x to 5.x.
 */
function floorAtLeast(major, minor) {
  const match = /^>=(\d+)\.(\d+)\.\d+$/.exec(manifest.gladys_version);
  assert.ok(match, `gladys_version must read ">=X.Y.Z", got "${manifest.gladys_version}"`);
  const [floorMajor, floorMinor] = [Number(match[1]), Number(match[2])];
  return floorMajor > major || (floorMajor === major && floorMinor >= minor);
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
  for (const declared of [...(manifest.widgets ?? []), ...sceneDeclarations()]) {
    bilingual(declared.label, `${declared.key}.label`);
    bilingual(declared.description, `${declared.key}.description`);
    for (const scalar of sceneScalars(declared)) {
      bilingual(scalar.label, `${declared.key}.${scalar.key}.label`);
    }
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
  assert.ok(floorAtLeast(4, 85), `gladys_version ${manifest.gladys_version} is below 4.85.0`);
});

test('the compatibility range covers the version that added the gas categories', () => {
  // 4.86.0 is the first core that knows `no2-sensor`, `o3-sensor` and
  // `so2-sensor`. This is NOT a cosmetic floor: an unknown category has the
  // WHOLE discovery batch refused, so on an older core the Discovery tab would
  // be empty of every device, not just of the three gas concentrations.
  assert.ok(floorAtLeast(4, 86), `gladys_version ${manifest.gladys_version} is below 4.86.0`);
});

test('the catalog categories are one to three keys the store knows', () => {
  // Air quality is one shelf, so one key: the field takes up to three, but a
  // shelf the integration does not belong on is a wrong answer, not a bonus.
  // An unknown key is dropped with a warning rather than refused, which is why
  // nothing but this test would tell us about a typo.
  assert.ok(Array.isArray(manifest.categories), 'categories must be an array');
  assert.ok(
    manifest.categories.length >= 1 && manifest.categories.length <= 3,
    `categories: ${manifest.categories.length} keys, must be 1-3`,
  );
  assert.equal(
    new Set(manifest.categories).size,
    manifest.categories.length,
    'the same category must not be declared twice',
  );
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown catalog category "${category}"`);
  }
  // Declaring the field at all is what needs 4.86.0 — the store validator
  // refuses the pair, and an older core refuses the unknown field.
  assert.ok(floorAtLeast(4, 86), `gladys_version ${manifest.gladys_version} is below 4.86.0`);
});

test('the manifest declares the image and the version the release workflow rewrites', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

// -----------------------------------------------------------------------------
// The three surfaces Gladys 5.1 opened: dashboard widgets, scene triggers and
// scene actions. Their failure mode is the same as the manifest actions': a
// declared key with no handler is a card that does nothing, and a handler with
// no declaration is code nobody can reach. Both are silent, so both are tested.
// -----------------------------------------------------------------------------

test('the compatibility range covers the version that opened widgets and scenes', () => {
  // An older core validates manifests against a strict field allowlist and
  // rejects the WHOLE integration over the unknown field: 5.1.0 is the floor as
  // long as any of the three is declared.
  for (const key of ['widgets', 'scene_triggers', 'scene_actions']) {
    if (manifest[key] !== undefined) {
      assert.ok(floorAtLeast(5, 1), `${key} requires gladys_version >= 5.1.0`);
    }
  }
});

test('every declared widget has a builder, and vice versa', () => {
  const handled = WIDGETS.map((w) => w.key);
  for (const declared of manifest.widgets ?? []) {
    assert.ok(handled.includes(declared.key), `widget "${declared.key}" has no builder`);
  }
  for (const key of handled) {
    assert.ok(widget(key), `widget "${key}" has a builder but no declaration`);
  }
});

test('the widgets stay inside the caps the core enforces', () => {
  assert.ok((manifest.widgets ?? []).length <= 5, 'five widgets per integration');
  for (const declared of manifest.widgets ?? []) {
    // The key `requestWidgetRefresh` accepts, and the only one worth declaring.
    assert.match(declared.key, /^[a-z0-9_]{2,32}$/);
    for (const [language, text] of Object.entries(declared.label)) {
      assert.ok(
        text.length >= 3 && text.length <= 30,
        `widget "${declared.key}".label.${language}: ${text.length} characters, must be 3-30`,
      );
    }
    for (const text of Object.values(declared.description ?? {})) {
      assert.ok(text.length <= 100, `widget "${declared.key}": the description is one line`);
    }
    assert.ok((declared.settings ?? []).length <= 10);
    if (declared.action_timeout_seconds !== undefined) {
      assert.ok(declared.action_timeout_seconds >= 5 && declared.action_timeout_seconds <= 120);
    }
  }
});

test('a widget setting never asks for a secret', () => {
  // A dashboard is readable by every user of that dashboard, non-admins
  // included: the store refuses `secret` and `oauth2` there.
  const allowed = ['string', 'number', 'boolean', 'select', 'multi_select', 'section'];
  for (const declared of manifest.widgets ?? []) {
    for (const f of declared.settings ?? []) {
      assert.ok(allowed.includes(f.type), `widget "${declared.key}": a ${f.type} setting`);
    }
  }
});

test('the station widget points at one of OUR devices, not at a typed name', () => {
  // `source: "devices"` offers the created devices of this integration and
  // stores the external_id that findLocationByDeviceId() maps back.
  const picker = fieldOf(widget('air_quality_station'), 'location');
  assert.equal(picker.type, 'select');
  assert.equal(picker.source, 'devices');
  assert.equal(picker.required, true);
  assert.equal(picker.options, undefined, '`source` and `options` are mutually exclusive');
});

test('the pollutants a widget can follow are the ones the code publishes', () => {
  const picker = fieldOf(widget('air_quality_station'), 'pollutants');
  assert.equal(picker.type, 'multi_select');
  assert.deepEqual(optionValues(picker), allPollutants());
  assert.equal(picker.default, undefined, 'nothing ticked is the "every pollutant" wildcard');
});

test('every declared scene action has a handler, and vice versa', () => {
  const handled = Object.keys(SCENE_ACTION_HANDLERS);
  for (const declared of manifest.scene_actions ?? []) {
    assert.ok(handled.includes(declared.key), `scene action "${declared.key}" runs nothing`);
  }
  for (const key of handled) {
    assert.ok(sceneAction(key), `scene action handler "${key}" is in no scene editor`);
  }
});

test('every trigger the code fires is declared, and vice versa', () => {
  const fired = Object.values(SCENE_TRIGGERS);
  for (const key of fired) {
    // The core answers 404 on an undeclared key: the event would go nowhere.
    assert.ok(sceneTrigger(key), `the code fires "${key}", the manifest does not declare it`);
  }
  for (const declared of manifest.scene_triggers ?? []) {
    assert.ok(fired.includes(declared.key), `trigger "${declared.key}" is never fired`);
  }
});

test('a scene card stays inside the caps the core enforces', () => {
  assert.ok((manifest.scene_triggers ?? []).length <= 20);
  assert.ok((manifest.scene_actions ?? []).length <= 20);
  for (const declared of sceneDeclarations()) {
    assert.match(declared.key, /^[a-z0-9_]+$/);
    assert.ok(declared.key.length <= 32);
    assert.ok((declared.fields ?? []).length <= 10);
    assert.ok(sceneScalars(declared).length <= 20);
  }
  for (const declared of manifest.scene_actions ?? []) {
    assert.ok(
      Number.isInteger(declared.timeout_seconds) &&
        declared.timeout_seconds >= 5 &&
        declared.timeout_seconds <= 120,
      `scene action "${declared.key}": timeout_seconds must be 5-120`,
    );
  }
});

test('a trigger filter is never a boolean, never required, never defaulted', () => {
  for (const declared of manifest.scene_triggers ?? []) {
    for (const f of declared.fields ?? []) {
      // A toggle has no empty state, so it could never express "any"; and a
      // default would take the wildcard away from a filter left untouched.
      assert.notEqual(f.type, 'boolean', `trigger "${declared.key}.${f.key}"`);
      assert.equal(f.default, undefined, `trigger "${declared.key}.${f.key}"`);
      assert.notEqual(f.required, true, `trigger "${declared.key}.${f.key}"`);
    }
  }
});

test('a scene variable or output is a scalar, under a unique key', () => {
  for (const declared of sceneDeclarations()) {
    const keys = sceneScalars(declared).map((scalar) => scalar.key);
    assert.equal(new Set(keys).size, keys.length, `scene "${declared.key}": duplicate key`);
    for (const scalar of sceneScalars(declared)) {
      assert.ok(['string', 'number', 'boolean'].includes(scalar.type));
      assert.match(scalar.key, /^[a-z0-9_]+$/);
    }
  }
});

test('the class filters offer exactly the 1-6 scale, named as the code names it', () => {
  const scale = Array.from({ length: INDEX_MAX - INDEX_MIN + 1 }, (_, i) => String(i + INDEX_MIN));
  for (const declared of manifest.scene_triggers ?? []) {
    const level = fieldOf(declared, 'level');
    assert.ok(level, `trigger "${declared.key}" filters on a class`);
    assert.equal(level.type, 'multi_select');
    // The event carries the class as a STRING for this very reason: a
    // multi_select stores option values, and an option value is a string.
    assert.deepEqual(optionValues(level), scale);
    for (const option of level.options) {
      for (const language of ['en', 'fr']) {
        assert.ok(
          option.label[language].endsWith(INDEX_LABELS[option.value][language]),
          `trigger "${declared.key}": class ${option.value} is not named as the code names it`,
        );
      }
    }
  }
});

test('the pollutant filters and the read action know the same pollutants', () => {
  assert.deepEqual(
    optionValues(fieldOf(sceneTrigger('pollutant_index_level_changed'), 'pollutant')),
    allPollutants(),
  );
  // The read action offers one more choice: "the worst of them", which is what
  // the overall index means.
  const read = fieldOf(sceneAction('get_air_quality'), 'pollutant');
  assert.deepEqual(optionValues(read), [OVERALL_POLLUTANT, ...allPollutants()]);
  assert.equal(read.default, OVERALL_POLLUTANT);
});

test('the scene action that reads a location requires one, the refresh does not', () => {
  // Reading needs a location; refreshing without one means "all of them".
  assert.equal(fieldOf(sceneAction('get_air_quality'), 'location').required, true);
  assert.notEqual(fieldOf(sceneAction('refresh_air_quality'), 'location').required, true);
  for (const key of ['get_air_quality', 'refresh_air_quality']) {
    assert.equal(fieldOf(sceneAction(key), 'location').source, 'devices');
  }
});
