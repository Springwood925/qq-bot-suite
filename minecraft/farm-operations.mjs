const AIR=new Set(['air','cave_air','void_air']);
const CROPS={wheat:{item:'wheat_seeds',max:7},carrots:{item:'carrot',max:7},potatoes:{item:'potato',max:7},beetroots:{item:'beetroot_seeds',max:3}};
const itemToCrop=Object.fromEntries(Object.entries(CROPS).map(([crop,x])=>[x.item,crop]));
export async function farmOperation(bot,{operation,position,item,makePos,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
 const p=bot?.entity?.position;if(!p||!position||!['x','y','z'].every(k=>Number.isInteger(position[k]))||typeof makePos!=='function')return {ok:false,error:'需要可用位置和整数坐标'};
 if(Math.hypot(p.x-position.x-.5,p.y-position.y,p.z-position.z-.5)>4.5)return {ok:false,error:'距离太远，请先走近'};
 if(bot.currentWindow||bot.isSleeping)return {ok:false,error:'请先关闭容器并起床'};
 const at=(x,y,z)=>bot.blockAt(makePos(x,y,z),false),{x,y,z}=position;
 const base=at(x,y,z),top=at(x,y+1,z);if(!base||!top)return {ok:false,error:'方块未加载'};
 if(operation==='inspect')return {ok:true,action:'farmInspect',base:base.name,above:top.name,age:top.metadata??null,mature:!!CROPS[top.name]&&(Number(top.metadata)>=CROPS[top.name].max)};
 if(operation==='till'){
  if(!['grass','dirt'].includes(base.name)||!AIR.has(top.name))return {ok:false,error:'需要上方为空的草方块或泥土'};
  let water=false,unknown=false;for(let dx=-4;dx<=4&&!water;dx++)for(let dz=-4;dz<=4&&!water;dz++)for(let dy=0;dy<=1;dy++){const b=at(x+dx,y+dy,z+dz);if(!b)unknown=true;if(b&&['water','flowing_water'].includes(b.name)){water=true;break}}
  const hoe=bot.inventory.items().find(i=>/^(wooden|stone|iron|golden|diamond)_hoe$/.test(i.name));if(!hoe)return {ok:false,error:'没有锄头'};
  try{await bot.equip(hoe,'hand');await bot.activateBlock(base);await wait(400);const after=at(x,y,z);return after?.name==='farmland'?{ok:true,action:'farmTill',position,waterNearby:water?'found':unknown?'unknown':'not-found',note:water?'附近发现水，仍需观察耕地状态。':'未确认附近有水；可耕地，建议结合现场安排灌溉。'}:{ok:false,error:'未确认变成耕地',actual:after?.name??null};}catch(e){return {ok:false,error:'耕地未确认：'+String(e.message||e)}}
 }
 if(operation==='plant'){
  const crop=itemToCrop[String(item||'')];if(!crop)return {ok:false,error:'需要指定已支持的种子或作物'};
  if(base.name!=='farmland'||!AIR.has(top.name))return {ok:false,error:'需要上方为空的耕地'};
  const seed=bot.inventory.items().find(i=>i.name===item&&i.count>0);if(!seed)return {ok:false,error:'背包没有指定种子'};
  try{await bot.equip(seed,'hand');await bot.placeBlock(base,makePos(0,1,0));await wait(400);const after=at(x,y+1,z);return after?.name===crop?{ok:true,action:'farmPlant',crop,position}:{ok:false,error:'未确认种植成功',actual:after?.name??null};}catch(e){return {ok:false,error:'种植未确认：'+String(e.message||e)}}
 }
 if(operation==='harvest'){
  const crop=CROPS[top.name];if(!crop||!Number.isFinite(Number(top.metadata))||Number(top.metadata)<crop.max)return {ok:false,error:'未确认作物成熟，不采收'};
  try{await bot.dig(top);await wait(400);const after=at(x,y+1,z);return AIR.has(after?.name)?{ok:true,action:'farmHarvest',crop:top.name,position,note:'已确认作物移除；掉落物和重种需另外核实。'}:{ok:false,error:'未确认作物已移除'};}catch(e){return {ok:false,error:'采收未确认：'+String(e.message||e)}}
 }
 return {ok:false,error:'未知农耕操作'};
}
