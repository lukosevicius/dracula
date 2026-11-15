const app = require('./app.json');
// API builds use client-side routing for events created after deployment.
module.exports = { ...app.expo, web: { ...app.expo.web, output: process.env.EXPO_PUBLIC_API_URL ? 'single' : 'static' } };
