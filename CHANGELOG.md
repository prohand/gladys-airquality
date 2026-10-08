# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- A location Open-Meteo failed to answer for is retried on its own after 30 s, then after 2 min, instead of staying empty until the next refresh; a `Retry-After` sent with a 429 is honoured.

### Changed

- The Gladys houses are read through the SDK's `gladys.getHouses()` (0.14.0) instead of a hand-made call to the host API; a 403 is still answered with "re-install to grant the access".
- A refused first connection no longer exits the container: the SDK keeps reconnecting (the token refusal can be transient while Gladys boots), and the integration logs it instead.
- The configuration is taken from `gladys.config` on connection, which the SDK has just read, instead of a second `GET /config`.
- All the locations of a refresh are read in one Open-Meteo request per CAMS domain instead of one request per location.
- Reads of the same point made at the same time share one request: the cache holds the request in flight, drops a failed one at once and an expired one when it is next read.
- Creating a device from the Discovery tab refreshes that device's location only, not every location.
- The scene triggers forget the last classes of a removed location.
- `package.json` describes the integration as it is (worldwide, by town name) and requires Node 24, the runtime of the image and of the CI.
- The image installs exactly what `package-lock.json` locks (`npm ci --omit=dev --ignore-scripts`, no `npm install` fallback) and no longer declares a `/data` volume nothing writes to.
- Dependabot also proposes the updates of the Docker base image, monthly.

### Fixed

- Two location actions clicked in the same second no longer lose a location: the add, import, list and remove actions run one at a time, and re-read the list right before they write it.
- A location stored without an id no longer gets a new random id — hence a new device — at every start: the generated id is written back once, before the devices are published.
- A location saved whose devices Gladys then refused to publish is answered as "saved, but the publication failed: <reason>" in both languages, instead of a bare error.

## [2.2.0] - 2026-10-07

- Maintenance release, no functional change.

## [2.1.1] - 2026-10-07

- Maintenance release, no functional change.

## [2.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).
- Manifest re-formatted with Prettier, so the CI format check passes again.

### Fixed

- The Release workflow re-runs Prettier on the manifest after `jq`, so a release no longer leaves `main` with a failing CI format check.

## [2.0.0] - 2026-09-22

### Added

- Add the Gladys 5.1 dashboard widgets, scene triggers and scene actions

## [1.0.5] - 2026-08-15

### Changed

- Declare the store catalog category and move to SDK 0.12.0

## [1.0.4] - 2026-08-14

### Changed

- Publish the NO2, O3 and SO2 concentrations in µg/m³
- Publish the gas concentrations under the new no2/o3/so2 categories

## [1.0.3] - 2026-08-08

### Added

- Publish the hour the air quality data was produced

## [1.0.2] - 2026-08-07

### Added

- Add the Gladys houses as locations in one click

## [1.0.1] - 2026-08-07

First public release.

### Added

- Air quality integration, by postal code
- Watch the air quality anywhere in the world, not just France

### Changed

- Explain why only CI shows up in the Actions tab
- Bring the cover under the 150 KB the indexer accepts

### Fixed

- Shorten the catalog description to the 100 characters the store allows

[Unreleased]: https://github.com/prohand/gladys-airquality/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/prohand/gladys-airquality/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/prohand/gladys-airquality/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/prohand/gladys-airquality/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/prohand/gladys-airquality/compare/v1.0.5...v2.0.0
[1.0.5]: https://github.com/prohand/gladys-airquality/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-airquality/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-airquality/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-airquality/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-airquality/releases/tag/v1.0.1
