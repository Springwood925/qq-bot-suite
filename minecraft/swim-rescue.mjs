// Brief active recovery from drowning. It does not disable planning or require
// the owner to be nearby; normal movement resumes after reaching air.
export function createSwimRescue(bot,{now=Date.now,log=()=>{},maxSubmergedMs=8000,lowOxygen=8}={}) {
 let submergedAt=null,active=false,lastReason=null;
 function release() {if(active){try{bot.setControlState('jump',false)}catch{}active=false;log('已离开水下，结束自动上浮');}}
 function tick() {
  const pos=bot.entity?.position;if(!pos)return;
  let head;try{head=bot.blockAt(pos.offset(0,1.62,0).floored())}catch{return}
  if(!head)return; // unloaded is not evidence of air
  if(!['water','flowing_water'].includes(head.name)){submergedAt=null;release();return;}
  if(submergedAt===null)submergedAt=now();
  const oxygen=Number.isFinite(bot.oxygenLevel)?bot.oxygenLevel:null;
  const low=oxygen!==null && oxygen<=lowOxygen;
  if(!active && (low || now()-submergedAt>=maxSubmergedMs)){
   active=true;lastReason=low?'low_oxygen':'submerged_timeout';log('水下呼吸不足或潜水过久，尝试上浮');
  }
  if(active)try{bot.setControlState('jump',true)}catch{}
 }
 bot.on('physicsTick',tick);
 return {status:()=>({active,submerged:submergedAt!==null,reason:lastReason}),close:()=>{bot.removeListener('physicsTick',tick);release();}};
}
