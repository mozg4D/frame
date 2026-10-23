// Minimal MCP stdio adapter. Frame owns schemas, validation and command execution.
import {createInterface} from 'node:readline';
import {launch,ready} from './browser.mjs';
const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
let session=null,connecting=null,initialized=false,queue=Promise.resolve();
async function connect(){if(session)return session;if(!connecting)connecting=(async()=>{const s=await launch({headless:!args.includes('--headed'),cdp:option('--cdp'),url:option('--url')});try{await ready(s.page);session=s;return s;}catch(e){await s.close();throw e;}})().finally(()=>{connecting=null;});return connecting;}
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
async function handle(message){const id=message?.id??null,error=(code,text)=>({jsonrpc:'2.0',id,error:{code,message:text}});if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string'){send(error(-32600,'Invalid Request'));return;}if(message.method.startsWith('notifications/'))return;
  if(message.method==='initialize'){initialized=true;send({jsonrpc:'2.0',id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'frame',version:'1.0.0'},instructions:'Commands edit the selected Frame session and use normal Undo. Default launch is an isolated session. Discover schemas with tools/list.'}});return;}
  if(message.method==='ping'){send({jsonrpc:'2.0',id,result:{}});return;}if(!initialized){send(error(-32000,'Initialize first'));return;}if(!['tools/list','tools/call'].includes(message.method)){send(error(-32601,'Method not found'));return;}
  try{const s=await connect();const reply=await s.page.evaluate(m=>window.frameAI.rpc(m),message);if(reply)send(reply);}catch(e){send(error(-32603,e.message));}
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});input.on('line',line=>{if(line.length>16*1024*1024){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request exceeds 16 MiB'}});return;}let message;try{message=JSON.parse(line);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}queue=queue.catch(e=>process.stderr.write(e.message+'\n')).then(()=>handle(message));});
input.on('close',async()=>{await queue;await session?.close();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await session?.close();process.exit(0);});
