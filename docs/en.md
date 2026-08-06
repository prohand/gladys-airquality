# Air quality

Follow the air quality index of the places you choose in Gladys, with one device
per location. You add a location by typing its **postal code**.

No account to create, no API key to paste: both sources this integration uses
are open and public.

## Adding a location

1. Open the integration's **Configuration** screen.
2. In the "Your locations" section, click **Add a location**.
3. Pick the **country** (only France is available for now), type the **postal
   code**, and optionally a **name** for this location ("Home", "Office"…).
   Without a name, the location takes the name of the commune.
4. The answer appears under the button. On success it confirms the addition and
   gives you the location's number.
5. Go to the **Discovery** tab: the device "Qualité de l'air — _your location_"
   is waiting there to be added. Click it to create it in Gladys.

### One postal code, several communes

A French postal code is a La Poste routing key, not an administrative area:
01400 for instance covers about a dozen communes. When that happens the
integration does not choose for you — it answers with the list of communes and
asks you to fill the **Commune** field with the one you want, then run the
action again. Accents and case do not matter: "saint-etienne" finds
"Saint-Étienne".

The other way round, a large city often has several postal codes (Nantes has
44000, 44100, 44200 and 44300). They cover different districts: pick the one for
yours.

## Listing your locations

The **Show my locations** button lists everything the integration watches:
number, name, commune, postal code, area and coordinates. One entry per line,
each opening with "•".

Those **numbers are the ones the deletion uses**: run this action before
deleting a location to be sure of the number.

## Removing a location

1. Click **Remove a location**.
2. Pick the location's **number** in the dropdown.
3. Run the action once **without ticking** the box: the answer tells you which
   location would be removed. Check it is the right one.
4. Tick **I confirm the deletion** and run it again.

The location leaves the Discovery tab immediately.

> **The Gladys device itself is not deleted.** An integration is not allowed to
> delete a device you created — it can only stop offering it. If you had added
> this location's device, the answer names it: delete it yourself from the
> integration's **Devices** tab, otherwise it stays there and never updates
> again.

Mind the renumbering too: deleting location 2 out of four turns locations 3 and
4 into locations 2 and 3. Run "Show my locations" again before deleting another
one.

## What the device measures

Each device exposes:

| Feature                                     | What it holds                                         |
| ------------------------------------------- | ----------------------------------------------------- |
| **Air quality index**                       | 1 to 6 — the one to use in a scene                    |
| **Air quality (text)**                      | Good, Fair, Moderate, Poor, Very poor, Extremely poor |
| **Dominant pollutant**                      | the pollutant that set the index                      |
| **PM2.5 / PM10 / NO₂ / O₃ / SO₂ sub-index** | 1 to 6, pollutant by pollutant                        |
| **PM2.5** and **PM10**                      | the concentration, in µg/m³                           |

The six classes of the index:

| Index | Air quality    |
| ----- | -------------- |
| 1     | Good           |
| 2     | Fair           |
| 3     | Moderate       |
| 4     | Poor           |
| 5     | Very poor      |
| 6     | Extremely poor |

The overall index is that of the **worst pollutant** — this is how both the
European index and the French ATMO index are defined: one degraded pollutant is
enough to degrade the air.

Only PM2.5 and PM10 also get a concentration feature: they are the only
pollutants Gladys has a dedicated category for. NO₂, O₃ and SO₂ are carried by
their sub-index.

A pollutant the source has **no value** for publishes nothing at all. A missing
measurement is not clean air: writing 1 would corrupt the history and could fire
an "air is good again" scene.

## Where the data comes from

**The concentrations** come from the **CAMS** European air quality data
(Copernicus Atmosphere Monitoring Service, the European Union's reference model,
run by ECMWF on a ~11 km grid), republished as open data by
[Open-Meteo](https://open-meteo.com/en/docs/air-quality-api).

[Atmo France](https://www.atmo-france.org/) is the reference for the French ATMO
index, but its API requires an account and an authentication token that every
user would have to create before the integration works at all. An official,
open, authentication-free source was preferred.

**The index** is computed from those concentrations with the thresholds of the
**European Air Quality Index** (European Environment Agency). Those are, band
for band, the ones of the French **ATMO index** since the _arrêté du 10 juillet
2020_, in force since 1 January 2021, which aligned the national index on the
European one: six classes, the same five regulated pollutants, the same bounds.

One difference worth knowing: the published ATMO index is **daily** (day average
for particulates, daily maximum for the gases), while this integration reads the
**current hour**, as the European index does. The value therefore reacts within
the hour — what a home automation scene wants — rather than reproducing the
day's ATMO bulletin.

**Postal codes** are resolved into communes through the
[API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif/communes)
of `geo.api.gouv.fr`, the official French API published by the DINUM on
data.gouv.fr, built on the INSEE COG and the IGN ADMIN-EXPRESS database.

## Settings

- **Language of the device names** — French by default. Everything the
  integration displays already follows your Gladys account language, but the
  name of a device and of its features is stored as it is published, so it has
  to be chosen here. A device already added keeps the names it was created with;
  delete it and add it again from the Discovery tab to rename it.
- **Refresh interval** — 1 hour by default (between 15 minutes and 24 hours).
  The CAMS analysis is produced once an hour: going below that gains nothing.

## Checking that it works

The **Test the air quality source** button queries the source live for **every**
location and shows each one's index, in the same format as the listing. It is
the fastest way to see whether a location has a problem, and why.

The **Supervision** screen shows the integration's application-level status: it
turns red, with the reason, when a location can no longer be read.

## Limits

- Coverage stops at the edge of the CAMS European domain. A location outside it
  is refused when you add it, rather than creating a device that would never
  hold a value.
- Twenty locations maximum.
- A location cannot be edited: to watch another commune, remove it and add a new
  one.
