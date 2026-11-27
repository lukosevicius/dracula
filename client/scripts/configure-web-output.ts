/// <reference types="node" />
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

// Event pages go through event.php (link previews and event details for search engines), /sitemap.xml through sitemap.php;
// everything else is the single-page app. Both PHP pages share common.php, which gets the API address.
const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://api.dracula.lt').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(apiUrl)) throw new Error(`EXPO_PUBLIC_API_URL must be an https origin, not ${apiUrl}.`);
const common = readFileSync(new URL('../web/common.php', import.meta.url), 'utf8');
if (!common.includes("'%API_URL%'")) throw new Error('web/common.php is missing its API address placeholder.');
writeFileSync('dist/common.php', common.replace("'%API_URL%'", JSON.stringify(apiUrl).replace(/"/g, "'")));
for (const page of ['event.php', 'sitemap.php']) copyFileSync(new URL(`../web/${page}`, import.meta.url), `dist/${page}`);
if (!readFileSync('dist/index.html', 'utf8').includes('<!-- /preview -->')) throw new Error('dist/index.html lost its link preview block.');

writeFileSync('dist/.htaccess', `<IfModule mod_mime.c>
  AddType application/manifest+json .webmanifest
</IfModule>
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTP_HOST} ^www\\.dracula\\.lt$ [NC]
  RewriteRule ^ https://dracula.lt%{REQUEST_URI} [R=301,L]
  RewriteRule ^sitemap\\.xml$ sitemap.php [L]
  RewriteRule ^common\\.php$ - [F,L]
  RewriteRule ^renginiai/(?:[a-z0-9-]*-)?([1-9][0-9]{0,11})/?$ event.php?id=$1 [L,QSA]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
`);
