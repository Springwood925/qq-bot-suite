export function queryCraftable(bot,{name,limit=40}={}) {
 const wanted=String(name||'').trim();
 const tableId=bot.registry.blocksByName?.crafting_table?.id;
 const table=tableId===undefined?null:bot.findBlock({matching:[tableId],maxDistance:8});
 const hasTable=!!table;
 const check=def=>bot.recipesFor(def.id,null,1,table||null).length>0;
 if(wanted){
  const def=bot.registry.itemsByName?.[wanted];
  if(!def)return {ok:false,error:'没有这种已知物品：'+wanted,hasTable};
  try{const canCraft=check(def);return {ok:true,requested:wanted,canCraft,can:canCraft?[wanted]:[],hasTable,note:'以当前背包和附近工作台为准；材料或位置变化后需重新检查。'};}
  catch(e){return {ok:false,error:'配方检查失败：'+String(e?.message||e),requested:wanted,hasTable};}
 }
 const seen=new Set(),can=[];let truncated=false;
 const cap=Math.max(1,Math.min(100,Number(limit)||40));
 for(const item of bot.registry.itemsArray||[]){
  if(!item || seen.has(item.name))continue;seen.add(item.name);
  try{if(check(item)){if(can.length>=cap){truncated=true;break}can.push(item.name)}}catch{}
 }
 return {ok:true,can,hasTable,truncated,note:truncated?'列表已截断，可用 name 查询具体物品。':'以当前背包和附近工作台为准。'};
}
