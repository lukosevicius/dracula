# Dracula client

An Expo prototype for browsing Vilnius events. The interface is in Lithuanian and shares Seeker's event date filter logic and public event type.

## Run

Use Node.js 22.16 or newer. From this directory:

```sh
npm install
npm start
```

Open the QR code in Expo Go, or use the Expo terminal commands to open an installed iOS or Android simulator.

For a static web build, run `npm run build`. Configure the web server to resolve extensionless event URLs such as `/events/1` to the generated `/events/1.html` file, so that direct visits and refreshes work.

Seeker's date-filter implementation is the source of truth. The client synchronizes a generated copy before the npm start, platform, typecheck and build scripts, so Metro can bundle it. Edit the Seeker file rather than the generated copy. Run these npm scripts instead of invoking Expo directly to pick up filter changes.

## Refresh sample data

```sh
npm run export:events
```

This reads the local `seeker/data/seeker.sqlite` database and copies event information, original event links, accepted artist links, and available images into the client. It does not alter Seeker's database or source images. On macOS, copies are resized when this reduces their file size. The snapshot includes events marked Music that have an unknown date or have not ended, using the current date in Vilnius. Past events and events marked Not music or Unsure are excluded. Events with unknown dates appear under the Unknown date and All filters. Changes in Seeker do not appear until the export runs again. Event pages link to the original event URL when available and otherwise link to the Vilnius Events page.

The live app at `https://app.dracula.lt` reads paginated event data from `https://api.dracula.lt`. To build the API-backed web app, run `EXPO_PUBLIC_API_URL=https://api.dracula.lt npm run build`. API builds use single-page routing, and the build writes an Apache rewrite rule for event URLs. Builds clear Metro's cache so the API URL is not inherited from an earlier build. Hostinger challenged image requests from a localhost preview, while images loaded on the live app domain with CDN security at Medium. Never put credentials in `EXPO_PUBLIC_` variables. A build without the variable uses the local snapshot instead.

The public app currently displays events marked Music that have an unknown date or have not ended. Check event classifications, artist matches, and image reuse permissions before a public release.
