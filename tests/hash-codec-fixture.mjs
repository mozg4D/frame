import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function createFrameHashCodec(){'),end=html.indexOf('const FrameHash=createFrameHashCodec();',start);
export const codecSource=html.slice(start,end);
export const H=Function(codecSource+'return createFrameHashCodec();')();
const keyStart=html.indexOf('function frameValueKey(input){',end),keyEnd=html.indexOf('// Derived normal images',keyStart);
export const keySource=html.slice(keyStart,keyEnd);
