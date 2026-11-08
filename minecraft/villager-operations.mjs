import {createHash} from 'node:crypto';
const item=i=>i?{name:String(i.name||''),id:Number(i.type),metadata:Number(i.metadata||0),count:Number(i.count||0)}:null;
const quote=(id,index,t)=>createHash('sha256').update(JSON.stringify([String(id),index,t])).digest('hex').slice(0,20);
export function createVillagerOperations({timeoutMs=8000}={}) {
 let busy=false;
 async function run(bot,{operation,who,index,expected}={}){
  if(busy||bot.currentWindow||bot.isSleeping)return {ok:false,error:'已有容器操作或无法交易'};
  const pos=bot.entity?.position;if(!pos)return {ok:false,error:'当前位置不可用'};
  const villagerId=bot.registry?.entitiesByName?.villager?.id ?? bot.registry?.entitiesByName?.Villager?.id;
  const list=Object.values(bot.entities||{}).filter(e=>e?.position&&(String(e.name||'').toLowerCase()==='villager'||(villagerId!=null&&e.entityType===villagerId))&&Math.hypot(e.position.x-pos.x,e.position.y-pos.y,e.position.z-pos.z)<=4.5);
  const target=who?list.find(e=>String(e.id)===String(who)):list.sort((a,b)=>Math.hypot(a.position.x-pos.x,a.position.y-pos.y,a.position.z-pos.z)-Math.hypot(b.position.x-pos.x,b.position.y-pos.y,b.position.z-pos.z))[0];
  if(!target)return {ok:false,error:'附近没有可确认的村民，请先走近'};
  if(operation==='trade'&&(!who||!Number.isInteger(index)||index<1||!expected))return {ok:false,error:'交易需要村民ID、报价序号及报价凭据，请先查看报价'};
  busy=true;let window=null,expired=false,timer;
  const opening=Promise.resolve().then(()=>bot.openVillager(target));
  opening.then(w=>{if(expired){try{bot.closeWindow(w)}catch{}busy=false}},()=>{if(expired)busy=false});
  try{
   window=await Promise.race([opening,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('打开交易窗口超时'))},timeoutMs)})]);clearTimeout(timer);
   if(!Array.isArray(window.trades))return {ok:false,error:'未收到交易列表'};
   const offers=window.trades.map((t,i)=>{const data={input:item(t.inputItem1||t.firstInput),second:item(t.inputItem2||t.secondaryInput),output:item(t.outputItem||t.output),price:Number(t.realPrice??t.inputItem1?.count??t.firstInput?.count??0),disabled:!!(t.tradeDisabled??t.disabled),uses:Number(t.nbTradeUses??t.tooluses??0),maxUses:Number(t.maximumNbTradeUses??t.maxTradeuses??0)};return {index:i+1,...data,quote:quote(target.id,i+1,data)}});
   if(operation==='list')return {ok:true,action:'villagerOffers',villagerId:String(target.id),offers};
   if(operation!=='trade')return {ok:false,error:'未知交易操作'};
   const offer=offers[index-1];if(!offer||offer.disabled||offer.quote!==expected)return {ok:false,error:'报价已变化或不可用，请重新查看'};
   if(!offer.output?.name||!offer.input?.name||offer.price<1)return {ok:false,error:'无法确认交易物品和价格'};
   const count=i=>bot.inventory.items().filter(x=>x.type===i.id&&(x.metadata??0)===i.metadata).reduce((n,x)=>n+x.count,0);
   if(count(offer.input)<offer.price||(offer.second&&count(offer.second)<offer.second.count))return {ok:false,error:'背包材料不足'};
   const before=count(offer.output);
   try{await bot.trade(window,index-1,1)}catch(e){return {ok:false,uncertain:true,error:'交易结果未确认，请重新检查背包与报价，不要直接重试：'+String(e.message||e)}}
   const after=count(offer.output);return after>before?{ok:true,action:'villagerTrade',villagerId:String(target.id),offer,received:after-before}:{ok:false,uncertain:true,error:'请求已执行但未观察到产物增加，请先核对背包'};
  }catch(e){return {ok:false,error:String(e.message||e)}}
  finally{clearTimeout(timer);if(window){try{bot.closeWindow(window)}catch{}busy=false}else if(!expired)busy=false;}
 }
 return {run};
}
