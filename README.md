# Qualité de l'air — Gladys Assistant integration

External integration for [Gladys Assistant](https://gladysassistant.com) that
publishes the **air quality index** of the places you choose, one Gladys device
per location, **anywhere in the world**: you type a town, you get a device.

Built from the official
[`integration-template-js`](https://github.com/GladysAssistant/integration-template-js)
starter, on the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## What you get

Add a location from the Configuration screen (a town name, or a pair of
coordinates), and a device shows up in the **Discovery** tab, ready to be added
to Gladys. Each device exposes:

| Feature                                   | Category                     | Value                                         |
| ----------------------------------------- | ---------------------------- | --------------------------------------------- |
| Indice de qualité de l'air                | `airquality-sensor`          | 1 to 6 — the class, the one to use in a scene |
| Qualité de l'air (texte)                  | `text`                       | Bon, Moyen, Dégradé, Mauvais, Très mauvais, … |
| Polluant dominant                         | `text`                       | the pollutant that set the class              |
| Sous-indice PM2,5 / PM10 / NO₂ / O₃ / SO₂ | `airquality-sensor`          | 1 to 6, per pollutant                         |
| PM2,5, PM10                               | `pm25-sensor`, `pm10-sensor` | concentration in µg/m³                        |

Only PM2.5 and PM10 get a raw concentration feature: they are the only
pollutants Gladys has a dedicated feature category for. NO₂, O₃ and SO₂ would
have to be published as `unknown`, which says less than the sub-index that
already carries them.

## Where the data comes from

Two open APIs, **no account and no API key** on either side.

| Need               | Source                                                                                                                | Auth |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ---- |
| Concentrations     | [Copernicus CAMS](https://atmosphere.copernicus.eu/) via [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api) | none |
| Town → coordinates | [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) (GeoNames)                                   | none |

### The air quality: Copernicus CAMS, via Open-Meteo

[Atmo France](https://www.atmo-france.org/) is the reference for the French ATMO
index, but its Atmo Data API requires an account and a token every user would
have to create and paste before the integration works at all. So this
integration reads the **CAMS data** instead — Copernicus Atmosphere Monitoring
Service, the European Union's atmosphere service, run by ECMWF — republished as
open data by [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api). The
numbers are official European ones and the setup is empty.

CAMS is two models, and there is one provider per model
([`src/airQuality/`](./src/airQuality/index.js)), registered Europe first:

| Where the point is | Provider                 | Model         | Resolution |
| ------------------ | ------------------------ | ------------- | ---------- |
| In Europe          | `open-meteo-cams-europe` | CAMS European | ~11 km     |
| Anywhere else      | `open-meteo-cams-global` | CAMS global   | ~40 km     |

Both report the same five regulated pollutants, and each domain is asked for
**explicitly** rather than through the API's `auto` blend: the two models are
not coupled, so a location that silently switched between them would be two
datasets under one chart.

### The index: the European AQI, which is also the French ATMO scale

Applied worldwide, deliberately. Outside Europe it is therefore **not** the local
national index — not the US AQI, not the Chinese one, not the Indian CAQI. One
scale everywhere means one number that means the same thing in every device.

The concentrations are graded by [`src/airQuality/scale.js`](./src/airQuality/scale.js)
with the thresholds of the **European Air Quality Index** published by the
European Environment Agency. Those are, band for band, the ones the French
**ATMO index** has used since the _arrêté du 10 juillet 2020_ (in force since
1 January 2021), which aligned the national index on the European one: six
classes, the same five regulated pollutants, the same bounds. The worst
pollutant sets the class, exactly as both indices define it.

One difference worth knowing: ATMO is a **daily** index (PM averaged over the
day, daily maximum for the gases), while this integration reads the **current
hour**, which is how the European index is computed. It therefore reacts within
the hour — what a home automation scene wants — rather than reproducing the
day's ATMO bulletin.

### The town names: Open-Meteo geocoding (GeoNames)

Town names are resolved by the
[Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), backed
by the GeoNames database — the same key-free house as the forecast, covering the
whole world.

There is **no country anywhere in the code**. There used to be a country
registry, because a postal code is only readable by the country that issues it,
and it made the integration French while its data covers the planet; a worldwide
geocoder ([`src/geocoding.js`](./src/geocoding.js)) removed the step entirely —
no country field in the form, no registry to extend, no manifest option list to
keep in sync.

Most place names are shared (several Montauban in France alone, a Paris in
Texas), so the search returns a list: the integration **shows the candidates and
asks which one you meant** — it never picks the first, because the wrong pick
silently reports another town's air. The user narrows it down after a comma:
`Montauban, Tarn-et-Garonne`, `Springfield, Illinois`, `Nantes, 44000`. A hamlet
the geocoder does not know can still be added by its latitude and longitude.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no domain logic)
├─ src/
│  ├─ airQuality/
│  │  ├─ index.js                    #   provider registry + read/grade
│  │  ├─ openMeteo.js                #   CAMS Europe + CAMS global (no key)
│  │  └─ scale.js                    #   µg/m³ -> 1-6 index (EEA / ATMO bands)
│  ├─ geocoding.js                   # town -> coordinates, worldwide (GeoNames)
│  ├─ devices/
│  │  ├─ index.js                    #   blueprint registry
│  │  └─ airQualityStation.js        #   the device: features, states, refresh
│  ├─ config.js                      # config defaults + normalization
│  ├─ coordinates.js                 # WGS-84 parsing/formatting
│  ├─ language.js                    # language of the device NAMES
│  ├─ locationEditor.js              # the three buttons: add / list / remove
│  ├─ locations.js                   # the location list (source of truth)
│  └─ richText.js                    # Unicode bold for the list labels
├─ docs/{en,fr}.md                   # user documentation, linked from Gladys
├─ gladys-assistant-integration.json # manifest (name, config schema, actions…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
└─ .github/workflows/                # CI + UI-driven release
```

## Development

```bash
npm install
npm test              # node --test, network-free (fetch is stubbed everywhere)
npm run lint
npm run format:check  # CI gate
```

CI runs `format:check`, then `lint`, then `test`, on Node 24 — the version the
Docker image ships with.

`cover.png` is still the template's placeholder: replace it (800×534 px, ≤150 KB)
before publishing to the Gladys catalog.

## Workflows

Three, all from the template:

| Workflow      | Runs on                                          | Does                             |
| ------------- | ------------------------------------------------ | -------------------------------- |
| `ci.yml`      | push to `main`, pull requests                    | `format:check` → `lint` → `test` |
| `build.yml`   | a `v*` tag, a manual run, or called by `release` | multi-arch image → ghcr.io       |
| `release.yml` | manual run only (patch/minor/major)              | bump + tag + call `build.yml`    |

If the Actions tab shows fewer than three, they are not missing from the repo:
GitHub indexes a workflow when a push to the **default branch touches its
file**, so the two that never fire on an ordinary push stay invisible until such
a push happens. On a brand new repository the first commit registers only the
workflows it actually triggered. Any later push touching them fixes it.

## Releasing

GitHub → Actions → **Release** → _Run workflow_ → pick patch/minor/major. The
workflow bumps `package.json` and the manifest (`version` **and** the
`docker_image` tag), commits, tags, and builds the multi-arch image. Do not
hand-edit those two fields.

## License

Apache-2.0.
