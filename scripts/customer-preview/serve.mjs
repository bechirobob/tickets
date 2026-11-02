// Standalone synthetic component preview. Never starts Tickets API or a database.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
const root=resolve('scripts/customer-preview/harness');
const server=await createServer({configFile:false,root,publicDir:resolve('public'),plugins:[react(),{name:'deny-preview-api',configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/api/'))return next();res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Synthetic preview only. No requests are saved or sent.'}));});}}],resolve:{alias:{'@':process.cwd(),'next/link':resolve(root,'link.tsx'),'next/image':resolve(root,'image.tsx'),'next/navigation':resolve(root,'navigation.ts')}},server:{host:'127.0.0.1',port:8796,strictPort:true,fs:{allow:[process.cwd()]}}});
await server.listen();console.log('Synthetic component preview http://127.0.0.1:8796');
