const SAFE=new Set(['dirt','cobblestone','stone','planks','sandstone','netherrack']);
const AIR=new Set(['air','cave_air','void_air']);
// One bounded jump/place. A failed or uncertain placement is never retried automatically.
export async function pillarStep(bot,{makePos,wait=ms=>new Promise(r=>setTimeout(r,ms)),item}={}) {
 const p=bot?.entity?.position,slots=bot?.inventory;
 if(!p||!slots||typeof makePos!=='function'||bot.entity.onGround!==true||bot.currentWindow||bot.isSleeping)return {ok:false,error:'状态不适合垫脚，请先站稳并关闭容器'};
 const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z);
 if(Math.abs(p.x-x-.5)>.3||Math.abs(p.z-z-.5)>.3)return {ok:false,error:'未站在方块中央，请先调整位置'};
 const floor=bot.blockAt(makePos(x,y-1,z)),feet=bot.blockAt(makePos(x,y,z)),head=bot.blockAt(makePos(x,y+2,z)),above=bot.blockAt(makePos(x,y+3,z));
 if(!floor||floor.boundingBox!=='block'||!feet||!AIR.has(feet.name)||!head||!AIR.has(head.name)||!above||!AIR.has(above.name))return {ok:false,error:'支撑或头顶空间不足，未垫脚'};
 const stack=slots.items().find(i=>SAFE.has(i.name)&&i.count>0&&(!item||i.name===item));
 if(!stack)return {ok:false,error:'没有可确认的普通垫脚方块'};
 const blockType=bot.registry?.blocksByName?.[stack.name]?.id;if(!Number.isInteger(blockType))return {ok:false,error:'无法确认方块类型'};
 try{
  await bot.equip(stack,'hand');bot.setControlState('jump',true);
  let raised=false;
  for(let i=0;i<12;i++){await wait(50);const q=bot.entity?.position;if(!q||Math.floor(q.x)!==x||Math.floor(q.z)!==z)break;if(q.y>=y+1.01){raised=true;break;}}
  if(!raised)return {ok:false,error:'跳起高度或位置未确认，未放置'};
  bot.setControlState('jump',false);
  await bot.placeBlock(floor,makePos(0,1,0));
  await wait(400);
  const placed=bot.blockAt(makePos(x,y,z)),q=bot.entity?.position;
  if(!placed||placed.type!==blockType)return {ok:false,error:'未能确认放置结果',actual:placed?.name??null};
  return {ok:true,action:'pillarStep',block:placed.name,target:{x,y,z},position:q?{x:q.x,y:q.y,z:q.z}:null,ascended:!!q&&q.y>=y+.8,note:'已确认方块；是否站稳请结合 ascended 和后续状态判断。'};
 }catch(e){return {ok:false,error:'垫脚未完成或未确认：'+String(e?.message||e)};}
 finally{try{bot.setControlState('jump',false)}catch{}}
}
