/// <reference types="node" />
import { writeFileSync } from 'node:fs';
  writeFileSync('dist/.htaccess', `<IfModule mod_rewrite.c>\n  RewriteEngine On\n  RewriteCond %{REQUEST_FILENAME} !-f\n  RewriteCond %{REQUEST_FILENAME} !-d\n  RewriteRule ^ index.html [L]\n</IfModule>\n`);
