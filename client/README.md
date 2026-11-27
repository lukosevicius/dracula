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

The web account page uses Google Sign-In and the API's cookie-based user sessions. The public Google web client ID defaults to Dracula's configured client ID; set `EXPO_PUBLIC_GOOGLE_CLIENT_ID` before building to use another Google OAuth web client. The client ID is public and is not a client secret. The API must have migrations 006 and 007 applied and must be configured with the same client ID and an allowed app origin. For local sign-in use a local API with `PUBLIC_BASE_URL=http://localhost:3000`, `AUTH_ORIGINS=http://localhost:8081`, and `EXPO_PUBLIC_API_URL=http://localhost:3000`; browsers will not send the production API's same-site session cookies from a localhost app. Native sign-in is not implemented yet.

Run `npm run build` to build the web app. It uses single-page routing and writes an Apache rewrite rule for direct event URLs. Hostinger challenged image requests from a localhost preview, while images loaded on the live app domain with CDN security at Medium.

## Web deployment

The `Deploy web app` GitHub Actions workflow runs on pushes to `main` and can also be started manually for `main`. It runs the project checks, builds the web app, and uploads it to Hostinger over SSH. It uploads assets before `index.html` and retains older assets so existing visitors can continue using cached pages. It does not deploy the API, run database migrations, or modify event images.

The workflow requires a `production-web` GitHub environment configured with these variables: `HOSTINGER_SSH_HOST`, `HOSTINGER_SSH_PORT`, `HOSTINGER_SSH_USER`, `HOSTINGER_WEB_ROOT` (the confirmed absolute directory for dracula.lt), and `HOSTINGER_SSH_FINGERPRINT` (the ED25519 host-key fingerprint shown in Hostinger). Add `HOSTINGER_SSH_PRIVATE_KEY` as an environment secret. The workflow checks the server's scanned host key against the configured fingerprint. Use a dedicated deployment key and understand which files its Hostinger account can access.

Before the first deployment, verify the web root in Hostinger and create an empty `.dracula-client-deploy-target` file in that directory. The workflow refuses to upload without it. After the workflow and configuration are in place, open GitHub **Actions → Deploy web app → Run workflow**, select `main`, and inspect the result and the live site. A successful HTTP check only confirms that the homepage responds; also check event pages, images, and direct links. Old assets are not automatically deleted and may need planned cleanup later.

The public app currently displays events marked Music that have an unknown date or have not ended. Check event classifications, artist matches, and image reuse permissions before a public release.
