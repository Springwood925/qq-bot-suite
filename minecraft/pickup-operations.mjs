export function createPickupOperations({preview,toVec,wait=ms=>new Promise(r=>setTimeout(r,ms))}) {
 let busy=false;
 async function collect(bot,actions,{name,x,y,z}={}) {
  const wanted=String(name||'').trim();
  if(!wanted || wanted==='unknown')return {ok:false,error:'需要指定已识别的掉落物名称，不能猜测未知物品'};
  if(busy)return {ok:false,error:'已有拾取操作进行中'};
  if(bot.isSleeping || bot.currentWindow)return {ok:false,error:'请先起床并关闭容器'};
  const from=bot.entity?.position;if(!from)return {ok:false,error:'当前位置不可用'};
  const coords=[x,y,z];const hasCoords=coords.every(Number.isFinite);
  if(coords.some(v=>v!==undefined) && !hasCoords)return {ok:false,error:'坐标需要同时提供 x、y、z'};
  const candidates=[];
  for(const e of Object.values(bot.entities||{})){
   if(!e?.position || !['item','item_stack'].includes(String(e.name||'').toLowerCase()))continue;
   let item;try{item=e.getDroppedItem?.()}catch{continue}
   if(!item || item.name!==wanted || from.distanceTo(e.position)>24)continue;
   if(hasCoords && Math.hypot(e.position.x-x,e.position.y-y,e.position.z-z)>2)continue;
   candidates.push({entity:e,item,distance:from.distanceTo(e.position)});
  }
  candidates.sort((a,b)=>a.distance-b.distance);
  const selected=candidates[0];if(!selected)return {ok:false,error:'附近没有可确认名称的指定掉落物'};
  const p=selected.entity.position,start=from.clone(),target=toVec(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));
  const inventoryCount=()=>bot.inventory.items().filter(i=>i.type===selected.item.type&&(i.metadata??0)===(selected.item.metadata??0)).reduce((n,i)=>n+i.count,0);
  busy=true;
  try {
   const forward=preview(bot,start,target,0);
   if(forward?.status!=='success')return {ok:false,error:'没有确认通往掉落物的无破坏路线',route:forward?.status||'unknown'};
   const end=forward.path?.at(-1)||start;
   const back=preview(bot,toVec(end.x,end.y,end.z),start,1);
   if(back?.status!=='success')return {ok:false,error:'没有确认可返回的无破坏路线，未进入坑中',returnRoute:back?.status||'unknown'};
   const before=inventoryCount(),moved=await actions.gotoXYZ(target.x,target.y,target.z,0);
   await wait(1200);const after=inventoryCount();
   return {ok:after>before,action:'collect',item:wanted,target:{x:target.x,y:target.y,z:target.z},moved,before,after,gained:Math.max(0,after-before),...(after<=before?{reason:'未确认该物品进入背包；可能未走到、未拾取或已被其他实体拿走'}:{})};
  } catch(e){return {ok:false,error:'拾取未完成：'+String(e?.message||e)};}
  finally{busy=false;}
 }
 return {collect,isBusy:()=>busy};
}
