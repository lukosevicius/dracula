# Dracula client

An Expo prototype for browsing Vilnius events. The interface is in Lithuanian and shares Seeker's event date filter logic and public event type.

## Run

Use Node.js 22.16 or newer. From this directory:

```sh
npm install
npm start
```

Open the QR code in Expo Go, or use the Expo terminal commands to open an installed iOS or Android simulator.

For a static web build, run `npm run build` and serve the resulting `dist` directory with a local web server.

Seeker's date-filter implementation is the source of truth. The client synchronizes a generated copy before the npm start, platform, typecheck and build scripts, so Metro can bundle it. Edit the Seeker file rather than the generated copy. Run these npm scripts instead of invoking Expo directly to pick up filter changes.

## Refresh sample data

```sh
npm run export:events
```

This reads the local `seeker/data/seeker.sqlite` database and copies event information, accepted artist links, and available images into the client. It does not alter Seeker's database or source images. On macOS, copies are resized when this reduces their file size. The snapshot includes all event review types for local testing, including non-music and unsure events. Changes in Seeker do not appear until the export runs again.

This is a local prototype, not a live data service. Check the event classifications, artist matches, and image reuse permissions before a public release.
