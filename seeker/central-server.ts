import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createCentralApi } from './central-api.js';
import { createCentralDashboard } from './central-dashboard.js';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
// Keep the central connection in a separate ignored file from source API keys.
if(existsSync(join(root,'.env.central')))loadEnvFile(join(root,'.env.central'));
if(existsSync(join(root,'.env')))loadEnvFile(join(root,'.env'));
if(!process.env.CENTRAL_API_URL || !process.env.CENTRAL_API_TOKEN)throw new Error('Set CENTRAL_API_URL and CENTRAL_API_TOKEN.');
const port=Number(process.env.PORT || 4177);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT.');
const handle=createCentralDashboard(createCentralApi(process.env.CENTRAL_API_URL,process.env.CENTRAL_API_TOKEN));
const clientDir=join(root,'client','dist');
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const allowedOrigins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,process.env.SEEKER_DEV_ORIGIN].filter((origin):origin is string=>Boolean(origin)));
const server=createServer(async(req,res)=>{
  const host=req.headers.host || '';
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(403);res.end('Forbidden');return;}
  if(req.headers.origin && !allowedOrigins.has(req.headers.origin)){res.writeHead(403);res.end('Forbidden');return;}
  if(await handle(req,res))return;
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const url=new URL(req.url || '/','http://localhost');
  let pathname:string;
  try {pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
  if(pathname==='/' || pathname==='/vilnius-events.html' || pathname==='/avilys.html' || pathname==='/ai-evaluation.html' || pathname==='/saved-events.html')pathname='/index.html';
  const file=normalize(join(clientDir,pathname));
  if(!file.startsWith(`${clientDir}/`)){res.writeHead(403);res.end();return;}
  try {const data=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)] || 'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(data);}
  catch {res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Seeker at http://127.0.0.1:${port} (central database; unsupported features are disabled).`));
