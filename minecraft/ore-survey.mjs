// Loaded, exposed ores only; this is a local observation, not a mining action.
export function surveyExposedOres(bot,{radius=8,limit=20,makePos}={}) {
  if (!bot?.entity?.position || typeof makePos!=='function') return {ok:false,error:'position unavailable'};
  const registry=bot.registry?.blocksByName||{};
  const ids=Object.entries(registry).filter(([name,v])=>/(?:^|_)ore(?:_\d+)?$/.test(name)&&Number.isInteger(v?.id)).map(([,v])=>v.id);
  const distance=Math.max(2,Math.min(12,Number(radius)||8)),cap=Math.max(1,Math.min(30,Number(limit)||20));
  const points=ids.length ? bot.findBlocks({matching:ids,maxDistance:distance,count:128}) : [];
  const offsets=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const ores=[];
  for(const p of points){
    const block=bot.blockAt(p,false);if(!block)continue;
    const exposed=offsets.some(([x,y,z])=>{const n=bot.blockAt(makePos(p.x+x,p.y+y,p.z+z),false);return n&&(n.name==='air'||n.name==='cave_air');});
    if(!exposed)continue;
    ores.push({x:p.x,y:p.y,z:p.z,name:block.name});if(ores.length>=cap)break;
  }
  return {ok:true,action:'exposedOres',ores,searched:distance,note:'只列已加载且邻接空气的矿石；可能被遮挡，未找到不代表没有，采挖前检查工具、支撑和返程。'};
}
