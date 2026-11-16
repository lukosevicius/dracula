# Dracula client

An Expo prototype for browsing Vilnius events. The interface is in Lithuanian and shares Seeker's event date filter logic and public event type.

## Run

Use Node.js 22.16 or newer. From this directory:

```sh
npm install
npm start
```

Open the QR code in Expo Go, or use the Expo terminal commands to open an installed iOS or Android simulator.

The app reads event data from `https://api.dracula.lt` by default. Set `EXPO_PUBLIC_API_URL` to use a different API. Never put credentials in `EXPO_PUBLIC_` variables.

Run `npm run build` to build the web app. It uses single-page routing and writes an Apache rewrite rule for direct event URLs. Hostinger challenged image requests from a localhost preview, while images loaded on the live app domain with CDN security at Medium.

The public app currently displays events marked Music that have an unknown date or have not ended. Check event classifications, artist matches, and image reuse permissions before a public release.
