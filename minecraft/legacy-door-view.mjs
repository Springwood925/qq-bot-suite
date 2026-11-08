import {createRequire} from 'node:module';
const isDoor=name=>/^(?:wooden|spruce|birch|jungle|acacia|dark_oak|iron)_door$/.test(String(name||''));
function shapeFactory(){
 const require=createRequire(import.meta.url),data=require('minecraft-data')('1.13.2'),Block=require('prismarine-block')(data),id=data.blocksByName.oak_door.id,cache=new Map();
 return ({facing,hinge,open,half})=>{const key=[facing,hinge,open,half].join(':');if(!cache.has(key)){const b=Block.fromProperties(id,{facing,hinge,open:String(open),half,powered:'false'},0);cache.set(key,b.shapes.map(x=>x.slice()));}return cache.get(key).map(x=>x.slice());};
}
// Read-only client collision correction; the world and raw door metadata remain unchanged.
export function installLegacyDoorView(bot,{shapeFor}={}){
 if(!/^1\.12(?:\.|$)/.test(String(bot.version||''))||typeof bot.blockAt!=='function')return false;
 const shapes=shapeFor||shapeFactory(),raw=bot.blockAt.bind(bot);
 bot.blockAt=function(pos,...args){
  const b=raw(pos,...args);if(!b||!isDoor(b.name)||!Number.isInteger(b.metadata)||typeof b.position?.offset!=='function')return b;
  try{
   const upperHalf=!!(b.metadata&8),lower=upperHalf?raw(b.position.offset(0,-1,0),false):b,upper=upperHalf?b:raw(b.position.offset(0,1,0),false);
   if(!lower||!upper||lower.name!==b.name||upper.name!==b.name||!Number.isInteger(lower.metadata)||!Number.isInteger(upper.metadata)||(lower.metadata&8)||!(upper.metadata&8))return b;
   const lp=lower.getProperties?.()||{},up=upper.getProperties?.()||{},facing=String(lp.facing||''),hinge=String(up.hinge||'');
   if(!['north','south','east','west'].includes(facing)||!['left','right'].includes(hinge))return b;
   const open=!!(lower.metadata&4),half=upperHalf?'upper':'lower',correct=shapes({facing,hinge,open,half});
   if(!Array.isArray(correct)||!correct.every(a=>Array.isArray(a)&&a.length===6))return b;
   return Object.assign(Object.create(Object.getPrototypeOf(b)),b,{shapes:correct});
  }catch{return b;}
 };
 return true;
}
