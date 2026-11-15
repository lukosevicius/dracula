import { writeFileSync } from 'node:fs';
if (process.env.EXPO_PUBLIC_API_URL) {
  writeFileSync('dist/.htaccess', `<IfModule mod_rewrite.c>\n  RewriteEngine On\n  RewriteCond %{REQUEST_FILENAME} !-f\n  RewriteCond %{REQUEST_FILENAME} !-d\n  RewriteRule ^ index.html [L]\n</IfModule>\n`);
}
