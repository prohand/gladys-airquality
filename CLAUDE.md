# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

A Gladys Assistant **external integration**: a Node container that connects to a
Gladys host over WebSocket + HTTP through `@gladysassistant/integration-sdk`. It
is not a library and there is no local Gladys to run against — correctness is
established by the unit tests and by the manifest/code consistency checks.

It exposes the air quality index of user-chosen locations, configured by postal
code. Data comes from two open, key-free APIs: Open-Meteo's air-quality endpoint
(CAMS European data) for the concentrations, and `geo.api.gouv.fr` (API Géo) for
turning a French postal code into a commune. See `README.md` for why Atmo France
was set aside.

## Commands

```bash
npm test                                     # node --test, network-free
node --test test/scale.test.js               # one file
node --test --test-name-pattern="dominant"   # one test by name
npm run lint                                 # eslint
npm run format:check                         # prettier, CI gate
npm run format                               # prettier --write
```

CI runs `format:check`, then `lint`, then `test`, on Node 24 (the Dockerfile's
runtime). Run all three before pushing — a formatting diff fails the build.

## Architecture

### Devices are a projection of the configuration

The upstream template (`integration-template-js`) uses a **static** array of
device blueprints. This integration inverts that: there is one device _type_
(`src/devices/airQualityStation.js`) and a variable number of devices, one per
entry in `config.locations`. Copying template device patterns will therefore
mislead you — the blueprint's `buildDevices`/`deviceExternalIds` map over
`watchedLocations(config)`.

A device's identity is `<type>:<location id>`, and the location id is generated
once, when the user adds the location. Renaming a location keeps the device, its
history and its place in rooms and scenes.

### The location list is the single source of truth

`src/locations.js` owns the data, `src/locationEditor.js` the three actions that
change it. Consequences worth internalising:

- **`locations` is deliberately absent from `config_schema`.** No static form can
  hold a list built at runtime. It is written through `gladys.setConfig()` — the
  documented way to store integration-owned state outside the schema. A test
  asserts it stays out of the schema.
- **`setConfig` does not come back through `onConfigUpdated`.** A self-initiated
  write must update the in-memory `config` by hand. The `setConfig` dependency
  injected into the editor in `index.js` is the only place allowed to do this.
- **Coordinates travel as TEXT** (`src/coordinates.js`). `Number('')` is 0 — a
  valid latitude — and a `number` field is an `<input type="number">` the browser
  sanitizes in its own locale, so a French one silently drops `48.8566`.
- **Positions, not names, are what a user can pick.** A manifest `select` has
  static options, so the delete dropdown offers `1..MAX_LOCATIONS` and the
  listing action is what maps a number to a location. `MAX_LOCATIONS` and the
  option list are kept in sync by `test/manifest.test.js`.

`publishDiscoveredDevices()` **replaces** the previously published list. That is
the deletion mechanism: removing a location and re-publishing is what makes it
leave the Discovery tab. Creating/deleting the actual Gladys device stays the
user's action — an integration cannot delete one, which is why the delete action
names the device it leaves behind.

### Action messages are returned, never thrown

The SDK acks a thrown handler error as a plain `error: e.message` string, which
loses the multi-language message. Every expected, user-facing outcome — a
malformed postal code, an ambiguous one, a location outside the coverage — is
**returned** as an `{ en, fr }` object; only unexpected failures throw. That
message is also the only thing the Configuration screen displays of what this
integration has to say, hence the listing being an action too.

### Names are the only text this integration has to translate itself

Everything displayed — action results, connection status — is returned as
`{ en, fr }` and rendered by the core in the reader's language. Device and
feature **names** cannot work that way: they are plain strings stored in
`t_device_feature.name` when the user creates the device, and the host API
exposes no user language at all.

Hence `src/language.js`: `config.language`, a manifest `select`, **`fr` by
default**. It is threaded through `buildDevice`/`buildStates`/`poll` as an
argument rather than read from a module-level variable, so the mapping stays
testable in both languages. The two TEXT states follow it too — a stored state is
a string like a name, translated by nobody downstream.

Re-publishing does NOT rename an existing device: the core upserts the params of
the devices already created, never their name. A language switch therefore
applies to the devices still to be created, which the manifest description and
`docs/` both say.

### Two extension registries, kept separate on purpose

**`src/countries/`** — a country knows how to turn its national postal code into
a point: `{ code, name, postalCodeExample, isValidPostalCode, lookupPostalCode }`.
This is where a new country goes, and the ONLY place a country exists at all:
everything downstream works on a latitude and a longitude. Adding one is a new
module, one line in `COUNTRIES`, **and one option in the manifest `country`
select** — that third step cannot be automated (a manifest `select` has static
options) and `test/manifest.test.js` fails when it is forgotten.

**`src/airQuality/`** — a provider knows how to read concentrations for a point:
`{ key, name, pollutants, supports(point), fetchConcentrations(point) }`, first
match wins, so callers never name an implementation. Order matters: a national
source registered before `openMeteoProvider` overrides it for its own area.

A new country must fall inside some provider's coverage (today, the CAMS
European bounding box), otherwise adding a location there is refused — on
purpose.

### The index scale is the domain

`src/airQuality/scale.js` owns the thresholds and nothing else does. They are the
European Air Quality Index bands (EEA), which are also the French ATMO bands
since the arrêté du 10 juillet 2020. Read the file header before touching a
number in it.

### The manifest is a contract checked by tests

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code:
every action has a handler _and_ every handler has a button, `DEFAULT_CONFIG`
matches the manifest defaults, the delete dropdown offers exactly
`MAX_LOCATIONS` positions, the `country` select offers exactly `COUNTRIES`,
`section` fields stay valueless, every label is bilingual. When you change one
side, the test tells you about the other.

Config/action field types: `string` (not `text`), `number`, `boolean`, `select`,
`multi_select`, `secret`, `oauth2`, `section`.

Do not hand-edit `version` or `docker_image` in the manifest — the release
workflow rewrites both.

## Gladys core constraints that are not obvious

Each of these caused a real bug in the sibling pollen integration; the first two
leave the Discovery tab silently empty. The core sources are worth cloning when
in doubt (`GladysAssistant/Gladys`, public, read-only clone is enough); the
discovery payload is validated by
`server/lib/external-integration/externalIntegration.setDiscoveredDevices.js`.

- **`poll_frequency` is an ENUM in MILLISECONDS capped at one minute.** Anything
  else is rejected and the **whole batch** is refused. Hence the self-driven
  timer: the devices declare no `poll_frequency`, `startPolling` refreshes
  immediately then every `poll_frequency` seconds, floored at
  `MIN_REFRESH_SECONDS`.
- **Every feature needs an explicit numeric `min` and `max`** —
  `t_device_feature.min/max` are `NOT NULL` with no default, text features
  included. Publishing passes, then the user's "add device" click fails.
- **`category`, `type` and `unit` are validated independently**, each against a
  flat list — the core does not check that a type belongs to its category. So a
  nonsensical pair is accepted by the API and only looks wrong in the UI. Stick
  to the pairs the front has translations for: `airquality-sensor`/`aqi`,
  `pm25-sensor`/`decimal`, `pm10-sensor`/`decimal`, `text`/`text`. NO₂, O₃ and
  SO₂ have **no** concentration category — that is why only their sub-index is
  published.
- **A refused batch is invisible unless you say so**: the error only reaches the
  SDK acknowledgement. `publishDevices()` logs the payload at debug level and
  reports the reason through `setConnectionStatus`.
- **The core silently drops states for a feature that does not exist yet.**
  States published before the user adds the device go nowhere, which is why
  `index.js` listens to `onDeviceCreated` and refreshes immediately.
- **A newline does not survive the Configuration screen** (`white-space: normal`
  on a plain `<div class="alert">`), and markup is escaped. Hence
  `LOCATION_LINE_MARKER` opening every entry of a list, and the Unicode bold of
  `src/richText.js` for the label that opens it. A consequence for tests: a
  location NAME in a listing is bolded with Mathematical Alphanumeric Symbols, so
  `/Maison/` will not match it — assert on the plain detail instead.

## Invariants

- **Missing data is `null`, never a good index.** A pollutant the model has no
  value for publishes no state at all. This runs from `concentrationToIndex()`
  through `buildStates()`; a 1 would corrupt the history and could fire an "air
  is good again" scene. `overallIndex()` likewise reports no dominant pollutant
  at class 1.
- **Index thresholds are per pollutant** (`src/airQuality/scale.js`). 45 µg/m³ is
  "poor" for PM2.5 and "good" for ozone. Don't unify the bands.
- **A postal code is never resolved by coin flip.** Several communes can share
  one; the editor lists them and asks. Picking the first would silently report
  another town's air.
- **A GeoJSON `centre` is `[longitude, latitude]`**, unpacked once in
  `src/countries/france.js`. Getting it backwards puts French communes in
  Somalia; a test pins it.
- **A location id is never reused and never derived from what the user can
  edit** — it becomes the device `external_id`, so a reused id would hand a
  deleted location's device history to the next one created.
- **Provider coverage is checked before use** (`supports()`): outside the CAMS
  European domain the point is refused when the location is added, and
  `watchedLocations()` filters any stored one.
- **A refresh cycle never throws.** A rejection inside a timer callback would
  take the container down; one location failing must not silence the others.

## Testing

Tests never touch the network: `globalThis.fetch` is stubbed per-file and
restored in `afterEach`. `src/airQuality/openMeteo.js` keeps a module-level TTL
cache, so tests that count requests must call `clearAirQualityCache()` in
`beforeEach` — otherwise state leaks between tests.

`test/helpers/fakeGladys.js` is the in-memory SDK stand-in; extend it when you
use a new SDK method rather than mocking the SDK itself. The location editor
takes its outside world by injection (`getConfig`, `setConfig`, `lookupPlaces`,
`isCovered`, `findCreatedDevice`), so `test/locationEditor.test.js` exercises the
buttons with no Gladys and no network at all.
