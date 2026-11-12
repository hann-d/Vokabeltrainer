# Vokabeltrainer

Ein Vokabeltrainer für Englisch (Deutsch ↔ Englisch) mit Karteikasten, „Arbeit lernen“, Lernplan,
Merkliste, Synonymen, Gegenteilen und Sätzen. Läuft komplett im Browser, auch offline, und lässt
sich am Handy und am PC als App installieren.

Der Lernstand wird nur auf dem eigenen Gerät gespeichert – nichts davon landet im Internet.

## Benutzen

- **Online:** die GitHub-Pages-Adresse öffnen und „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.
- **Lokal:** `Vokabeltrainer starten.html` doppelklicken.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Die App (alle Ansichten) |
| `sw.js` | Offline-Teil – bei jedem Update die `VERSION` erhöhen |
| `manifest.webmanifest` | Name und Symbole der installierten App |
| `programm/compare.js` | Vergleich der Antworten (Tests: `programm/test.html`) |
| `programm/data.js` | Daten, Fächer, Lernpläne, Speichern |
| `programm/quiz.js` | Abfrage |
| `programm/app.js` | Oberfläche |
| `programm/filesave.js` | Zusätzliche Sicherung in einen Ordner (nur am PC) |
| `programm/pwa.js` | Installierte App: Offline, Updates, dauerhafter Speicher |
