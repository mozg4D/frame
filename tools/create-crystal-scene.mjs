// Reproducible native HASH fixture. The resulting file contains all extension code.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {launch,ready} from './browser.mjs';

export const crystalSource=`export function activate(ctx) {
 const presets = [
  {name:'Diamond', species:6, structure:'diamond', lattice:3.567},
  {name:'Silicon', species:14, structure:'diamond', lattice:5.431},
  {name:'Copper', species:29, structure:'fcc', lattice:3.615},
  {name:'Iron', species:26, structure:'bcc', lattice:2.866}
 ];
 let created=ctx.core.nodes.filter(n=>n.type==='atomic').length;
 async function createCrystal(index,cells=3) {
  const preset=presets[index];
  if(!preset)throw Error('Choose a crystal.');
  const result=await ctx.call('plugins.create',{plugin:'atomic'}),id=result.hash;
  await ctx.call('scene.update',{id,name:preset.name,params:{'Time scale':0}});
  await ctx.call('plugins.command',{id,operation:'create-crystal',args:{species:preset.species,structure:preset.structure,lattice:preset.lattice,cells:[cells,cells,cells]}});
  // Leave separate crystals next to one another; atomic coordinates are angstroms.
  ctx.core.transaction(()=>{const matrix=Array.from(ctx.core.engine.pluginLocal(id));matrix[12]+=created++*24;ctx.core.engine.pluginSetLocal(id,matrix);});
  await ctx.call('scene.select',{ids:[id]});
  await ctx.call('view.set',{focus:id});
  return {id,name:preset.name,atoms:cells**3*(preset.structure==='diamond'?8:preset.structure==='fcc'?4:2)};
 }
 ctx.control.register(({document,root})=>{
  const title=document.createElement('h1');title.textContent='Crystal studio';
  const intro=document.createElement('p');intro.textContent='Choose a crystal to add it to the scene.';
  const label=document.createElement('label');label.textContent='Unit cells per axis ';
  const cells=document.createElement('input');cells.type='number';cells.min='1';cells.max='12';cells.value='3';cells.style.width='70px';cells.dataset.crystalCells='';label.append(cells);
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0';
  const message=document.createElement('p');message.setAttribute('role','status');message.textContent='Ready';
  const buttons=[];
  presets.forEach((preset,index)=>{
   const button=document.createElement('button');button.textContent=preset.name;button.dataset.crystal=preset.name;buttons.push(button);grid.append(button);
   button.onclick=async()=>{
    const count=Number(cells.value);
    if(!Number.isInteger(count)||count<1||count>12){message.textContent='Choose 1 to 12 unit cells per axis.';return;}
    buttons.forEach(b=>b.disabled=true);message.textContent='Creating '+preset.name+'…';
    try{const result=await createCrystal(index,count);message.textContent=result.name+' · '+result.atoms+' atoms';}
    catch(error){message.textContent=error.message;}
    finally{buttons.forEach(b=>b.disabled=false);}
   };
  });
  const note=document.createElement('p');note.textContent='Each button creates a native Atomic object. Use Frame attributes and the timeline as usual.';note.style.cssText='color:#999;font-size:12px';
  root.append(title,intro,label,grid,message,note);
 });
 return {exports:{createCrystal}};
}`;

export async function installCrystalScene(page){
 const source='c1'.repeat(16),program='c2'.repeat(16);
 await page.evaluate(async({text,source,program})=>{
  await frameAI.call('scene.new');const a=await frameAI.call('authorData.get',{owner:'scene'});
  await frameAI.call('authorData.replace',{owner:'scene',expected:{epoch:a.epoch,revision:a.data.revision},records:[
   {id:source,revision:0,name:'Crystal studio source',kind:'source',refs:[],payload:{language:'javascript',text}},
   {id:program,revision:0,name:'Crystal studio',kind:'opaque',refs:[{kind:'record',owner:'scene',id:source}],payload:{format:'frame.scene-control',version:1,data:{source:0,context:'main',start:'ready'}}}
  ]});
 },{text:crystalSource,source,program});
 await page.waitForFunction(id=>framePrograms.status({owner:'scene',id})?.state==='running',program);
 return program;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const session=await launch({headless:true});
 try{
  await ready(session.page);const id=await installCrystalScene(session.page);
  const result=await session.page.evaluate(id=>framePrograms.invokeDirect({owner:'scene',id,method:'createCrystal',args:[0,3]}),id);
  const exported=await session.page.evaluate(()=>frameAI.call('scene.export',{includeData:true}));
  await mkdir(new URL('../scenes/',import.meta.url),{recursive:true});await writeFile(new URL('../scenes/crystals.hash',import.meta.url),Buffer.from(exported.base64,'base64'));
  console.log(JSON.stringify({scene:'scenes/crystals.hash',bytes:Buffer.from(exported.base64,'base64').length,example:result}));
 }finally{await session.close();}
}
