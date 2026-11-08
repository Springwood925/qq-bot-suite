// Read-only, bounded local view. Unknown blocks remain unknown, never air.
export function inspectVolume(bot, center, {radius=2, height=5, makePos}={}) {
  if (!bot?.entity?.position || typeof makePos !== 'function') return {ok:false,error:'position unavailable'};
  if (!center || !['x','y','z'].every(k=>Number.isInteger(center[k]))) return {ok:false,error:'integer coordinates required'};
  const p=bot.entity.position;
  if (Math.hypot(center.x-p.x,center.y-p.y,center.z-p.z)>8) return {ok:false,error:'center too far'};
  const r=Math.max(0,Math.min(2,Math.floor(Number(radius)||0))),h=Math.max(1,Math.min(7,Math.floor(Number(height)||1)));
  const blocks=[];
  for(let y=center.y;y<center.y+h;y++) for(let z=center.z-r;z<=center.z+r;z++) for(let x=center.x-r;x<=center.x+r;x++) {
    const b=bot.blockAt(makePos(x,y,z),false);
    let properties={};try{
      const raw=b?.getProperties?.()||{};
      for(const key of ['open','powered','half','facing'])if(raw[key]!==undefined)properties[key]=raw[key];
      // Legacy doors store open/facing in the bottom block and hinge in the top.
      if(/^1\.12(?:\.|$)/.test(String(bot.version||'')) && /^(?:wooden|spruce|birch|jungle|acacia|dark_oak|iron)_door$/.test(String(b?.name||'')) && Number.isInteger(b.metadata)){
        const top=!!(b.metadata&8),lower=top?bot.blockAt(makePos(x,y-1,z),false):b,upper=top?b:bot.blockAt(makePos(x,y+1,z),false);
        if(lower?.name===b.name&&upper?.name===b.name&&Number.isInteger(lower.metadata)&&Number.isInteger(upper.metadata)&&!(lower.metadata&8)&&(upper.metadata&8)){
          const lp=lower.getProperties?.()||{},up=upper.getProperties?.()||{};
          properties={half:top?'upper':'lower',open:!!(lower.metadata&4),...(lp.facing?{facing:lp.facing}:{}),...(up.hinge?{hinge:up.hinge}:{}),powered:!!(upper.metadata&2)};
        }else{properties={half:top?'upper':'lower',stateKnown:false};}
      }
    }catch{}
    blocks.push({x,y,z,name:b?.name ?? null,solid:b ? b.boundingBox==='block' : null,metadata:b?.metadata??null,...Object.keys(properties).length?{properties}:{}});
  }
  return {ok:true,action:'inspectVolume',center,radius:r,height:h,blocks,note:'只读快照；null 为未加载，不是空气。solid 是方块碰撞标记，不保证可通行。'};
}
