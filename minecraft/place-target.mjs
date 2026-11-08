const DIRS={up:[0,1,0],down:[0,-1,0],north:[0,0,-1],south:[0,0,1],east:[1,0,0],west:[-1,0,0]};
export async function placeAtTarget(bot,target,{item,face,metadata}={}) {
  const existing=bot.blockAt(target);
  if(!existing)return {ok:false,reason:'目标未加载',target};
  const wanted=item ? String(item).trim() : '';
  if(metadata!==undefined&&(!Number.isInteger(metadata)||metadata<0||metadata>15))return {ok:false,reason:'方块变种无效',target};
  const stack=bot.inventory.items().find(i=>(wanted?i.name===wanted:/^(dirt|cobblestone|planks|sand|stone|log|wooden_slab)$/.test(i.name))&&(metadata===undefined||(i.metadata??0)===metadata));
  if(!stack)return {ok:false,reason:wanted?'背包中没有指定物品':'背包中没有可用方块',target};
  const expected=bot.registry.blocksByName[stack.name];
  if(!expected)return {ok:false,reason:'无法确认物品对应的方块，请换用已知方块',item:stack.name,target};
  if(existing.type===expected.id&&(metadata===undefined||existing.metadata===metadata))return {ok:true,already:true,item:stack.name,target,actual:existing.name,metadata:existing.metadata??null};
  if(!['air','cave_air','void_air'].includes(existing.name))return {ok:false,reason:'目标位置已被占据',actual:existing.name,target};
  const eye=bot.entity.position.offset(0,bot.entity.height || 1.62,0);
  if(eye.distanceTo(target.offset(0.5,0.5,0.5))>4.5)return {ok:false,reason:'目标距离太远，请先走近',target};
  if(face && !DIRS[face])return {ok:false,reason:'无效的放置面',target};
  const directions=face?[DIRS[face]]:Object.values(DIRS);
  let reference=null,vector=null;
  for(const [x,y,z] of directions){
    const p=target.offset(-x,-y,-z),b=bot.blockAt(p);
    if(b && b.boundingBox==='block' && !['water','flowing_water','lava','flowing_lava'].includes(b.name)){
      reference=b;vector=target.minus(p);break;
    }
  }
  if(!reference)return {ok:false,reason:'目标没有相邻的可用支撑方块，未放置',target};
  try{await bot.equip(stack,'hand');await bot.placeBlock(reference,vector);}catch(e){return {ok:false,reason:'服务端未确认放置：'+String(e.message||e),target};}
  const after=bot.blockAt(target);
  if(!after||after.type!==expected.id||(metadata!==undefined&&after.metadata!==metadata))return {ok:false,reason:'放置后未能确认对应方块和状态',target,actual:after?.name||null,actualMetadata:after?.metadata??null};
  return {ok:true,action:'place',item:stack.name,target,actual:after.name,metadata:after.metadata??null};
}
