export function createFoodOperations() {
 let busy=false;
 async function eat(bot,name) {
  if(busy)return {ok:false,error:'另一个进食操作尚未结束'};
  if(bot.currentWindow)return {ok:false,error:'请先关闭容器'};
  if(bot.isSleeping)return {ok:false,error:'正在睡觉，请先起床'};
  if(!name)return {ok:false,error:'需要指定背包里的食物名称'};
  const item=bot.inventory.items().find(i=>i.name===name);
  if(!item)return {ok:false,error:'背包里没有该食物'};
  if(!bot.registry.foodsByName?.[item.name])return {ok:false,error:'无法确认这是可食用的原版物品，未使用'};
  if(Number.isFinite(bot.food)&&bot.food>=20)return {ok:false,error:'饥饿值已满，未消耗食物',food:bot.food};
  const count=()=>bot.inventory.items().filter(i=>i.type===item.type&&(i.metadata??0)===(item.metadata??0)).reduce((n,i)=>n+i.count,0);
  const beforeCount=count(),beforeFood=bot.food;
  busy=true;
  try {
   await bot.equip(item,'hand');await bot.consume();
   const afterCount=count(),afterFood=bot.food;
   const confirmed=afterCount<beforeCount || (Number.isFinite(beforeFood)&&Number.isFinite(afterFood)&&afterFood>beforeFood);
   return {ok:confirmed,action:'eat',item:name,beforeCount,afterCount,beforeFood,afterFood,...(!confirmed?{reason:'未能确认食物消耗或饥饿值变化'}:{})};
  } catch(e){return {ok:false,error:'进食未完成：'+String(e?.message||e),beforeCount,afterCount:count(),beforeFood,afterFood:bot.food};}
  finally{busy=false;}
 }
 return {eat};
}
