/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';

// Event pages go through event.php, which adds that event's link preview tags; everything else is the single-page app.
const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://api.dracula.lt').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(apiUrl)) throw new Error(`EXPO_PUBLIC_API_URL must be an https origin, not ${apiUrl}.`);
const preview = readFileSync(new URL('../web/event.php', import.meta.url), 'utf8');
if (!preview.includes("'%API_URL%'")) throw new Error('web/event.php is missing its API address placeholder.');
writeFileSync('dist/event.php', preview.replace("'%API_URL%'", JSON.stringify(apiUrl).replace(/"/g, "'")));
if (!readFileSync('dist/index.html', 'utf8').includes('<!-- /preview -->')) throw new Error('dist/index.html lost its link preview block.');

writeFileSync('dist/.htaccess', `<IfModule mod_mime.c>
  AddType application/manifest+json .webmanifest
</IfModule>
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^events/([1-9][0-9]{0,11})/?$ event.php?id=$1 [L,QSA]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
`);
