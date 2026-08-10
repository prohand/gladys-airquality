# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

A Gladys Assistant **external integration**: a Node container that connects to a
Gladys host over WebSocket + HTTP through `@gladysassistant/integration-sdk`. It
is not a library and there is no local Gladys to run against — correctness is
established by the unit tests and by the manifest/code consistency checks.

It exposes the air quality index of user-chosen locations, **anywhere in the
world**, configured by town name (or by a typed point). Data comes from two open,
key-free APIs: Open-Meteo's air-quality endpoint (Copernicus CAMS, European model
in Europe and global model elsewhere) for the concentrations, and Open-Meteo's
geocoding endpoint (GeoNames) for turning a town name into a point. See
`README.md` for why Atmo France was set aside.

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
history and its place in rooms and scenes. A location stores nothing but an id,
a name, an address label and a point — `normalizeLocations()` rebuilds the label
of the entries written by the France-only version, which stored a country, a
postal code and a commune; that fallback is the migration, do not drop it.

### The location list is the single source of truth

`src/locations.js` owns the data, `src/locationEditor.js` the four actions that
change it (`add_location`, `import_houses`, `list_locations`,
`remove_location`). Consequences worth internalising:

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
loses the multi-language message. Every expected, user-facing outcome — a town
nobody knows, an ambiguous name, half a coordinate pair — is
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
testable in both languages. The TEXT states follow it too — a stored state is a
string like a name, translated by nobody downstream. That includes the reading
time (`src/datetime.js`): its local ISO stamp is formatted by hand, never
through `new Date()`, which would read AND re-render it in the container's
timezone and shift a foreign location by hours.

Re-publishing does NOT rename an existing device: the core upserts the params of
the devices already created, never their name. A language switch therefore
applies to the devices still to be created, which the manifest description and
`docs/` both say.

### The Gladys houses are a permission, not just an endpoint

`src/houses.js` reads `GET /api/integration/v1/house` — the coordinates the user
already placed on the map in "Settings > Houses" — and `import_houses` turns them
into locations in one click. Three things hold it together:

- **`"location": true` in the manifest is an authorization contract.** Where
  somebody lives is personal data: the core shows the request on the install
  screen and enforces it server-side, so an integration that does not declare it
  gets a **403**. That status is therefore told apart from every other failure
  (`HOUSE_ACCESS_DENIED`) and answered with "re-install to grant it" — a retry
  fixes nothing. `gladys_version` is `>=4.85.0`, the version that opened the
  endpoint, and `test/manifest.test.js` checks both.
- **The call is made by hand**, with `GLADYS_HOST_API_URL` and
  `GLADYS_INTEGRATION_TOKEN`, because the JS SDK does not wrap the endpoint
  (0.11.0). Both are injected for the test, so `test/houses.test.js` never
  touches the network.
- **It is an import, not a sync.** The houses are read at the click; what comes
  out is ordinary locations. A house with `latitude: null` (never placed on the
  map) is REPORTED, never taken as 0 — that is the Gulf of Guinea. The whole
  import is one `setConfig` and one re-publish, and nothing is written when
  nothing is added.

### There is no country anywhere, and that is the design

`src/geocoding.js` turns what the user typed into a point, through the Open-Meteo
geocoding API (GeoNames), worldwide. A country registry used to live in
`src/countries/` because a postal code is only readable by the country that
issues it — it made the integration French while its data covers the planet, and
it is gone. Do not reintroduce a country field, a country select or a per-country
lookup: everything downstream works on a latitude and a longitude.

Most place names are shared, so `resolvePlace()` returns candidates and the
editor asks rather than picking; hints after a comma (`Montauban,
Tarn-et-Garonne`) filter on region/department/country/postal code. The two
coordinate fields are the way out when the geocoder does not know a place, and
they win over the name when both are given.

**`src/airQuality/`** — a provider knows how to read concentrations for a point:
`{ key, name, pollutants, supports(point), fetchConcentrations(point) }`, first
match wins, so callers never name an implementation. Two are registered, and the
order IS the routing: `openMeteoEuropeProvider` (CAMS European, ~11 km, inside a
bounding box) then `openMeteoGlobalProvider` (CAMS global, ~40 km, every point
on Earth). A national source goes BEFORE both; nothing goes after the global one,
which supports everything.

Each provider asks for its `domains` explicitly — never the API's `auto` blend —
and the domain is part of the cache key: the two models are not coupled, and a
location whose series switched between them would be two datasets under one
chart.

### The index scale is the domain

`src/airQuality/scale.js` owns the thresholds and nothing else does. They are the
European Air Quality Index bands (EEA), which are also the French ATMO bands
since the arrêté du 10 juillet 2020. Read the file header before touching a
number in it.

They are applied WORLDWIDE, including to points the global model serves. That is
deliberate — one scale means one number that means the same thing on every
device — and it is stated in the manifest intro and both `docs/`: outside Europe
this is not the local national index (US AQI, Chinese index, Indian CAQI).

### The manifest is a contract checked by tests

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code:
every action has a handler _and_ every handler has a button, `DEFAULT_CONFIG`
matches the manifest defaults, the delete dropdown offers exactly
`MAX_LOCATIONS` positions, `add_location` carries no country and no postal code
field, its coordinates are `string` fields, `section` fields stay valueless,
every label is bilingual. When you change one side, the test tells you about the
other.

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
  SO₂ have **no** concentration category: their concentration is published as
  `unknown`/`decimal`, which the front renders as "value + unit" like any other
  read-only decimal — the fallback costs the category icon and label, not the
  number. `no2-matter-index-sensor` is a trap: despite the name it is an INTEGER
  Matter index (unknown/low/medium/high/critical), and a µg/m³ value published
  under it is rendered as one of those five words.
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
- **A place name is never resolved by coin flip.** Several places share most
  names; the editor lists the candidates and asks. Picking the first would
  silently report another town's air.
- **Both coordinates or neither.** A lone latitude with a longitude defaulting to
  0 silently watches the Gulf of Guinea.
- **A location id is never reused and never derived from what the user can
  edit** — it becomes the device `external_id`, so a reused id would hand a
  deleted location's device history to the next one created.
- **Provider coverage is checked before use** (`supports()`): a point no provider
  answers for is refused when the location is added, and `watchedLocations()`
  filters any stored one. Since the global provider covers the planet, this now
  only catches what is not a point (a coordinate out of range, or none).
- **A refresh cycle never throws.** A rejection inside a timer callback would
  take the container down; one location failing must not silence the others.

## Testing

Tests never touch the network: `globalThis.fetch` is stubbed per-file and
restored in `afterEach`. `src/airQuality/openMeteo.js` keeps a module-level TTL
cache, so tests that count requests must call `clearAirQualityCache()` in
`beforeEach` — otherwise state leaks between tests.

`test/helpers/fakeGladys.js` is the in-memory SDK stand-in; extend it when you
use a new SDK method rather than mocking the SDK itself. The location editor
takes its outside world by injection (`getConfig`, `setConfig`, `resolvePlace`,
`isCovered`, `findCreatedDevice`), so `test/locationEditor.test.js` exercises the
buttons with no Gladys and no network at all.
