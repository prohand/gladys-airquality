// -----------------------------------------------------------------------------
// The dashboard widgets: what each card is made of, and that the core would
// render it exactly as sent. `validateWidgetContent` is the SDK's own copy of
// the checks the core applies — an empty array means nothing is dropped,
// truncated or trimmed by the content budget.
//
// `fetch` is stubbed so the suite never touches the network.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { allPollutants } from '../src/airQuality/index.js';
import { clearAirQualityCache } from '../src/airQuality/openMeteo.js';
import { normalizeConfig } from '../src/config.js';
import { resetIndexMemory } from '../src/scenes/index.js';
import { findWidget, nudgeWidgets, WIDGET_KEYS } from '../src/widgets/index.js';
import { levelColor, widgetLanguage } from '../src/widgets/content.js';
import { MAX_ROWS } from '../src/widgets/locationsWidget.js';
import { forecastChart, selectedPollutants } from '../src/widgets/stationWidget.js';
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
const NANTES_DEVICE = 'air-quality-station:loc-nantes01';

const station = findWidget(WIDGET_KEYS.STATION);
const locations = findWidget(WIDGET_KEYS.LOCATIONS);

const realFetch = globalThis.fetch;

function currentPayload({ ozone = 150, pm2_5 = 12 } = {}) {
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

/** 48 hours of ozone climbing through the afternoon, the rest flat. */
function hourlyPayload() {
  const time = [];
  const ozone = [];
  for (let hour = 0; hour < 48; hour += 1) {
    const day = hour < 24 ? '22' : '23';
    time.push(`2026-09-${day}T${String(hour % 24).padStart(2, '0')}:00`);
    ozone.push(hour % 24 >= 12 && hour % 24 <= 18 ? 160 : 40);
  }
  const flat = (value) => time.map(() => value);
  return {
    timezone_abbreviation: 'CEST',
    hourly: {
      time,
      pm2_5: flat(8),
      pm10: flat(15),
      nitrogen_dioxide: flat(20),
      ozone,
      sulphur_dioxide: flat(3),
    },
  };
}

/** The current hour and the curve are two requests: answer each its own. */
function stubFetch({ current = currentPayload(), hourly = hourlyPayload(), ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('hourly=') ? hourly : current;
    return { ok, status: ok ? 200 : 503, json: async () => body };
  };
  return calls;
}

function assertRenderedAsSent(content) {
  assert.deepEqual(validateWidgetContent(content), [], 'the core would alter this content');
}

beforeEach(() => {
  clearAirQualityCache();
  resetIndexMemory();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- The station card ---------------------------------------------------------

test('the station card: name, live gauge, culprit, rows, curve, source, button', async () => {
  stubFetch();
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE },
    language: 'fr',
  });
  assertRenderedAsSent(content);

  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, ['text', 'gauge', 'value', 'status', 'chart', 'text', 'button']);

  const [heading, gauge, dominant, status, chart, caption] = content.components;
  assert.equal(heading.text, 'Maison');
  // Every pollutant followed: the gauge IS the index feature, live.
  assert.equal(gauge.device_feature, `${NANTES_DEVICE}:index`);
  assert.equal(gauge.color, 'danger');
  assert.equal(dominant.value, 'O₃');
  assert.equal(status.items[0].value, '4/6 (Mauvais)');
  // Worst first, with the concentration next to the class.
  assert.equal(status.items[1].label, 'Ozone (O₃)');
  assert.equal(status.items[1].value, '4/6 (Mauvais) · 150 µg/m³');
  assert.equal(status.items.length, 1 + allPollutants().length);
  // Five pollutants do not fit in four series: one "worst of them" curve.
  assert.equal(chart.series.length, 1);
  assert.equal(chart.series[0].points.length, 48);
  assert.equal(chart.chart_type, 'stepline');
  assert.equal(caption.text, 'CAMS · 22/09/2026 à 14:00 CEST');
});

test('the card speaks the language of its reader, not the configured one', async () => {
  stubFetch();
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE },
    language: 'en',
  });
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items[0].value, '4/6 (Poor)');
});

test('a filtered card computes its own index, and draws one curve per pollutant', async () => {
  stubFetch();
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE, pollutants: ['pm2_5', 'pm10'] },
    language: 'fr',
  });
  assertRenderedAsSent(content);

  const gauge = content.components.find((component) => component.type === 'gauge');
  // No feature holds "the worst of PM2.5 and PM10": the value is computed.
  assert.equal(gauge.device_feature, undefined);
  assert.equal(gauge.value, 2);
  assert.equal(gauge.min, 1);
  assert.equal(gauge.max, 6);

  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 3);
  const chart = content.components.find((component) => component.type === 'chart');
  assert.deepEqual(
    chart.series.map((series) => series.name),
    ['PM2,5', 'PM10'],
  );
});

test('good air shows no culprit tile', async () => {
  stubFetch({ current: currentPayload({ ozone: 20, pm2_5: 3 }) });
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE },
    language: 'fr',
  });
  assertRenderedAsSent(content);
  assert.equal(content.components.filter((component) => component.type === 'value').length, 0);
});

test('the curve can be switched off for a compact card', async () => {
  const calls = stubFetch();
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE, forecast: false },
    language: 'fr',
  });
  assertRenderedAsSent(content);
  assert.ok(!content.components.some((component) => component.type === 'chart'));
  assert.ok(!calls.some((url) => url.includes('hourly=')), 'no curve, no request for it');
});

test('a curve that fails costs the card its chart, never its index', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('hourly=')
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => currentPayload() };
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE },
    language: 'fr',
  });
  assertRenderedAsSent(content);
  assert.ok(content.components.some((component) => component.type === 'gauge'));
  assert.ok(!content.components.some((component) => component.type === 'chart'));
});

test('the curve asks the same CAMS domain as the device, never the auto blend', async () => {
  const calls = stubFetch();
  await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE },
    language: 'fr',
  });
  const curve = calls.find((url) => url.includes('hourly='));
  assert.match(curve, /domains=cams_europe/);
  assert.match(curve, /forecast_days=2/);
});

test('a card with no location picked says what to do', async () => {
  const content = await station.getContent(createFakeGladys(), config, { settings: {} });
  assertRenderedAsSent(content);
  assert.equal(content.components.length, 1);
  assert.match(content.components[0].text.fr, /réglages du widget/);
});

test('a provider outage is a caption, not an error', async () => {
  stubFetch({ ok: false });
  const content = await station.getContent(createFakeGladys(), config, {
    settings: { location: NANTES_DEVICE },
    language: 'fr',
  });
  assertRenderedAsSent(content);
  assert.match(content.components[0].text.fr, /Aucune donnée/);
});

test('the refresh pill of a station republishes that location only', async () => {
  const calls = stubFetch();
  const gladys = createFakeGladys();
  const toast = await station.onAction(
    gladys,
    config,
    'refresh',
    {},
    {
      settings: { location: NANTES_DEVICE },
    },
  );
  assert.deepEqual(toast, { en: 'Maison refreshed.', fr: 'Maison rafraîchi.' });
  assert.equal(calls.length, 1);
  assert.ok(gladys.published.length > 0);
});

test('a pollutant the code does not know is dropped from a stored selection', () => {
  assert.deepEqual(selectedPollutants(['ozone', 'radon']), ['ozone']);
  assert.deepEqual(selectedPollutants([]), allPollutants());
  assert.deepEqual(selectedPollutants(undefined), allPollutants());
});

test('a curve with no value at all is no chart', () => {
  const hours = [{ t: '2026-09-22T00:00', subIndexes: { ozone: null } }];
  assert.equal(forecastChart(hours, ['ozone'], 'fr'), null);
});

// --- The list card ------------------------------------------------------------

test('the list card: one row per location, its class and its culprit', async () => {
  stubFetch();
  const content = await locations.getContent(createFakeGladys(), config, { language: 'fr' });
  assertRenderedAsSent(content);
  const [status, caption] = content.components;
  assert.deepEqual(
    status.items.map((row) => [row.label, row.value]),
    [
      ['Maison', '4/6 (Mauvais) — Ozone (O₃)'],
      ['Bureau', '4/6 (Mauvais) — Ozone (O₃)'],
    ],
  );
  assert.equal(caption.text, 'Source : CAMS (Copernicus)');
});

test('the list card stops at the status cap, and says how many are left out', async () => {
  const many = normalizeConfig({
    locations: Array.from({ length: MAX_ROWS + 2 }, (_, index) => ({
      ...NANTES,
      id: `loc-many${String(index).padStart(4, '0')}`,
      name: `Lieu ${index + 1}`,
      latitude: String(40 + index / 10),
    })),
  });
  const calls = stubFetch();
  const content = await locations.getContent(createFakeGladys(), many, { language: 'fr' });
  assertRenderedAsSent(content);
  assert.equal(content.components[0].items.length, MAX_ROWS);
  assert.equal(
    content.components[1].text,
    `${MAX_ROWS} lieux sur ${MAX_ROWS + 2} · CAMS (Copernicus)`,
  );
  assert.equal(calls.length, MAX_ROWS, 'a row nobody sees costs no request');
});

test('one location failing is one row saying so', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('latitude=45.7679')
      ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => currentPayload() };
  const content = await locations.getContent(createFakeGladys(), config, { language: 'fr' });
  assertRenderedAsSent(content);
  assert.deepEqual(
    content.components[0].items.map((row) => row.value),
    ['4/6 (Mauvais) — Ozone (O₃)', 'indisponible'],
  );
});

test('the list card with no location says where to add one', async () => {
  const content = await locations.getContent(createFakeGladys(), normalizeConfig({}), {});
  assertRenderedAsSent(content);
  assert.match(content.components[0].text.fr, /Aucun lieu/);
});

test('the refresh pill of the list refreshes everything and counts', async () => {
  stubFetch();
  const toast = await locations.onAction(createFakeGladys(), config);
  assert.deepEqual(toast, { en: '2 location(s) refreshed.', fr: '2 lieu(x) rafraîchi(s).' });
});

// --- Shared rules ---------------------------------------------------------------

test('the bad classes are painted as bad, and no value is neutral', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(levelColor), [
    'success',
    'success',
    'warning',
    'danger',
    'danger',
    'danger',
  ]);
  assert.equal(levelColor(null), 'neutral');
});

test('a reader language this integration does not speak falls back to the configured one', () => {
  assert.equal(widgetLanguage('de', { language: 'en' }), 'en');
  assert.equal(widgetLanguage('fr-FR', { language: 'en' }), 'fr');
});

test('the refresh cycle nudges each widget once, whatever the number of locations', async () => {
  stubFetch();
  const gladys = createFakeGladys();
  const { airQualityStation } = await import('../src/devices/airQualityStation.js');
  await airQualityStation.refresh(gladys, config);
  assert.deepEqual(gladys.widgetRefreshes.sort(), Object.values(WIDGET_KEYS).sort());
});

test('a nudge that throws never breaks anything', () => {
  nudgeWidgets({
    requestWidgetRefresh() {
      throw new Error('disconnected');
    },
  });
  nudgeWidgets({});
});
