// Extra plugins and DPR2 are opt-in. The normal verification scope is core + Atomic.
const pluginArg=process.argv.find(arg=>arg.startsWith('--plugins='));
const requestedPlugins=pluginArg?pluginArg.slice('--plugins='.length).split(',').filter(Boolean):[];
if(pluginArg&&!requestedPlugins.length||requestedPlugins.some(id=>! /^[a-z0-9-]+$/.test(id)||id==='none'))throw Error('Use --plugins=<id,...> to add plugins to Atomic, or --plugins=all');
export const selectedPlugins=requestedPlugins.includes('all')?['all']:[...new Set(['atomic',...requestedPlugins])];
export const pluginEnabled=id=>selectedPlugins.includes('all')||selectedPlugins.includes(id);
export const extraPluginsEnabled=selectedPlugins.includes('all');
export const testDprs=process.argv.includes('--dpr2')?[1,2]:[Number(process.env.FRAME_DPR||1)];
export const excludedPluginResult=reason=>({skipped:true,reason,checks:[],timings:[]});
