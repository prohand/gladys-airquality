# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

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
