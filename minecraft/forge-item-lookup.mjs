import fs from 'node:fs/promises';
import path from 'node:path';

export function currentLocalWorld(log) {
  const text=String(log||''),start=text.lastIndexOf('Starting integrated minecraft server');
  if(start<0 || text.lastIndexOf('Stopping server')>start) return null;
  const tail=text.slice(start);let match,last=null;
  const re=/Saving chunks for level '([^'\r\n]+)'\/overworld/g;
  while((match=re.exec(tail)))last=match[1];
  return last && last!=='.' && last!=='..' && !/[\\/:*?"<>|]/.test(last) ? last : null;
}

// Local save registries are world-specific. Only use the currently observed
// integrated world, and never rewrite Mineflayer's inventory item identities.
export function createForgeItemLookup({gameDir,readFile=fs.readFile,parse}={}) {
  return async function lookup(items) {
    if(!gameDir || !items.some(i=>i.name==='unknown'))return new Map();
    try {
      const log=await readFile(path.join(gameDir,'logs','latest.log'),'utf8');
      const world=currentLocalWorld(log);if(!world)return new Map();
      const file=path.join(gameDir,'saves',world,'level.dat');
      const data=await readFile(file);
      const nbt=parse ? await parse(data) : await (async()=>{const mod=await import('prismarine-nbt');return mod.default.simplify((await mod.default.parse(data)).parsed)})();
      const entries=nbt?.FML?.Registries?.['minecraft:items']?.ids;
      if(!Array.isArray(entries))return new Map();
      const result=new Map();
      for(const v of entries)if(Number.isInteger(v.V)&&typeof v.K==='string'&&v.K.length<160)result.set(v.V,{registryName:v.K,registryWorld:world});
      return result;
    } catch {return new Map();}
  };
}
