import mysql from 'mysql2/promise';
import { createCatalogue } from './catalogue.mjs';
import { createApp } from './app.mjs';

const required = ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','PUBLIC_BASE_URL','IMAGE_DIR'];
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`);
const base = new URL(process.env.PUBLIC_BASE_URL);
if (!['https:','http:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash) throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin');
const pool = mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:5,charset:'utf8mb4'});
await pool.query('SELECT 1');
const app=createApp(createCatalogue(pool,base.origin),process.env.IMAGE_DIR);
app.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('Dracula public API listening'));
