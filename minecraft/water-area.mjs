export function inspectWaterArea(bot,center,radius=5) {
 const r=Math.max(1,Math.min(8,Math.floor(Number(radius)||5)));
 let water=0,surface=0,unknown=0;const samples=[];
 for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
  const pos=center.offset(dx,0,dz),b=bot.blockAt(pos),above=bot.blockAt(pos.offset(0,1,0));
  if(!b||!above){unknown++;continue;}
  if(['water','flowing_water'].includes(b.name)){
   water++;
   if(['air','cave_air','void_air'].includes(above.name)){surface++;if(samples.length<12)samples.push({x:pos.x,y:pos.y,z:pos.z});}
  }
 }
 return {ok:true,action:'waterArea',center:{x:center.x,y:center.y,z:center.z},radius:r,waterAtLevel:water,openSurface:surface,unknown,samples,note:'只统计此高度和范围内已加载的方块；未统计到不代表周围没有水。钓鱼超时不能单独证明水域太小。'};
}
