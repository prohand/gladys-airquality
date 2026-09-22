// -----------------------------------------------------------------------------
// The scene surface: WHEN a trigger fires (one event per transition, nothing
// on the first reading, no data is not a class), WHAT it carries, and what the
// scene actions answer.
//
// `fetch` is stubbed so the suite never touches the network, and the class
// memory is reset before every test so no transition leaks from one to the next.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearAirQualityCache } from '../src/airQuality/openMeteo.js';
import { normalizeConfig } from '../src/config.js';
import { poll } from '../src/devices/airQualityStation.js';
import {
  indexTransitions,
  publishIndexEvents,
  resetIndexMemory,
  SCENE_ACTION_HANDLERS,
  SCENE_TRIGGERS,
} from '../src/scenes/index.js';
import { WIDGET_KEYS } from '../src/widgets/index.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const NANTES = {
  id: 'loc-nantes01',
  name: 'Maison',
  address_label: 'Nantes, Loire-Atlantique, France',
  latitude: '47.2172',
  longitude: '-1.5534',
};
const LYON = {
  id: 'loc-lyon0001',
  name: 'Bureau',
  address_label: 'Lyon, Auvergne-Rhône-Alpes, France',
  latitude: '45.7679',
  longitude: '4.8343',
};
const config = normalizeConfig({ locations: [NANTES, LYON] });
const [nantes] = config.locations;
const NANTES_DEVICE = 'air-quality-station:loc-nantes01';

const realFetch = globalThis.fetch;

/** A `current` answer: ozone and PM2.5 are what the tests move. */
function currentPayload({ ozone = 40, pm2_5 = 5 } = {}) {
  return {
    timezone_abbreviation: 'CEST',
    current: {
      time: '2026-09-22T14:00',
      pm2_5,
      pm10: 10,
      nitrogen_dioxide: 12,
      ozone,
      sulphur_dioxide: 2,
    },
  };
}

function stubFetch(body = currentPayload(), { ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok, status: ok ? 200 : 503, json: async () => body };
  };
  return calls;
}

/** A reading as `readAirQuality` shapes it. */
function reading({ overall, pollutant = null, subIndexes = {}, concentrations = {} }) {
  return {
    provider: 'open-meteo-cams-europe',
    concentrations,
    subIndexes,
    overall: { level: overall, pollutant },
    measuredAt: '2026-09-22T14:00',
    timeZone: 'CEST',
  };
}

beforeEach(() => {
  resetIndexMemory();
  clearAirQualityCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- When does a trigger fire? ----------------------------------------------

test('the first reading after a start fires nothing', () => {
  // "unknown -> 4" is not a transition: firing it would ring every scene of
  // every location each time the container restarts.
  const moved = indexTransitions('loc-a', reading({ overall: 4, subIndexes: { ozone: 4 } }));
  assert.equal(moved.overall, null);
  assert.deepEqual(moved.pollutants, []);
});

test('a class that stays put fires nothing, one that moves fires once', () => {
  indexTransitions('loc-a', reading({ overall: 2, subIndexes: { ozone: 2 } }));
  assert.equal(
    indexTransitions('loc-a', reading({ overall: 2, subIndexes: { ozone: 2 } })).overall,
    null,
  );

  const moved = indexTransitions('loc-a', reading({ overall: 4, subIndexes: { ozone: 4 } }));
  assert.deepEqual(moved.overall, { from: 2, to: 4, direction: 'rising' });
  assert.deepEqual(moved.pollutants, [{ pollutant: 'ozone', from: 2, to: 4, direction: 'rising' }]);

  // And the same class again is not a second event.
  assert.equal(
    indexTransitions('loc-a', reading({ overall: 4, subIndexes: { ozone: 4 } })).overall,
    null,
  );
});

test('an improvement is a falling transition', () => {
  indexTransitions('loc-a', reading({ overall: 5 }));
  assert.equal(indexTransitions('loc-a', reading({ overall: 2 })).overall.direction, 'falling');
});

test('a missing value is not a return to good air', () => {
  // No data publishes no state and fires no event; the last known class is
  // kept so the next real value is compared with a real one.
  indexTransitions('loc-a', reading({ overall: 4, subIndexes: { ozone: 4 } }));
  const gap = indexTransitions('loc-a', reading({ overall: null, subIndexes: { ozone: null } }));
  assert.equal(gap.overall, null);
  assert.deepEqual(gap.pollutants, []);

  const back = indexTransitions('loc-a', reading({ overall: 3, subIndexes: { ozone: 3 } }));
  assert.deepEqual(back.overall, { from: 4, to: 3, direction: 'falling' });
});

test('two locations never share a memory', () => {
  indexTransitions('loc-a', reading({ overall: 1 }));
  assert.equal(indexTransitions('loc-b', reading({ overall: 5 })).overall, null);
});

// --- What does it carry? -----------------------------------------------------

test('an overall event carries the device, the classes as strings and a sentence', async () => {
  const gladys = createFakeGladys();
  const context = { location: nantes, deviceExternalId: NANTES_DEVICE, language: 'fr' };

  await publishIndexEvents(gladys, { ...context, reading: reading({ overall: 2 }) });
  await publishIndexEvents(gladys, {
    ...context,
    reading: reading({ overall: 4, pollutant: 'ozone', subIndexes: {} }),
  });

  assert.equal(gladys.sceneEvents.length, 1);
  const [{ key, data }] = gladys.sceneEvents;
  assert.equal(key, SCENE_TRIGGERS.INDEX_LEVEL_CHANGED);
  assert.deepEqual(data, {
    // The `source: "devices"` filter stores the device external_id.
    location: NANTES_DEVICE,
    location_name: 'Maison',
    measured_at: '22/09/2026 à 14:00 CEST',
    // Strings: a multi_select option value is a string, and the core compares.
    level: '4',
    level_label: 'Mauvais',
    previous_level: '2',
    previous_level_label: 'Moyen',
    direction: 'rising',
    pollutant: 'ozone',
    pollutant_name: 'Ozone (O₃)',
    summary: "Qualité de l'air à Maison : indice 4/6 (Mauvais), dominant Ozone (O₃).",
  });
});

test('a pollutant event carries its concentration, in the configured language', async () => {
  const gladys = createFakeGladys();
  const context = { location: nantes, deviceExternalId: NANTES_DEVICE, language: 'en' };

  await publishIndexEvents(gladys, {
    ...context,
    reading: reading({ overall: 2, subIndexes: { ozone: 2 }, concentrations: { ozone: 80 } }),
  });
  await publishIndexEvents(gladys, {
    ...context,
    reading: reading({ overall: 3, subIndexes: { ozone: 3 }, concentrations: { ozone: 112.4 } }),
  });

  const event = gladys.sceneEvents.find(
    (one) => one.key === SCENE_TRIGGERS.POLLUTANT_INDEX_LEVEL_CHANGED,
  );
  assert.equal(event.data.pollutant, 'ozone');
  assert.equal(event.data.concentration, 112.4);
  assert.equal(event.data.level, '3');
  assert.equal(event.data.summary, 'Ozone (O₃) in Maison: index 3/6 (Moderate).');
});

test('an event data stays inside what the core accepts', async () => {
  // ≤ 30 keys, one primitive each, strings ≤ 1000 characters.
  const gladys = createFakeGladys();
  const context = { location: nantes, deviceExternalId: NANTES_DEVICE };
  await publishIndexEvents(gladys, {
    ...context,
    reading: reading({ overall: 1, subIndexes: { pm2_5: 1 } }),
  });
  await publishIndexEvents(gladys, {
    ...context,
    reading: reading({ overall: 6, pollutant: 'pm2_5', subIndexes: { pm2_5: 6 } }),
  });
  assert.equal(gladys.sceneEvents.length, 2);
  for (const { data } of gladys.sceneEvents) {
    assert.ok(Object.keys(data).length <= 30);
    for (const value of Object.values(data)) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        `not a primitive: ${value}`,
      );
      if (typeof value === 'string') {
        assert.ok(value.length <= 1000);
      }
    }
  }
});

test('a refused event never takes the refresh down', async () => {
  const gladys = createFakeGladys({ refuseSceneEvents: true });
  const context = { location: nantes, deviceExternalId: NANTES_DEVICE };
  await publishIndexEvents(gladys, { ...context, reading: reading({ overall: 1 }) });
  const accepted = await publishIndexEvents(gladys, {
    ...context,
    reading: reading({ overall: 5 }),
  });
  assert.equal(accepted, 0);
});

test('the refresh cycle fires the events of a class that moved, after the states', async () => {
  const gladys = createFakeGladys();
  stubFetch(currentPayload({ ozone: 40 }));
  await poll(gladys, nantes, 'fr');
  assert.equal(gladys.sceneEvents.length, 0, 'nothing on the first reading');

  clearAirQualityCache();
  stubFetch(currentPayload({ ozone: 250 })); // ozone class 5
  await poll(gladys, nantes, 'fr');
  assert.deepEqual(gladys.sceneEvents.map((event) => event.key).sort(), [
    SCENE_TRIGGERS.INDEX_LEVEL_CHANGED,
    SCENE_TRIGGERS.POLLUTANT_INDEX_LEVEL_CHANGED,
  ]);
  assert.ok(gladys.published.length > 0, 'the states are still published');
});

// --- The scene actions -------------------------------------------------------

test('get_air_quality answers the overall class, its culprit and a sentence', async () => {
  stubFetch(currentPayload({ ozone: 150 })); // ozone class 4
  const outputs = await SCENE_ACTION_HANDLERS.get_air_quality(createFakeGladys(), {
    fields: { location: NANTES_DEVICE },
    config,
  });
  assert.deepEqual(outputs, {
    level: 4,
    level_label: 'Mauvais',
    pollutant: 'ozone',
    pollutant_name: 'Ozone (O₃)',
    concentration: 150,
    location_name: 'Maison',
    measured_at: '22/09/2026 à 14:00 CEST',
    summary: "Qualité de l'air à Maison : indice 4/6 (Mauvais), dominant Ozone (O₃).",
  });
});

test('get_air_quality names no culprit when the air is good', async () => {
  stubFetch(currentPayload());
  const outputs = await SCENE_ACTION_HANDLERS.get_air_quality(createFakeGladys(), {
    fields: { location: NANTES_DEVICE },
    config,
  });
  assert.equal(outputs.level, 1);
  assert.equal(outputs.pollutant, '');
  assert.equal(outputs.concentration, null);
});

test('get_air_quality can read one pollutant only', async () => {
  stubFetch(currentPayload({ ozone: 150, pm2_5: 12 }));
  const outputs = await SCENE_ACTION_HANDLERS.get_air_quality(createFakeGladys(), {
    fields: { location: NANTES_DEVICE, pollutant: 'pm2_5' },
    config,
  });
  assert.equal(outputs.level, 2);
  assert.equal(outputs.pollutant, 'pm2_5');
  assert.equal(outputs.concentration, 12);
  assert.equal(outputs.summary, 'PM2,5 à Maison : indice 2/6 (Moyen).');
});

test('no data is an OUTPUT, never a failure', async () => {
  // A scene action is never a condition: the author branches on `level`.
  stubFetch({ current: { time: '2026-09-22T14:00' } });
  const outputs = await SCENE_ACTION_HANDLERS.get_air_quality(createFakeGladys(), {
    fields: { location: NANTES_DEVICE },
    config,
  });
  assert.equal(outputs.level, null);
  assert.equal(outputs.summary, "Qualité de l'air à Maison : données indisponibles.");
});

test('a scene pointing at a device nobody watches fails with its id', async () => {
  await assert.rejects(
    SCENE_ACTION_HANDLERS.get_air_quality(createFakeGladys(), {
      fields: { location: 'air-quality-station:loc-gone' },
      config,
    }),
    /loc-gone/,
  );
});

test('refresh_air_quality refreshes every location when none is picked', async () => {
  const calls = stubFetch();
  const gladys = createFakeGladys();
  const outputs = await SCENE_ACTION_HANDLERS.refresh_air_quality(gladys, { fields: {}, config });
  assert.deepEqual(outputs, { refreshed: 2, failed: 0 });
  assert.equal(calls.length, 2);
  // The open dashboards are told to re-pull.
  assert.deepEqual(gladys.widgetRefreshes.sort(), Object.values(WIDGET_KEYS).sort());
});

test('refresh_air_quality counts a failing location instead of throwing', async () => {
  stubFetch({}, { ok: false });
  const outputs = await SCENE_ACTION_HANDLERS.refresh_air_quality(createFakeGladys(), {
    fields: { location: NANTES_DEVICE },
    config,
  });
  assert.deepEqual(outputs, { refreshed: 0, failed: 1 });
});
