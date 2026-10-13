# Luftqualität

Verfolgen Sie den Luftqualitätsindex der Orte Ihrer Wahl in Gladys, mit einem
Gerät pro Ort. Sie fügen Ihre **Gladys-Häuser mit einem Klick** hinzu oder einen
Ort, indem Sie den Namen seiner **Stadt** eingeben, **überall auf der Welt**.

Kein Konto anzulegen, kein API-Schlüssel einzufügen: Beide Quellen, die diese
Integration nutzt, sind offen und öffentlich.

## Ihre Gladys-Häuser mit einem Klick hinzufügen

Sie haben Gladys bereits gesagt, wo Sie wohnen: Das ist die Karte unter
**Einstellungen > Zuhause**. Die Schaltfläche **„Meine Gladys-Häuser
hinzufügen“** liest diese Häuser und legt für jedes noch nicht überwachte einen
Ort an — ohne eine Stadt einzugeben.

Drei Dinge, die Sie wissen sollten:

- **Der Zugriff ist eine Berechtigung.** Wo Sie wohnen, sind personenbezogene
  Daten: Gladys teilt sie nur, wenn Sie die Anfrage auf dem Installationsbildschirm
  der Integration angenommen haben. Antwortet die Schaltfläche, dass der Zugriff
  verweigert wird, entfernen Sie die Integration und installieren Sie sie neu,
  wobei Sie die angezeigte Anfrage annehmen.
- **Ein Haus, das Sie nie auf der Karte platziert haben, hat keine
  Koordinaten.** Es wird in der Antwort genannt; verorten Sie es unter
  Einstellungen > Zuhause und führen Sie die Aktion erneut aus.
- **Das ist keine Synchronisierung.** Die Häuser werden in dem Moment gelesen, in
  dem Sie klicken. Heraus kommt ein gewöhnlicher Ort, der wie die anderen
  umbenannt und entfernt wird, und ein später in Gladys verschobenes Haus
  verschiebt seinen Ort nicht.

Um nur eines Ihrer Häuser hinzuzufügen — ein Ferienhaus, das nicht überwacht
werden soll, bleibt außen vor —, wählen Sie es im Feld **Haus** der
Schaltfläche; bleibt es leer, werden alle Häuser hinzugefügt.

Erneutes Klicken ist unbedenklich: Ein bereits überwachtes Haus wird gemeldet,
nicht ein zweites Mal hinzugefügt. Ein Ort, der aus einem Haus stammt, hat keine
Adressbezeichnung: Die Liste zeigt seinen Namen und seinen Punkt, weil der
Geocoder die Stadt, in der ein Punkt liegt, nicht benennen kann.

## Einen Ort hinzufügen

1. Öffnen Sie den Tab **Konfiguration** der Integration.
2. Klicken Sie im Abschnitt „Ihre Orte“ auf **Ort hinzufügen**.
3. Geben Sie die **Stadt** ein — „Nantes“, „Montreal“, „Kyoto“ — und optional
   einen **Namen** für diesen Ort („Zuhause“, „Büro“…). Ohne Namen übernimmt der
   Ort den Namen des gefundenen Orts.
4. Die Antwort erscheint unter der Schaltfläche. Bei Erfolg bestätigt sie das
   Hinzufügen und nennt Ihnen die Nummer des Orts.
5. Gehen Sie zum Tab **Entdecken**: Das Gerät „Qualité de l'air — _Ihr Ort_“
   („Luftqualität — _Ihr Ort_“, wenn die Sprache der Gerätenamen Deutsch ist)
   wartet dort darauf, hinzugefügt zu werden. Klicken Sie darauf, um es in
   Gladys anzulegen.

### Ein Name, mehrere Orte

Die meisten Städtenamen sind mehrfach vergeben: Allein in Frankreich gibt es
mehrere Montauban, ein Paris in Texas und ein Springfield pro US-Bundesstaat. In
diesem Fall entscheidet die Integration nicht für Sie — sie antwortet mit der
Liste der gefundenen Orte und bittet Sie, genauer zu werden.

Grenzen Sie **nach einem Komma** ein: die Region, das Departement, den
Bundesstaat, das Land oder die Postleitzahl, in beliebiger Reihenfolge.

- „Montauban, Tarn-et-Garonne“
- „Springfield, Illinois“
- „Nantes, 44000“
- „Paris, France“

Akzente und Groß-/Kleinschreibung spielen keine Rolle: „saint-etienne“ findet
„Saint-Étienne“.

### Oder direkt ein Punkt

Kennt der Geocoder Ihren Weiler nicht oder möchten Sie einen genauen Punkt von
einer Karte übernehmen, geben Sie stattdessen **Breitengrad** und **Längengrad**
ein (WGS-84-Dezimalgrad). Beide gehören zusammen: Einer allein ist kein Punkt.
Sie haben dann Vorrang vor der eingegebenen Stadt, die nur als Bezeichnung
erhalten bleibt.

## Ihre Orte auflisten

Die Schaltfläche **Meine Orte anzeigen** listet alles auf, was die Integration
überwacht: Nummer, Name, Ort (Stadt, Region, Land) und Koordinaten. Ein Eintrag
pro Zeile, jeder beginnt mit „•“.

Diese **Nummern sind die, die beim Entfernen verwendet werden**: Führen Sie diese
Aktion aus, bevor Sie einen Ort entfernen, um der Nummer sicher zu sein.

## Einen Ort entfernen

1. Klicken Sie auf **Ort entfernen**.
2. Wählen Sie die **Nummer** des Orts in der Auswahlliste.
3. Führen Sie die Aktion einmal **ohne Häkchen** aus: Die Antwort sagt Ihnen,
   welcher Ort entfernt würde. Prüfen Sie, ob es der richtige ist.
4. Setzen Sie das Häkchen bei **Ich bestätige das Entfernen** und führen Sie sie
   erneut aus.

Der Ort verschwindet sofort aus dem Tab „Entdecken“.

> **Das Gladys-Gerät selbst wird nicht gelöscht.** Eine Integration darf ein von
> Ihnen angelegtes Gerät nicht löschen — sie kann nur aufhören, es anzubieten.
> Hatten Sie das Gerät dieses Orts hinzugefügt, nennt die Antwort es: Löschen
> Sie es selbst im Tab **Geräte** der Integration, sonst bleibt es dort und wird
> nie wieder aktualisiert.

Achten Sie auch auf die Neunummerierung: Wird Ort 2 von vieren entfernt, werden
die Orte 3 und 4 zu den Orten 2 und 3. Führen Sie „Meine Orte anzeigen“ erneut
aus, bevor Sie einen weiteren entfernen.

## Was das Gerät misst

Jedes Gerät stellt bereit:

| Funktion                                    | Was sie enthält                                                   |
| ------------------------------------------- | ----------------------------------------------------------------- |
| **Luftqualitätsindex**                      | 1 bis 6 — der Wert für eine Szene                                 |
| **Luftqualität (Text)**                     | Gut, Ausreichend, Mäßig, Schlecht, Sehr schlecht, Extrem schlecht |
| **Dominierender Schadstoff**                | der Schadstoff, der den Index bestimmt hat                        |
| **Teilindex PM2,5 / PM10 / NO₂ / O₃ / SO₂** | 1 bis 6, Schadstoff für Schadstoff                                |
| **PM2,5 / PM10 / NO₂ / O₃ / SO₂**           | die Konzentration in µg/m³                                        |
| **Letzte Datenaktualisierung**              | die Uhrzeit der Daten, in der Ortszeit des Orts                   |

Die sechs Klassen des Index:

| Index | Luftqualität    |
| ----- | --------------- |
| 1     | Gut             |
| 2     | Ausreichend     |
| 3     | Mäßig           |
| 4     | Schlecht        |
| 5     | Sehr schlecht   |
| 6     | Extrem schlecht |

Der Gesamtindex ist der des **schlechtesten Schadstoffs** — so sind sowohl der
europäische Index als auch der französische ATMO-Index definiert: Ein einziger
verschlechterter Schadstoff genügt, um die Luft zu verschlechtern.

Neben seinem Teilindex erhält jeder Schadstoff auch seine rohe **Konzentration
in µg/m³** — ein Teilindex ist ein Band, und ein Band verbirgt, was darin
geschieht: Ein Ozon-Nachmittag, der von 55 auf 128 µg/m³ steigt, verlässt nie
Klasse 3. Jeder der fünf hat seine eigene Gladys-Sensorkategorie, sodass alle
ihr Symbol, ihr Farbabzeichen und ihre Kurve im Verlauf erhalten.

Die **letzte Datenaktualisierung** ist die Uhrzeit der CAMS-Analyse für diesen
Ort, nicht die Uhrzeit, zu der die Integration zuletzt lief: Das Modell rechnet
stündlich, häufigeres Aktualisieren verschiebt sie also nicht. Sie wird in der
**Ortszeit des Orts** angezeigt (gefolgt von ihrer Zone, `CEST`, `GMT+9`…),
weshalb jedes Gerät seine eigene hat: Zwei Orte können zu Recht zwei
verschiedene Uhrzeiten anzeigen.

Ein Schadstoff, für den die Quelle **keinen Wert** hat, veröffentlicht gar
nichts. Eine fehlende Messung ist keine saubere Luft: Eine 1 zu schreiben würde
den Verlauf verfälschen und könnte eine Szene „die Luft ist wieder gut“
auslösen.

## Woher die Daten stammen

**Die Konzentrationen** stammen aus den **CAMS**-Daten (Copernicus Atmosphere
Monitoring Service, der Atmosphärendienst der Europäischen Union, betrieben vom
EZMW), die
[Open-Meteo](https://open-meteo.com/en/docs/air-quality-api) als Open Data
weiterverbreitet. Zwei Modelle, und die Integration wählt nach der Lage des
Orts:

| Lage des Orts | Gelesenes Modell | Auflösung |
| ------------- | ---------------- | --------- |
| In Europa     | CAMS europäisch  | ~11 km    |
| Anderswo      | CAMS global      | ~40 km    |

Beide veröffentlichen dieselben fünf regulierten Schadstoffe. Ein Ort bleibt
immer beim selben Modell, sodass sein Verlauf eine einzige Reihe ist und nicht
zwei übereinander gestapelte Datensätze unter einem Diagramm.

[Atmo France](https://www.atmo-france.org/) ist die Referenz für den
französischen ATMO-Index, aber seine API erfordert ein Konto und ein
Authentifizierungstoken, das jeder Benutzer anlegen müsste, bevor die
Integration überhaupt funktioniert. Eine offizielle, offene Quelle ohne
Authentifizierung wurde vorgezogen.

**Der Index** wird aus diesen Konzentrationen mit den Schwellenwerten des
**Europäischen Luftqualitätsindex** (Europäische Umweltagentur) berechnet. Diese
sind, Band für Band, die des französischen **ATMO-Index** seit dem _arrêté du 10
juillet 2020_, in Kraft seit dem 1. Januar 2021, der den nationalen Index an den
europäischen angeglichen hat: sechs Klassen, dieselben fünf regulierten
Schadstoffe, dieselben Grenzen.

Ein Unterschied, den man kennen sollte: Der veröffentlichte ATMO-Index ist ein
**Tageswert** (Tagesmittel für Feinstaub, Tagesmaximum für die Gase), während
diese Integration die **aktuelle Stunde** liest, wie es der europäische Index
tut. Der Wert reagiert daher innerhalb der Stunde — was eine
Hausautomations-Szene braucht —, statt das ATMO-Tagesbulletin wiederzugeben.

**Städte** werden über die
[Geocoding-API von Open-Meteo](https://open-meteo.com/en/docs/geocoding-api) in
Koordinaten aufgelöst, gestützt auf die weltweite **GeoNames**-Datenbank. Ebenfalls
offen, ebenfalls ohne Konto und ohne API-Schlüssel.

## Auf Ihrem Dashboard

Zwei Widgets werden unter „Dashboard bearbeiten“ angeboten, bei den Widgets der
Integrationen. Sie folgen der Sprache der Person, die sie ansieht, und ihre
Farben folgen dem Gladys-Design (hell oder dunkel).

### Luftqualität — ein Ort

Die Karte eines Orts, ausgewählt unter den bereits über den Tab „Entdecken“
hinzugefügten Geräten:

- eine **Anzeige** von 1 bis 6 mit dem aktuellen Index;
- der **dominierende Schadstoff**, der den Index bestimmt (nichts, wenn die Luft
  gut ist);
- eine Zeile pro Schadstoff, der schlechteste zuerst, mit seiner Klasse **und**
  seiner Konzentration: „4/6 (Schlecht) · 150 µg/m³“;
- die **Kurve der kommenden Stunden**, heute und morgen — das Einzige, was kein
  Sensor zeigen kann, da es noch nicht geschehen ist;
- die Uhrzeit der CAMS-Analyse und eine Schaltfläche **Aktualisieren**.

Zwei Einstellungen pro Karte:

- **Verfolgte Schadstoffe** — wählen Sie die aus, die Sie interessieren (Ozon im
  Sommer, Feinstaub im Winter): Die Anzeige, die Zeilen und die Kurve
  berücksichtigen dann nur diese. Nichts ausgewählt = alle, also der Index, den
  Gladys veröffentlicht.
- **Kommende Stunden anzeigen** — deaktivieren Sie es für eine kompakte Karte.

### Luftqualität — alle Orte

Eine Zeile pro konfiguriertem Ort, mit seinem Index und seinem dominierenden
Schadstoff, und eine Schaltfläche **Aktualisieren**, die alle Orte neu liest.
Keine Einstellung: Die Karte zeigt die in der Konfiguration verwaltete Liste.
Bei mehr als zehn Orten sagt die Bildunterschrift, wie viele ausgelassen sind.

Die Farben: Grün für „Gut“ und „Ausreichend“, Gelb für „Mäßig“, Rot von
„Schlecht“ bis „Extrem schlecht“. Die Widget-Palette hat weder Orange noch
Violett; ein wiederholtes Rot ist besser, als ein „Schlecht“ gelb zu malen.

## Den Index in einer Szene verwenden

### 1. Die Messwerte, wie jeder Sensor

Der Index, die Teilindizes und die Konzentrationen sind Funktionen des Geräts:
Der Gladys-Auslöser „Änderung von Gerätestatus“ überwacht sie wie jeden Sensor
(„wenn der Index über 3 steigt“).

### 2. Die Auslöser

Im Szenen-Editor, unter **Luftqualität**:

- **Luftqualitätsindex hat sich geändert** — einmal, wenn der Gesamtindex eines
  Orts von einer Klasse in eine andere **wechselt**. Nie bei jeder
  Aktualisierung.
- **Teilindex eines Schadstoffs hat sich geändert** — dasselbe, Schadstoff für
  Schadstoff.

Jeder Auslöser lässt sich filtern (alles ist optional, ein leerer Filter
bedeutet „beliebig“): der **Ort**, die **neue(n) Klasse(n)**, die **Richtung**
(„Verschlechterung“, um die Fenster zu schließen, „Verbesserung“, um sie wieder
zu öffnen) und beim zweiten der/die **Schadstoff(e)**.

Die Szene erhält fertige Variablen, darunter `{{triggerEvent.data.summary}}`:
„Luftqualität in Zuhause: Index 4/6 (Schlecht), dominierend Ozon (O₃).“ — direkt
für eine Benachrichtigung. Die anderen: Name des Orts, neue und vorherige Klasse
(als Zahl und ausgeschrieben), Richtung, Schadstoff, Konzentration (zweiter
Auslöser), Uhrzeit der Analyse.

Zwei Dinge, die man wissen sollte:

- **Bei der ersten Messung** nach einem Start wird nichts ausgelöst: Die
  vorherige Klasse ist unbekannt, und „unbekannt → 4“ ist keine Änderung.
- **Fehlende Daten sind keine Rückkehr zu guter Luft**: Sie lösen nichts aus,
  und die nächste Klasse wird mit der zuletzt tatsächlich gelesenen verglichen.

### 3. Die Aktionen

- **Luftqualität lesen** — liest einen Ort sofort und übergibt den nächsten
  Aktionen die Klasse, ihre Bezeichnung, den Schadstoff, seine Konzentration,
  die Uhrzeit der Analyse und denselben fertigen Satz. Wählen Sie „Gesamtindex“
  (der derzeit schlechteste Schadstoff) oder einen Schadstoff. Keine Daten? Die
  Klasse ist leer und der Satz sagt es: Prüfen Sie das in einer Bedingung,
  statt auf einen Fehler zu warten.
- **Luftqualitätsdaten aktualisieren** — liest einen Ort neu und veröffentlicht
  ihn neu, oder alle, wenn der Ort leer bleibt, ohne auf die nächste
  Aktualisierung zu warten. Gibt zurück, wie viele Orte aktualisiert wurden und
  wie viele fehlgeschlagen sind.

Beispiel: „jeden Tag um 7 Uhr → Luftqualität lesen (Zuhause) → mir `{{summary}}`
schicken“.

## Einstellungen

- **Sprache der Gerätenamen** — standardmäßig Französisch (auch Englisch,
  Deutsch und Spanisch). Alles, was die Integration anzeigt, folgt bereits der
  Sprache Ihres Gladys-Kontos, aber der Name eines Geräts und seiner Funktionen
  wird so gespeichert, wie er veröffentlicht wird, und muss daher hier gewählt
  werden. Ein bereits hinzugefügtes Gerät behält die Namen, mit denen es erstellt
  wurde; löschen Sie es und fügen Sie es über den Tab „Entdecken“ erneut hinzu,
  um es umzubenennen. Diese Einstellung ist auch die Sprache, in der der
  Geocoder antwortet: „Munich“ oder „München“ für dieselbe Stadt.
- **Aktualisierungsintervall** — standardmäßig 1 Stunde (zwischen 15 Minuten und
  24 Stunden). Die CAMS-Analyse wird einmal pro Stunde erstellt: Darunter ist
  nichts zu gewinnen.

## Prüfen, ob es funktioniert

Die Schaltfläche **Luftqualitätsquelle testen** fragt die Quelle live für
**jeden** Ort ab und zeigt den Index jedes Orts an, im selben Format wie die
Liste. Das ist der schnellste Weg zu sehen, ob ein Ort ein Problem hat, und
warum.

Der Tab **Überwachung** zeigt den Anwendungsstatus der Integration: Er wird rot,
mit dem Grund, wenn ein Ort nicht mehr gelesen werden kann.

Ein Ort, für den die Quelle nicht antwortet, wird **für sich allein erneut
versucht**, 30 Sekunden und dann 2 Minuten später (länger, wenn die Quelle um
eine Verlangsamung bittet), statt bis zur nächsten Aktualisierung leer zu
bleiben. Alle Ihre Orte werden gemeinsam gelesen, mit einer Anfrage pro
CAMS-Modell.

## Grenzen

- **Der Index ist der europäische, überall angewendet.** Außerhalb Europas ist er
  daher nicht der nationale Index des Landes: Ein Ort in den Vereinigten
  Staaten, in China oder in Indien wird mit den europäischen Bändern bewertet,
  nicht mit dem US-AQI, dem chinesischen Index oder dem indischen CAQI. Die
  Konzentrationen selbst bleiben die Konzentrationen.
- Außerhalb Europas ist das Modell **viermal gröber** (~40 km statt ~11 km): Es
  beschreibt eine regionale Hintergrundbelastung gut, eine Straße weniger.
- Maximal zwanzig Orte.
- Gladys **5.2.0** oder neuer: 5.1.0 hat Widgets und Szenen für Integrationen
  geöffnet, 5.2.0 die Hausauswahl von „Meine Gladys-Häuser hinzufügen“.
- Ein Ort kann nicht bearbeitet werden: Um eine andere Gemeinde zu überwachen,
  entfernen Sie ihn und fügen Sie einen neuen hinzu.
