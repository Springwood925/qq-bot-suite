// Collision-free decorations such as torches do not obstruct a room. Fluids
// and fire remain unsafe to treat as clear even if their collision box is empty.
function passableInterior(b) {
  return !!b && (['air','cave_air','void_air'].includes(b.name) ||
    (b.boundingBox==='empty' && !/^(?:water|flowing_water|lava|flowing_lava|fire)$/.test(b.name)));
}
// Conservative geometric inspection; a passed check is not a visual or safety guarantee.
export function inspectHouse(bot, origin, {width,depth,height}={}) {
  if(![width,depth,height].every(Number.isInteger)||width<3||depth<3||height<2||width>16||depth>16||height>8) throw Error('房屋宽深须为 3–16，高为 2–8 的整数');
  const read=(x,y,z)=>bot.blockAt(origin.offset(x,y,z));
  const passable=passableInterior;
  const solid=b=>b && b.boundingBox==='block';
  const door=b=>b && /(?:^|_)door$/.test(b.name);
  let unknown=0,roofMissing=0,wallGaps=0,groundWallGaps=0,wallCells=0,insideBlocked=0,doorways=0;
  const interiorExamples=[],doorCells=[];
  for(let x=0;x<width;x++)for(let z=0;z<depth;z++){
    const roof=read(x,height,z); if(!roof)unknown++;else if(!solid(roof))roofMissing++;
    const edge=x===0||z===0||x===width-1||z===depth-1;
    if(edge){
      const low=read(x,0,z),high=read(x,1,z),ground=read(x,-1,z);
      if(low&&high&&ground&&solid(ground)&&((passable(low)&&passable(high))||(door(low)&&door(high)))){doorways++;doorCells.push({x,z});}
      for(let y=0;y<height;y++){wallCells++;const b=read(x,y,z);if(!b)unknown++;else if(!solid(b)&&!door(b)){wallGaps++;if(y===0)groundWallGaps++;}}
    }else{
      for(let y=0;y<Math.min(height,2);y++){const b=read(x,y,z);if(!b)unknown++;else if(!passable(b)){insideBlocked++;if(interiorExamples.length<12)interiorExamples.push({x:origin.x+x,y:origin.y+y,z:origin.z+z,block:b.name});}}
    }
  }
  // Check two-high, supported interior cells and their 4-neighbour connection
  // to an entrance. Furniture can occupy space without making a house invalid.
  const open=new Set(),visited=new Set(),queue=[];
  for(let x=1;x<width-1;x++)for(let z=1;z<depth-1;z++) {
    if(passable(read(x,0,z))&&passable(read(x,1,z))&&solid(read(x,-1,z)))open.add(`${x},${z}`);
  }
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(const d of doorCells)for(const [dx,dz] of dirs){const x=d.x+dx,z=d.z+dz,k=`${x},${z}`;if(open.has(k)&&!visited.has(k)){visited.add(k);queue.push({x,z});}}
  for(let i=0;i<queue.length;i++)for(const [dx,dz] of dirs){const x=queue[i].x+dx,z=queue[i].z+dz,k=`${x},${z}`;if(open.has(k)&&!visited.has(k)){visited.add(k);queue.push({x,z});}}
  const issues=[];
  if(unknown)issues.push(`有 ${unknown} 格未加载`);
  if(roofMissing)issues.push(`屋顶缺 ${roofMissing} 格`);
  if(!doorways)issues.push('没有识别到两格高的入口');
  if(groundWallGaps>doorways)issues.push(`墙体底层有 ${groundWallGaps-doorways} 格非入口空缺`);
  if(wallCells && (wallCells-wallGaps)/wallCells < 0.7)issues.push(`墙体覆盖不足（共 ${wallGaps} 格空缺）`);
  if(doorways && !visited.size)issues.push('入口没有连接到两格高、脚下有支撑的室内空间');
  if(visited.size && visited.size<open.size)issues.push(`有 ${open.size-visited.size} 格室内空间与入口不连通`);
  return {complete:issues.length===0,origin:{x:origin.x,y:origin.y,z:origin.z},size:{width,depth,height},roofMissing,wallGaps,doorways,insideBlocked,interiorExamples,interiorWalkable:open.size,interiorReachable:visited.size,unknown,issues,note:'仅检查基础结构和二维通路，不保证实际寻路、照明或安全；家具占格不等于堵塞，不应自动拆除。'};
}

export function planHouse(bot, origin, {width,depth,height,material='planks'}={}) {
 if(![width,depth,height].every(Number.isInteger)||width<3||depth<3||height<2||width>12||depth>12||height>6) throw Error('蓝图宽深须为 3–12，高为 2–6 的整数');
 const doorX=Math.floor(width/2), cells=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let z=0;z<depth;z++){
  if(!(x===0||z===0||x===width-1||z===depth-1))continue;
  if(z===0&&x===doorX&&y<2)continue;
  cells.push({x:origin.x+x,y:origin.y+y,z:origin.z+z,kind:'wall'});
 }
 for(let x=0;x<width;x++)for(let z=0;z<depth;z++)cells.push({x:origin.x+x,y:origin.y+height,z:origin.z+z,kind:'roof'});
 const missing=[],obstacles=[],unknown=[];let already=0;
 for(const cell of cells){const b=bot.blockAt(origin.offset(cell.x-origin.x,cell.y-origin.y,cell.z-origin.z));if(!b)unknown.push(cell);else if(b.name===material)already++;else if(['air','cave_air','void_air'].includes(b.name))missing.push(cell);else obstacles.push({...cell,block:b.name});}
 let interiorBlocked=0,interiorUnknown=0;const interiorExamples=[];
 for(let x=1;x<width-1;x++)for(let z=1;z<depth-1;z++)for(let y=0;y<Math.min(2,height);y++){
  const b=bot.blockAt(origin.offset(x,y,z));if(!b)interiorUnknown++;else if(!passableInterior(b)){interiorBlocked++;if(interiorExamples.length<12)interiorExamples.push({x:origin.x+x,y:origin.y+y,z:origin.z+z,block:b.name});}
 }
 return {action:'housePlan',origin:{x:origin.x,y:origin.y,z:origin.z},size:{width,depth,height},material,entrance:{x:origin.x+doorX,y:origin.y,z:origin.z},required:cells.length,already,missing:missing.length,obstacles:obstacles.length,unknown:unknown.length,interiorBlocked,interiorUnknown,interiorExamples,next:missing.slice(0,20),obstacleExamples:obstacles.slice(0,8),note:'北面留两格入口；先检查屋内占用物和材料，按情况商量处理，再逐层建墙及屋顶。这里仅规划，不会放置或拆除方块。'};
}
