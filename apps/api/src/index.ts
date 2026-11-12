import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { config } from 'dotenv';
import { createSupabaseEmailRuntime } from './supabase-runtime';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
config({path:[path.join(root,'.env.local'),path.join(root,'.env')],quiet:true});
const runtime=createSupabaseEmailRuntime({...process.env,
  SUPABASE_URL:process.env.SUPABASE_URL??process.env.EASY_LATEX_SUPABASE_URL,
  SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY??process.env.EASY_LATEX_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.EASY_LATEX_SUPABASE_SERVICE_KEY,
});
const controllers=new Set<AbortController>();
const server=createServer((incoming,outgoing)=>{
  const controller=new AbortController();controllers.add(controller);
  outgoing.once('close',()=>{controller.abort();controllers.delete(controller);});
  void(async()=>{
    try {
      const target=new URL(incoming.url??'/','http://127.0.0.1');
      if(!target.pathname.startsWith('/easy-latex-api/')&&!target.pathname.startsWith('/functions/v1/easy-latex-api/'))target.pathname='/easy-latex-api'+target.pathname;
      const headers=new Headers();
      for(const [key,value] of Object.entries(incoming.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
      const init:RequestInit&{duplex?:'half'}={method:incoming.method??'GET',headers,signal:controller.signal};
      if(!['GET','HEAD'].includes(init.method!)){init.body=Readable.toWeb(incoming) as ReadableStream<Uint8Array>;init.duplex='half';}
      const response=await runtime.fetch(new Request(target,init));
      outgoing.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body)await pipeline(Readable.fromWeb(response.body as NodeReadableStream),outgoing);
      else outgoing.end();
    }catch{
      if(!outgoing.headersSent)outgoing.writeHead(503,{'Content-Type':'application/json'});
      if(!outgoing.destroyed)outgoing.end(JSON.stringify({message:'The operation could not be completed. Please retry.'}));
    }
  })();
});
server.listen(Number(process.env.API_PORT??process.env.PORT??4318),process.env.API_HOST??'127.0.0.1',()=>console.log('Easy LaTeX Supabase email collaboration API is ready.'));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{
  for(const controller of controllers)controller.abort();
  server.close();server.closeAllConnections();void runtime.close();
});
