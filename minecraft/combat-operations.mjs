export function isHostileEntity(entity,registry) {
 if(!entity || entity.username || !entity.position || !entity.name)return false;
 const category=registry?.entitiesByName?.[entity.name]?.category;
 return entity.kind==='Hostile mobs' || category==='Hostile mobs';
}
export function nearbyHostiles(bot,radius=16) {
 const p=bot.entity?.position;if(!p)return [];
 return Object.values(bot.entities||{}).filter(e=>isHostileEntity(e,bot.registry)).map(e=>({name:e.name,id:e.id,x:+e.position.x.toFixed(1),y:+e.position.y.toFixed(1),z:+e.position.z.toFixed(1),distance:+p.distanceTo(e.position).toFixed(1)})).filter(e=>e.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,8);
}
export function createCombatOperations({now=Date.now}={}) {
 let lastAttack=0;
 function attack(bot,{name,who}={}) {
  const mob=String(name||'').trim(),player=String(who||'').trim();
  if(!mob && !player)return {ok:false,error:'需要明确指定敌怪名称或玩家名称，不会自动攻击附近玩家'};
  if(mob&&player)return {ok:false,error:'一次只能指定一种目标'};
  const me=bot.entity?.position;if(!me)return {ok:false,error:'当前位置不可用'};
  const entities=Object.values(bot.entities||{}).filter(e=>e!==bot.entity && e?.position && (mob?(e.name===mob&&isHostileEntity(e,bot.registry)):(e.username===player && e.username!==bot.username)));
  entities.sort((a,b)=>me.distanceTo(a.position)-me.distanceTo(b.position));
  const target=entities[0];if(!target)return {ok:false,error:'附近没有可见的指定目标'};
  const distance=me.distanceTo(target.position);
  if(distance>3.5)return {ok:false,error:'目标超出近战距离，请先靠近',distance:+distance.toFixed(1)};
  if(lastAttack && now()-lastAttack<650)return {ok:false,error:'攻击冷却中'};
  try{bot.attack(target);lastAttack=now();return {ok:true,action:'attack',target:mob||player,distance:+distance.toFixed(1),attempted:true,damageConfirmed:false,note:'攻击已发出，伤害和击杀尚未确认；请继续观察目标。'};}
  catch(e){return {ok:false,error:'攻击未发出：'+String(e?.message||e)};}
 }
 return {attack};
}
