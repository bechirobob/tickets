// Local component integration harness. No server routes/auth bypass is built into Tickets.
import { realpathSync } from 'node:fs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fixtureResponse } from './fixtures.mjs';
import { resolve } from 'node:path';
const root = resolve('scripts/boardui-integration/harness');
const server = await createServer({ configFile:false, root, publicDir:resolve('public'), plugins:[react(), { name:'fictional-device-responses', configureServer(server){ server.middlewares.use((request,response,next)=>{ const url=new URL(request.url,'http://localhost'); if(!url.pathname.startsWith('/api/'))return next(); response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store'); if(request.method!=='GET'){response.statusCode=405;response.end(JSON.stringify({error:'Read-only local preview. Nothing was saved or sent.'}));return;}const data=fixtureResponse(url);response.statusCode=data?200:503;response.end(JSON.stringify(data??{error:'This area is outside the local device preview.'})); }); } }], resolve:{ alias:{ '@':process.cwd(), 'next/navigation':resolve(root,'navigation.ts'), 'next/link':resolve(root,'link.tsx'), 'next/image':resolve(root,'image.tsx') } }, server:{ host:process.argv.includes('--lan')?'0.0.0.0':'127.0.0.1', port:8795, strictPort:true, fs:{allow:[process.cwd(), realpathSync('node_modules')]} } });
await server.listen(); console.log('Local source-component harness: http://127.0.0.1:8795');
