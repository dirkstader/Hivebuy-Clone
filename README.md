# OUNDA Procure

Interne Beschaffungsmanagement-App für die OUNDA GmbH — ein eigenständiger Klon der Kernfunktionen von [Hivebuy](https://www.hivebuy.de/), mit eigenem Design und eigener Architektur nachgebaut.

## Funktionsumfang

- **Bestellanforderungen & Freigabe-Workflow** — Anlage, Einreichung, Genehmigung/Ablehnung mit Kommentar, Bestellauslösung, Wareneingangsbestätigung
- **Lieferanten- & Katalogverwaltung** — Anlage und Verwaltung von Lieferanten und Produktkatalogen
- **Rechnungs- & Bestellabgleich** — automatischer 3-Way-Match zwischen Bestellung, Wareneingang und Rechnung inkl. Abweichungserkennung
- **Amazon Business Punch-Out** — simulierter Einkaufsfluss analog zur echten Amazon-Business-Integration
- **Rollenbasierter Zugriff** — vier Rollen: Antragsteller, Genehmiger, Einkauf/Admin, Finance/Controlling
- **Demo-Login** — E-Mail/Passwort-Anmeldung (Microsoft-SSO als späterer Ausbauschritt vorgesehen)

## Tech-Stack

| Bereich   | Technologie                                      |
| --------- | ------------------------------------------------- |
| Frontend  | React, Vite, Tailwind CSS, shadcn/ui, wouter (Hash-Routing), TanStack Query |
| Backend   | Express (Node.js/TypeScript)                      |
| Datenbank | SQLite über Drizzle ORM (`better-sqlite3`)         |
| Build     | tsx, esbuild                                       |

## Voraussetzungen

- Node.js 18 oder neuer
- npm

## Setup

1. Repository klonen:

   ```bash
   git clone https://github.com/dirkstader/Hivebuy-Clone.git
   cd Hivebuy-Clone
   ```

2. Abhängigkeiten installieren:

   ```bash
   npm install
   ```

3. Entwicklungsserver starten:

   ```bash
   npm run dev
   ```

   Die App läuft anschließend unter [http://localhost:5000](http://localhost:5000). Express (Backend) und Vite (Frontend) laufen auf demselben Port.

Die SQLite-Datenbank (`data.db`) wird beim ersten Start automatisch mit Demodaten angelegt — es ist keine zusätzliche Konfiguration oder `.env`-Datei nötig.

## Demo-Zugänge

Alle Demo-Konten verwenden das Passwort `demo1234`:

| Name           | Rolle              | E-Mail                        |
| -------------- | ------------------- | ------------------------------ |
| Dirk Stader    | Finance/Controlling  | dirk@stader.de                 |
| Sabine Krüger  | Genehmiger           | sabine.krueger@ounda.de        |
| Markus Vogt    | Genehmiger           | markus.vogt@ounda.de           |
| Jana Weiss     | Einkauf/Admin        | jana.weiss@ounda.de            |
| Lea Brandt     | Antragsteller        | lea.brandt@ounda.de            |
| Tobias Reimann | Antragsteller        | tobias.reimann@ounda.de        |

## Verfügbare Skripte

| Befehl            | Beschreibung                                          |
| ------------------ | ------------------------------------------------------ |
| `npm run dev`       | Startet Backend (Express) und Frontend (Vite) zusammen |
| `npm run build`     | Erstellt den Produktions-Build (Client + Server)        |
| `npm start`         | Startet den gebauten Produktionsserver (`dist/index.cjs`) |
| `npm run check`     | TypeScript-Typprüfung                                   |
| `npm run db:generate` | Erzeugt eine neue Migration aus Änderungen an `shared/schema.ts` |

Migrationen liegen versioniert in `migrations/` und werden beim Start automatisch angewendet (kein manueller Schritt nötig).

## Produktion bauen & starten

```bash
npm run build
NODE_ENV=production npm start
```

Der Server läuft dann standardmäßig auf Port 5000.

## Projektstruktur

```
client/          React-Frontend (Vite, Tailwind, shadcn/ui)
  src/pages/      Seiten (Dashboard, Anforderungen, Bestellungen, Lieferanten, Rechnungen, ...)
server/          Express-Backend, API-Routen, Datenbankzugriff
shared/          Gemeinsame Typen & Drizzle-Schema (Frontend + Backend)
script/          Build-Skript
```

## Hinweise zur Architektur

- Authentifizierung liegt ausschließlich im React-Context (kein `localStorage`/`sessionStorage`/Cookies) — ein voller Seiten-Reload meldet die aktuell angemeldete Person ab. Dies ist bewusst so umgesetzt, da diese Speicherarten in der Ziel-Laufzeitumgebung blockiert sind.
- Routing läuft über Hash-Pfade (`/#/...`), damit die App auch eingebettet in iframes zuverlässig funktioniert.
- Die Amazon-Business-Integration ist eine funktionale Simulation ohne echte externe Anbindung.
