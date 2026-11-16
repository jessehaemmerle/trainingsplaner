# Trainingsplaner

Mobile-first PWA, die Trainingspläne für mehrere Sportarten erstellt und auf deine Wettkämpfe und Leistungsziele abstimmt. Läuft komplett im Browser, funktioniert offline und lässt sich am Smartphone installieren.

## Was die App kann

- **Mehrere Sportarten in einem Plan**: Laufen, Radfahren, Schwimmen, Krafttraining, Core, Yoga & Mobility, Trailrunning, Wandern, Skitour, Langlauf, Klettern und eigene Sportarten.
- **Ziele geben die Richtung vor**: Wettkämpfe mit Priorität A/B/C und Leistungsziele mit Zieldatum. Der Plan wird in Grundlage, Aufbau, Spitze, Tapering, Wettkampfwoche und Erholung gegliedert.
- **Abstimmung über alle Sportarten**: ein gemeinsames Budget an harten Einheiten pro Woche, keine harten Tage hintereinander, kein schweres Krafttraining vor Schlüsseleinheiten, Entlastungswochen, mindestens ein Ruhetag.
- **Manuell bearbeiten**: Einheiten hinzufügen, ändern, verschieben, löschen. Die App warnt bei Konflikten. Selbst bearbeitete Einheiten bleiben beim Neu-Abstimmen erhalten.
- **Abhaken mit Feedback**: Gefühl und Anstrengung erfassen, Einheiten auslassen oder nachholen. Der Plan reduziert oder erhöht den Umfang der kommenden Wochen entsprechend.
- **Uhren & Geräte**: Trainings von Garmin, Apple Watch, Fitbit und anderen übernehmen, Plan als Kalender oder Garmin-Workout exportieren.
- **Deutsch und Englisch**, Daten nur lokal am Gerät (IndexedDB), Backup als JSON-Datei.

## Uhren & Geräte

Zu finden unter **Einstellungen → Uhr verbinden**.

| Was | Womit | Wie |
| --- | --- | --- |
| Erledigte Trainings übernehmen | Garmin, Apple Watch, Fitbit, Polar, Suunto, Coros, Wahoo, Strava … | FIT-, TCX- oder GPX-Dateien auswählen, oder die `Export.zip` aus Apple Health |
| Automatisch synchronisieren | Garmin | Garmin Personal API über einen eigenen Relay (siehe unten) |
| Plan auf die Uhr | alle Uhren mit Kalender | Kalender-Datei (`.ics`) in den Handy-Kalender importieren |
| Strukturierte Workouts | Garmin | ZIP mit FIT-Workouts entpacken und per USB nach `GARMIN/NewFiles` kopieren |

Importierte Aktivitäten haken die passende geplante Einheit desselben Tages ab (gleiche oder verwandte Sportart) und übernehmen Dauer, Distanz, Puls, Höhenmeter und Kalorien. Ohne passende Einheit wird das Training zusätzlich eingetragen. Doppelte Importe werden erkannt.

### Garmin-Synchronisierung

Garmin bietet seit 2026 eine [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api): Jede:r kann für das eigene Konto einen Schlüssel erstellen und damit die eigenen Aktivitäten lesen. Die API beantwortet aber keine Anfragen direkt aus einer Webseite (kein CORS), und GitHub Pages hat keinen Server. Deshalb braucht es einen kleinen Relay, der die Anfrage weiterreicht. Er speichert nichts.

1. **Schlüssel erstellen:** In Garmin Connect unter [Einstellungen → Personal API](https://connect.garmin.com/app/settings/personalApiToken) einen Schlüssel anlegen. Er wird nur einmal angezeigt und läuft je nach Wahl nach 30 Tagen bis einem Jahr ab.
2. **Relay einrichten:** Bei [Cloudflare Workers](https://workers.cloudflare.com/) (kostenloser Tarif reicht) einen Worker anlegen und den Inhalt von [`integrations/garmin-relay-worker.js`](integrations/garmin-relay-worker.js) einfügen. In `ALLOWED_ORIGINS` muss die Adresse deiner App stehen, z. B. `https://<user>.github.io`.
3. **In der App eintragen:** Unter „Uhr verbinden“ den Schlüssel und die Worker-Adresse eintragen und speichern. Danach synchronisiert die App bei jedem Öffnen.

Der Relay leitet nur zwei lesende Aufrufe weiter (Token holen, Aktivitätsliste) und nur für die in `ALLOWED_ORIGINS` eingetragenen Adressen. Der Schlüssel liegt nur auf deinem Gerät und ist nicht Teil des Backups.

Workouts direkt in den Garmin-Connect-Kalender zu schreiben ist nicht möglich: Das erlaubt Garmin nur zugelassenen Geschäftspartnern über die Training API.

## Veröffentlichen auf GitHub Pages

1. Diesen Branch nach `main` mergen.
2. Im Repository unter **Settings → Pages → Build and deployment → Source** einmalig **GitHub Actions** wählen.
3. Der Workflow `.github/workflows/deploy.yml` testet und veröffentlicht bei jedem Push auf `main`. Die App liegt danach unter `https://<user>.github.io/trainingsplaner/`.

Am Smartphone: Seite öffnen und über das Browser-Menü „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ wählen. Unter Android/Chrome gibt es zusätzlich einen Knopf in den Einstellungen der App.

## Entwicklung

Kein Build-Schritt, keine Abhängigkeiten. Die App besteht aus statischen Dateien in `app/`.

```sh
npm start   # lokaler Server auf http://localhost:8080
npm test    # Tests der Plan-Logik (node:test)
```

| Pfad | Inhalt |
| --- | --- |
| `app/js/engine.js` | Plan-Logik: Periodisierung, Verteilung, Konfliktprüfung, Anpassung, Statistik |
| `app/js/app.js` | Ansichten, Formulare, Dialoge |
| `app/js/devices.js` | Import von Uhren: FIT, TCX, GPX, Apple Health, Garmin Personal API, Abgleich mit dem Plan |
| `app/js/exporters.js` | Export: Kalender (`.ics`), Garmin-Workouts (FIT), ZIP |
| `integrations/garmin-relay-worker.js` | Relay für die Garmin-Synchronisierung (Cloudflare Worker) |
| `app/js/art.js` | Karikaturen und Icons als SVG |
| `app/js/i18n.js` | Texte Deutsch/Englisch |
| `app/js/store.js` | Speicherung in IndexedDB, Validierung von Backups |
| `app/sw.js` | Service Worker für Offline-Betrieb |
| `tests/` | Tests der Plan-Logik |

Wenn Dateien in `app/` hinzukommen, gehören sie auch in die Liste `SHELL` in `app/sw.js`.

## Hinweis

Die Pläne folgen gängigen Trainingsprinzipien, ersetzen aber keine sportmedizinische Beratung.

Schriften: Bagel Fat One und Bricolage Grotesque (SIL Open Font License 1.1).
