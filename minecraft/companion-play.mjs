// Bounded exploration around the owner. No block breaking or placement.
export function createCompanionPlay({bot, actions, owner, intervalMs=90000, log=()=>{}, random=Math.random}) {
  let enabled=false, generation=0, timer=null, phase='stopped', goal=null, lastResult=null;
  const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};
  function schedule(ms=intervalMs){clear(); if(enabled) timer=setTimeout(()=>void tick(),ms);}
  function safeSnapshot(){
    const me=bot.entity?.position, player=bot.players?.[owner]?.entity?.position;
    if(!me) return {reason:'游戏位置不可用'};
    return {me,player:player && me.distanceTo(player)<=16 ? player : me};
  }
  function chooseTarget(player){
    const base=player.floored();
    const offsets=[[5,0],[-5,0],[0,5],[0,-5],[4,4],[-4,-4],[4,-4],[-4,4]];
    const start=Math.floor(random()*offsets.length);
    for(let i=0;i<offsets.length;i++){
      const [x,z]=offsets[(start+i)%offsets.length];
      for(const y of [0,1,-1]){
        const foot=base.offset(x,y,z), ground=bot.blockAt(foot.offset(0,-1,0)), feet=bot.blockAt(foot), head=bot.blockAt(foot.offset(0,1,0));
        if(ground?.boundingBox==='block' && feet?.name==='air' && head?.name==='air' && !/lava|water/.test(ground.name)) return {x:foot.x,y:foot.y,z:foot.z};
      }
    }
    return null;
  }
  async function tick(){
    if(!enabled)return;
    const id=generation, safe=safeSnapshot();
    if(safe.reason){phase='waiting';lastResult={ok:false,reason:safe.reason};schedule();return;}
    const target=chooseTarget(safe.player);
    if(!target){phase='waiting';lastResult={ok:false,reason:'附近没有找到安全落脚点'};schedule();return;}
    goal={kind:'explore',target,startedAt:Date.now()}; phase='moving';
    let ok=false, error=null;
    try{ok=await actions.gotoXYZ(target.x,target.y,target.z,1);}catch(e){error=e.message;}
    if(!enabled || id!==generation)return;
    lastResult={ok,reason:error||(ok?'到达附近探索点':'未能到达探索点'),target,at:Date.now()};
    goal=null; phase='following';
    if(bot.players?.[owner]?.entity) actions.follow(owner); else phase='waiting';
    log(`自主探索：${lastResult.reason}`);
    schedule();
  }
  function start(){if(enabled)return;enabled=true;generation++;phase='following';actions.follow(owner);schedule(10000);}
  function stop(){enabled=false;generation++;clear();if(phase==='moving')actions.stopMoving();goal=null;phase='stopped';}
  function status(){return {enabled,phase,goal,lastResult,intervalMs};}
  return {start,stop,status,tick};
}
