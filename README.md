# Trainingsplaner

Mobile-first PWA, die Trainingspläne für mehrere Sportarten erstellt und auf deine Wettkämpfe und Leistungsziele abstimmt. Läuft komplett im Browser, funktioniert offline und lässt sich am Smartphone installieren.

## Was die App kann

- **Mehrere Sportarten in einem Plan**: Laufen, Radfahren, Schwimmen, Krafttraining, Core, Yoga & Mobility, Trailrunning, Wandern, Skitour, Langlauf, Klettern und eigene Sportarten.
- **Ziele geben die Richtung vor**: Wettkämpfe mit Priorität A/B/C und Leistungsziele mit Zieldatum. Der Plan wird in Grundlage, Aufbau, Spitze, Tapering, Wettkampfwoche und Erholung gegliedert.
- **Abstimmung über alle Sportarten**: ein gemeinsames Budget an harten Einheiten pro Woche, keine harten Tage hintereinander, kein schweres Krafttraining vor Schlüsseleinheiten, Entlastungswochen, mindestens ein Ruhetag.
- **Manuell bearbeiten**: Einheiten hinzufügen, ändern, verschieben, löschen. Die App warnt bei Konflikten. Selbst bearbeitete Einheiten bleiben beim Neu-Abstimmen erhalten.
- **Abhaken mit Feedback**: Gefühl und Anstrengung erfassen, Einheiten auslassen oder nachholen. Der Plan reduziert oder erhöht den Umfang der kommenden Wochen entsprechend.
- **Deutsch und Englisch**, Daten nur lokal am Gerät (IndexedDB), Backup als JSON-Datei.

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
| `app/js/art.js` | Karikaturen und Icons als SVG |
| `app/js/i18n.js` | Texte Deutsch/Englisch |
| `app/js/store.js` | Speicherung in IndexedDB, Validierung von Backups |
| `app/sw.js` | Service Worker für Offline-Betrieb |
| `tests/` | Tests der Plan-Logik |

Wenn Dateien in `app/` hinzukommen, gehören sie auch in die Liste `SHELL` in `app/sw.js`.

## Hinweis

Die Pläne folgen gängigen Trainingsprinzipien, ersetzen aber keine sportmedizinische Beratung.

Schriften: Bagel Fat One und Bricolage Grotesque (SIL Open Font License 1.1).
