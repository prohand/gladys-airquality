// -----------------------------------------------------------------------------
// The device blueprint: the discovery payload Gladys must accept, and the
// mapping from a provider reading to the states it publishes.
//
// The core refuses the WHOLE batch on one bad feature and reports it only
// through the SDK acknowledgement, so these assertions are what stands between
// a change here and a silently empty Discovery tab.
// -----------------------------------------------------------------------------

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { allPollutants } from '../src/airQuality/index.js';
import { clearAirQualityCache } from '../src/airQuality/openMeteo.js';
import { INDEX_LABELS, INDEX_LEVELS, INDEX_MAX, INDEX_MIN } from '../src/airQuality/scale.js';
import { normalizeConfig } from '../src/config.js';
import {
  airQualityStation,
  buildDevice,
  buildStates,
  concentrationFeatureId,
  DEVICE_TYPE,
  FEATURE,
  RETRY_DELAYS_MS,
  retryDelay,
  subIndexFeatureId,
  watchedLocations,
} from '../src/devices/airQualityStation.js';
import { buildDiscoveredDevices, findBlueprintByDevice } from '../src/devices/index.js';
import { LOCATIONS_KEY } from '../src/locations.js';
import { resetIndexMemory } from '../src/scenes/indexEvents.js';
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

const realFetch = globalThis.fetch;

beforeEach(() => {
  clearAirQualityCache();
  resetIndexMemory();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Open-Meteo, with the global model down while `down.global` holds: a status,
 * optionally with a Retry-After. NANTES is read on the European model and
 * SYDNEY on the global one, so each is ONE request of its own.
 */
function stubOpenMeteo(down = {}) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(decodeURIComponent(String(url)));
    const failure = String(url).includes('cams_global') ? down.global : null;
    if (failure) {
      return {
        ok: false,
        status: failure.status,
        headers: new Headers(failure.retryAfter ? { 'Retry-After': failure.retryAfter } : {}),
        json: async () => ({}),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ current: { time: '2026-08-06T12:00', pm10: 18, ozone: 40 } }),
    };
  };
  return urls;
}

/** Let the refresh cycle's promises run (setImmediate is not mocked). */
async function settle() {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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

// The categories the core validates against, as the integration may use them:
// the SDK's list, plus the three gas concentration categories the core gained
// after the SDK was last published (0.11.0 has no NO2_SENSOR). They are spelled
// out rather than read from the source module, so that a typo in the source is
// a failure here rather than a shared mistake — an unknown category has the
// WHOLE discovery batch refused, which leaves the Discovery tab empty.
const KNOWN_CATEGORIES = new Set([
  ...Object.values(DEVICE_FEATURE_CATEGORIES),
  'no2-sensor',
  'o3-sensor',
  'so2-sensor',
]);

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
      KNOWN_CATEGORIES.has(feature.category),
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

test('every pollutant also gets its concentration, in µg/m³', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith(NANTES));
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);

  for (const pollutant of allPollutants()) {
    const feature = device.features.find(
      (f) => f.external_id === concentrationFeatureId(ids, pollutant),
    );
    assert.ok(feature, `${pollutant} has no concentration feature`);
    assert.equal(feature.type, DEVICE_FEATURE_TYPES.SENSOR.DECIMAL);
    assert.equal(feature.unit, DEVICE_FEATURE_UNITS.MICROGRAM_PER_CUBIC_METER);
    assert.equal(feature.min, 0);
    assert.ok(feature.max > 0, `${pollutant} concentration has no usable max`);
  }

  const pm25 = device.features.find((f) => f.external_id === concentrationFeatureId(ids, 'pm2_5'));
  assert.equal(pm25.category, DEVICE_FEATURE_CATEGORIES.PM25_SENSOR);

  const pm10 = device.features.find((f) => f.external_id === concentrationFeatureId(ids, 'pm10'));
  assert.equal(pm10.category, DEVICE_FEATURE_CATEGORIES.PM10_SENSOR);

  // The three gas categories, asserted as LITERALS on purpose: the core
  // validates `category` against a flat list of these strings, and the SDK does
  // not export a constant for them yet. A typo here empties the Discovery tab.
  // NOT `no2-matter-index-sensor`: that one is an integer Matter index.
  const gasCategories = {
    nitrogen_dioxide: 'no2-sensor',
    ozone: 'o3-sensor',
    sulphur_dioxide: 'so2-sensor',
  };
  for (const [gas, category] of Object.entries(gasCategories)) {
    const feature = device.features.find((f) => f.external_id === concentrationFeatureId(ids, gas));
    assert.equal(feature.category, category);
  }
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
    measuredAt: '2026-08-06T12:00',
    timeZone: 'CEST',
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
  // The gases publish their concentration too, not only their sub-index.
  assert.equal(byId[concentrationFeatureId(ids, 'ozone')], 250);
  assert.equal(byId[ids.feature(FEATURE.MEASURED_AT)], '06/08/2026 à 12:00 CEST');
});

test('the reading time is published on the device, in the reader language', () => {
  // It belongs on each device rather than on one global one: it is the hour of
  // the model run over THAT point, in the local time of THAT point, so two
  // locations can legitimately disagree.
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const reading = {
    concentrations: { pm10: 45 },
    subIndexes: { pm10: INDEX_LEVELS.MODERATE },
    overall: { level: INDEX_LEVELS.MODERATE, pollutant: 'pm10' },
    measuredAt: '2026-08-06T12:00',
    timeZone: 'CEST',
  };

  const measuredAt = (language) =>
    buildStates(ids, reading, language).find(
      (s) => s.device_feature_external_id === ids.feature(FEATURE.MEASURED_AT),
    )?.text;

  assert.equal(measuredAt('fr'), '06/08/2026 à 12:00 CEST');
  assert.equal(measuredAt('en'), '2026-08-06 12:00 CEST');
});

test('a reading with no timestamp publishes its values and no date', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const states = buildStates(
    ids,
    {
      concentrations: { pm10: 45 },
      subIndexes: { pm10: INDEX_LEVELS.MODERATE },
      overall: { level: INDEX_LEVELS.MODERATE, pollutant: 'pm10' },
      measuredAt: null,
      timeZone: null,
    },
    'fr',
  );

  assert.ok(states.some((s) => s.device_feature_external_id === subIndexFeatureId(ids, 'pm10')));
  assert.ok(!states.some((s) => s.device_feature_external_id === ids.feature(FEATURE.MEASURED_AT)));
});

test('a timestamp with nothing measured dates nothing', () => {
  // "Updated at 12:00" next to a device holding no value would date a
  // measurement that was never made.
  const gladys = createFakeGladys();
  const ids = gladys.externalIds(DEVICE_TYPE, NANTES.id);
  const states = buildStates(
    ids,
    {
      concentrations: {},
      subIndexes: {},
      overall: { level: null, pollutant: null },
      measuredAt: '2026-08-06T12:00',
      timeZone: 'CEST',
    },
    'fr',
  );

  assert.deepEqual(states, []);
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

// --- The refresh timer and its retries ---------------------------------------

test('a location that failed is tried again after 30 s, and only that one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const down = { global: { status: 502 } };
  const urls = stubOpenMeteo(down);
  const gladys = createFakeGladys();
  const stop = airQualityStation.startPolling(gladys, configWith(NANTES, SYDNEY));

  await settle();
  assert.equal(urls.length, 2, 'one request per model');
  assert.equal(gladys.statuses.at(-1).connected, false);

  down.global = null;
  t.mock.timers.tick(RETRY_DELAYS_MS[0] - 1);
  await settle();
  assert.equal(urls.length, 2, 'not before 30 s');

  t.mock.timers.tick(1);
  await settle();
  assert.equal(urls.length, 3);
  assert.match(urls[2], /cams_global/, 'the location that worked is not read again');
  assert.equal(gladys.statuses.at(-1).connected, true, 'the retry clears the status');
  stop();
});

test('a location still failing is tried once more after 2 min, then waits for the next cycle', async (t) => {
  // Date too: the next cycle must find the cache expired, as it would be.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const urls = stubOpenMeteo({ global: { status: 503 } });
  const config = configWith(NANTES, SYDNEY);
  const stop = airQualityStation.startPolling(createFakeGladys(), config);
  await settle();

  t.mock.timers.tick(RETRY_DELAYS_MS[0]);
  await settle();
  assert.equal(urls.length, 3);

  t.mock.timers.tick(RETRY_DELAYS_MS[1]);
  await settle();
  assert.equal(urls.length, 4);

  // No third retry: hammering a service that is really down buys nothing.
  t.mock.timers.tick(10 * 60 * 1000);
  await settle();
  assert.equal(urls.length, 4);

  // The next scheduled cycle reads every location again.
  t.mock.timers.tick(
    config.poll_frequency * 1000 - RETRY_DELAYS_MS[0] - RETRY_DELAYS_MS[1] - 10 * 60 * 1000,
  );
  await settle();
  assert.equal(urls.length, 6);
  stop();
});

test('stopping the timer cancels a pending retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const urls = stubOpenMeteo({ global: { status: 502 } });
  const stop = airQualityStation.startPolling(createFakeGladys(), configWith(NANTES, SYDNEY));
  await settle();

  stop();
  t.mock.timers.tick(RETRY_DELAYS_MS[0]);
  await settle();
  assert.equal(urls.length, 2, 'a republish or a disconnection leaves no retry behind');
});

test('a throttled location waits as long as the server asked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const down = { global: { status: 429, retryAfter: '300' } };
  const urls = stubOpenMeteo(down);
  const stop = airQualityStation.startPolling(createFakeGladys(), configWith(NANTES, SYDNEY));
  await settle();

  t.mock.timers.tick(RETRY_DELAYS_MS[0]);
  await settle();
  assert.equal(urls.length, 2, 'not after 30 s: the server said 300');

  down.global = null;
  t.mock.timers.tick(300_000 - RETRY_DELAYS_MS[0]);
  await settle();
  assert.equal(urls.length, 3);
  stop();
});

test('a retry that would land after the next cycle is not scheduled', () => {
  const failures = [{ error: { retryAfterMs: 2 * 3600 * 1000 } }, { error: new Error('x') }];
  assert.equal(retryDelay(failures, 0), 2 * 3600 * 1000, 'the longest wait asked wins');
  assert.equal(retryDelay([{ error: new Error('x') }], 1), RETRY_DELAYS_MS[1]);
});

test('the refresh cycle itself never throws, and reports what failed', async () => {
  stubOpenMeteo({ global: { status: 502 } });
  const gladys = createFakeGladys();
  const failures = await airQualityStation.refresh(gladys, configWith(NANTES, SYDNEY));
  assert.deepEqual(
    failures.map((failure) => failure.location.id),
    [SYDNEY.id],
  );
  assert.match(gladys.statuses.at(-1).message.fr, /Antipodes : le rafraîchissement/);
});

// --- A device just created ---------------------------------------------------

test('a device just created refreshes its own location, not every one', async () => {
  const urls = stubOpenMeteo();
  const gladys = createFakeGladys();
  const refreshed = await airQualityStation.refreshDevice(
    gladys,
    configWith(NANTES, SYDNEY),
    `${DEVICE_TYPE}:${NANTES.id}`,
  );

  assert.equal(refreshed, true);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /cams_europe/);
  assert.ok(gladys.published.length > 0);
  assert.ok(gladys.published.every((state) => state.featureExternalId.includes(NANTES.id)));
});

test('a device no location watches refreshes nothing, and does not throw', async () => {
  const urls = stubOpenMeteo();
  const refreshed = await airQualityStation.refreshDevice(
    createFakeGladys(),
    configWith(NANTES),
    `${DEVICE_TYPE}:loc-gone`,
  );
  assert.equal(refreshed, false);
  assert.equal(urls.length, 0);
});
