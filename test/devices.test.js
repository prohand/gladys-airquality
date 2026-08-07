// -----------------------------------------------------------------------------
// The device blueprint: the discovery payload Gladys must accept, and the
// mapping from a provider reading to the states it publishes.
//
// The core refuses the WHOLE batch on one bad feature and reports it only
// through the SDK acknowledgement, so these assertions are what stands between
// a change here and a silently empty Discovery tab.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { allPollutants } from '../src/airQuality/index.js';
import { INDEX_LABELS, INDEX_LEVELS, INDEX_MAX, INDEX_MIN } from '../src/airQuality/scale.js';
import { normalizeConfig } from '../src/config.js';
import {
  airQualityStation,
  buildDevice,
  buildStates,
  concentrationFeatureId,
  DEVICE_TYPE,
  FEATURE,
  subIndexFeatureId,
  watchedLocations,
} from '../src/devices/airQualityStation.js';
import { buildDiscoveredDevices, findBlueprintByDevice } from '../src/devices/index.js';
import { LOCATIONS_KEY } from '../src/locations.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const NANTES = {
  id: 'loc-11111111',
  name: 'Maison',
  address_label: 'Nantes, Loire-Atlantique, France',
  latitude: '47.2172',
  longitude: '-1.5534',
};

const SYDNEY = {
  ...NANTES,
  id: 'loc-22222222',
  name: 'Antipodes',
  address_label: 'Sydney, New South Wales, Australie',
  latitude: '-33.8688',
  longitude: '151.2093',
};

function configWith(...locations) {
  return normalizeConfig({ [LOCATIONS_KEY]: locations });
}

test('one device is published per usable, covered location', () => {
  const gladys = createFakeGladys();
  const config = configWith(NANTES, { ...NANTES, id: 'loc-2', name: 'Bureau' });

  const devices = buildDiscoveredDevices(gladys, config);
  assert.equal(devices.length, 2);
  assert.deepEqual(
    devices.map((device) => device.name),
    ["Qualité de l'air — Maison", "Qualité de l'air — Bureau"],
  );
});

test('a location outside Europe is published like any other', () => {
  // The global CAMS model covers it, so there is nothing left to exclude.
  const config = configWith(NANTES, SYDNEY);
  assert.deepEqual(
    watchedLocations(config).map((location) => location.id),
    [NANTES.id, SYDNEY.id],
  );
});

test('a location whose stored point is not one is still not published', () => {
  // Better no device than a sensor stuck forever on "no recent value".
  const config = configWith({ ...NANTES, latitude: '300' });
  assert.equal(watchedLocations(config).length, 0);
});

test('a location with unusable coordinates is not published either', () => {
  const config = configWith({ ...NANTES, latitude: '' });
  assert.equal(watchedLocations(config).length, 0);
});

test('the device identity is derived from the location id, not from its name', () => {
  // Renaming a location must keep the device, its history, its rooms, its
  // scenes: the id is generated once and never derived from what the user edits.
  const gladys = createFakeGladys();
  const original = buildDevice(gladys, NANTES).external_id;
  const renamed = buildDevice(gladys, { ...NANTES, name: 'Chez moi' }).external_id;
  assert.equal(original, `${DEVICE_TYPE}:${NANTES.id}`);
  assert.equal(renamed, original);
});

test('every published feature carries what the core requires', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith(NANTES));

  assert.ok(device.features.length > 0);
  const seen = new Set();
  for (const feature of device.features) {
    // t_device_feature.min/max are NOT NULL with no default: publishing passes
    // and the user's "add device" click then fails.
    assert.equal(typeof feature.min, 'number', `${feature.name} has no min`);
    assert.equal(typeof feature.max, 'number', `${feature.name} has no max`);
    assert.equal(feature.read_only, true, `${feature.name} is a sensor`);
    assert.equal(typeof feature.name, 'string');
    assert.ok(feature.name.length > 0);
    assert.ok(
      Object.values(DEVICE_FEATURE_CATEGORIES).includes(feature.category),
      `${feature.name}: unknown category ${feature.category}`,
    );
    assert.ok(!seen.has(feature.external_id), `duplicated external_id ${feature.external_id}`);
    seen.add(feature.external_id);
  }
});

test('no device declares a poll_frequency', () => {
  // The core only accepts a fixed enum of intervals in MILLISECONDS capped at
  // one minute; anything else has the WHOLE batch refused. The integration
  // drives its own timer instead.
  const gladys = createFakeGladys();
  for (const device of buildDiscoveredDevices(gladys, configWith(NANTES))) {
    assert.equal(device.poll_frequency, undefined);
  }
});

test('the index features are air quality sensors on the 1-6 scale', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith(NANTES));
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);

  const index = device.features.find((f) => f.external_id === ids.feature(FEATURE.INDEX));
  assert.equal(index.category, DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR);
  assert.equal(index.type, DEVICE_FEATURE_TYPES.AIRQUALITY_SENSOR.AQI);
  assert.equal(index.unit, DEVICE_FEATURE_UNITS.AQI);
  assert.equal(index.min, INDEX_MIN);
  assert.equal(index.max, INDEX_MAX);
});

test('every pollutant gets a sub-index feature', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith(NANTES));
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);

  for (const pollutant of allPollutants()) {
    const feature = device.features.find(
      (f) => f.external_id === subIndexFeatureId(ids, pollutant),
    );
    assert.ok(feature, `${pollutant} has no sub-index feature`);
    assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.AIRQUALITY_SENSOR);
  }
});

test('PM2.5 and PM10 also get their concentration, in µg/m³', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith(NANTES));
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);

  const pm25 = device.features.find((f) => f.external_id === concentrationFeatureId(ids, 'pm2_5'));
  assert.equal(pm25.category, DEVICE_FEATURE_CATEGORIES.PM25_SENSOR);
  assert.equal(pm25.type, DEVICE_FEATURE_TYPES.SENSOR.DECIMAL);
  assert.equal(pm25.unit, DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER);

  const pm10 = device.features.find((f) => f.external_id === concentrationFeatureId(ids, 'pm10'));
  assert.equal(pm10.category, DEVICE_FEATURE_CATEGORIES.PM10_SENSOR);

  // The gases have no dedicated concentration category in Gladys: their
  // sub-index is what carries them, rather than an "unknown" feature.
  assert.equal(
    device.features.find((f) => f.external_id === concentrationFeatureId(ids, 'ozone')),
    undefined,
  );
});

test('the device carries the place it was resolved from, for debugging', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith(NANTES));
  const params = Object.fromEntries(device.params.map((p) => [p.name, p.value]));

  assert.equal(params.LOCATION_ID, NANTES.id);
  assert.equal(params.ADDRESS_LABEL, 'Nantes, Loire-Atlantique, France');
  assert.equal(params.LATITUDE, '47.2172');
  assert.equal(params.LONGITUDE, '-1.5534');
});

test('the feature names follow the configured language', () => {
  const gladys = createFakeGladys();
  const fr = buildDevice(gladys, NANTES, 'fr');
  const en = buildDevice(gladys, NANTES, 'en');

  assert.match(fr.name, /^Qualité de l'air —/);
  assert.match(en.name, /^Air quality —/);
  assert.ok(fr.features.some((f) => f.name === 'Polluant dominant'));
  assert.ok(en.features.some((f) => f.name === 'Dominant pollutant'));
  assert.ok(fr.features.some((f) => f.name.startsWith('Sous-indice')));
  assert.ok(en.features.some((f) => f.name.endsWith('sub-index')));
});

test('a reading becomes one state per feature that has a value', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const reading = {
    concentrations: { pm2_5: 5, pm10: 45, ozone: 250 },
    subIndexes: {
      pm2_5: INDEX_LEVELS.GOOD,
      pm10: INDEX_LEVELS.MODERATE,
      ozone: INDEX_LEVELS.VERY_POOR,
    },
    overall: { level: INDEX_LEVELS.VERY_POOR, pollutant: 'ozone' },
  };

  const states = buildStates(ids, reading, 'fr');
  const byId = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id, s.state ?? s.text]),
  );

  assert.equal(byId[ids.feature(FEATURE.INDEX)], INDEX_LEVELS.VERY_POOR);
  assert.equal(byId[ids.feature(FEATURE.INDEX_TEXT)], INDEX_LABELS[INDEX_LEVELS.VERY_POOR].fr);
  assert.equal(byId[ids.feature(FEATURE.DOMINANT_POLLUTANT)], 'Ozone (O₃)');
  assert.equal(byId[subIndexFeatureId(ids, 'pm10')], INDEX_LEVELS.MODERATE);
  assert.equal(byId[concentrationFeatureId(ids, 'pm2_5')], 5);
  assert.equal(byId[concentrationFeatureId(ids, 'pm10')], 45);
});

test('a pollutant with no value publishes NOTHING, never a 1', () => {
  // A missing measurement is not clean air: a 1 would pollute the history and
  // could fire an "air is good again" scene.
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const states = buildStates(
    ids,
    {
      concentrations: { pm2_5: null, pm10: 45 },
      subIndexes: { pm2_5: null, pm10: INDEX_LEVELS.MODERATE },
      overall: { level: INDEX_LEVELS.MODERATE, pollutant: 'pm10' },
    },
    'fr',
  );

  const ids_published = states.map((s) => s.device_feature_external_id);
  assert.ok(!ids_published.includes(subIndexFeatureId(ids, 'pm2_5')));
  assert.ok(!ids_published.includes(concentrationFeatureId(ids, 'pm2_5')));
  assert.ok(ids_published.includes(subIndexFeatureId(ids, 'pm10')));
});

test('nothing measured at all publishes nothing at all', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const states = buildStates(
    ids,
    { concentrations: {}, subIndexes: {}, overall: { level: null, pollutant: null } },
    'fr',
  );
  assert.deepEqual(states, []);
});

test('good air reports no dominant pollutant, in the reader language', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const reading = {
    concentrations: { pm2_5: 2 },
    subIndexes: { pm2_5: INDEX_LEVELS.GOOD },
    overall: { level: INDEX_LEVELS.GOOD, pollutant: null },
  };

  const dominant = (language) =>
    buildStates(ids, reading, language).find(
      (s) => s.device_feature_external_id === ids.feature(FEATURE.DOMINANT_POLLUTANT),
    ).text;

  assert.equal(dominant('fr'), 'Aucun');
  assert.equal(dominant('en'), 'None');
});

test('a poll request is routed to the blueprint that owns the device', () => {
  const gladys = createFakeGladys();
  const config = configWith(NANTES);
  const [device] = buildDiscoveredDevices(gladys, config);

  assert.equal(findBlueprintByDevice(gladys, config, device), airQualityStation);
  assert.equal(
    findBlueprintByDevice(gladys, config, { external_id: 'ext:whatever:1' }),
    undefined,
    'a device of a removed location must not be claimed',
  );
});

test('polling a device no location watches fails loudly', async () => {
  const gladys = createFakeGladys();
  await assert.rejects(
    () => airQualityStation.onPoll(gladys, configWith(NANTES), 'air-quality-station:loc-gone'),
    /No location watches/,
  );
});

test('the test action says so when no location is configured', async () => {
  const gladys = createFakeGladys();
  const message = await airQualityStation.actions.test_provider(gladys, {
    config: configWith(),
  });
  assert.match(message.fr, /Aucun lieu/);
});
