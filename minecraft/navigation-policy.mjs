export function applySafeNavigation(moves) {
  moves.allowSprinting=false;
  moves.canDig=false;
  moves.allow1by1towers=false;
  moves.scafoldingBlocks=[];
  // Mineflayer measures from feet to the landing support block: 2 means
  // one block of actual foot-level descent, not two.
  moves.maxDropDown=2;
  moves.infiniteLiquidDropdownDistance=false;
  // Pathfinder 1.12 marks even an open door as a full blocking block.
  // Treat only verified-open vanilla wooden doors as traversable; closed,
  // iron, unknown and unloaded doors remain blocked.
  const original=moves.getBlock;
  if(typeof original==='function') moves.getBlock=function(...args){
    const b=original.apply(this,args);
    if(!b||!/^1\.12(?:\.|$)/.test(String(this.bot?.version||''))||! /^(?:wooden|spruce|birch|jungle|acacia|dark_oak)_door$/.test(String(b.name||'')))return b;
    let lower=b;
    if(Number.isInteger(b.metadata)&&(b.metadata&8)){
      if(typeof b.position?.offset!=='function')return b;
      lower=this.bot.blockAt(b.position.offset(0,-1,0),false);
      if(!lower||lower.name!==b.name)return b;
    }
    if(Number.isInteger(lower.metadata)&&!(lower.metadata&8)&&(lower.metadata&4)){b.safe=true;b.physical=false;}
    return b;
  };
  return moves;
}
