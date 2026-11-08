import pathfinderPkg from 'mineflayer-pathfinder';
import {applySafeNavigation} from './navigation-policy.mjs';
const {Movements,goals}=pathfinderPkg;

// A separate movements object leaves the bot's active route unchanged.
export function previewBetween(bot,start,target,range=1) {
    const moves=applySafeNavigation(new Movements(bot));
    const requested=Number.isFinite(Number(range))?Number(range):1;
    const goal=new goals.GoalNear(Math.floor(target.x),Math.floor(target.y),Math.floor(target.z),Math.max(0,Math.min(3,requested)));
    const gen=bot.pathfinder.getPathFromTo(moves,start,goal,{timeout:900,tickTimeout:100,searchRadius:64});
    const startedAt=Date.now();let result=null;
    do {const step=gen.next();if(step.done)break;result=step.value.result;} while(result?.status==='partial' && Date.now()-startedAt<750);
    return result;
}
// Compute a bounded preview without moving, digging or placing blocks.
export function diagnoseRoute(bot,target,{range=1}={}) {
  if(!bot.entity?.position || !bot.pathfinder?.getPathFromTo)return {ok:false,error:'寻路状态不可用'};
  const destination=bot.blockAt(target);
  if(!destination)return {ok:false,error:'目标区块未加载',target};
  try {
    const result=previewBetween(bot,bot.entity.position,target,range);
    const route=(result?.path||[]).map(p=>({x:p.x,y:p.y,z:p.z}));
    return {ok:true,action:'routePreview',target:{x:target.x,y:target.y,z:target.z},targetBlock:destination.name,status:result?.status||'unknown',steps:route.length,end:route.at(-1)||null,path:route.slice(0,16),note:'仅静态预览，不会移动或破坏方块；partial/timeout 不能证明无路，success 也不保证实走成功。'};
  } catch(e){return {ok:false,error:'路线预览失败：'+String(e?.message||e)};}
}
