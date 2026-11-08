export function gotoResult({target,range,pathfinderOk,before,after}) {
 const valid=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
 if(!valid(target)||!valid(after))return {ok:false,action:'goto',error:'无法核实实际位置',target,before:before||null,after:after||null};
 const requested=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(target[k])]));
 const actual=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(after[k])]));
 const squared=['x','y','z'].reduce((n,k)=>n+(actual[k]-requested[k])**2,0);
 const reached=squared<=range*range;
 const moved=valid(before)?Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z):null;
 return {ok:!!pathfinderOk&&reached,action:'goto',target:requested,range,position:after,blockPosition:actual,reached,exact:squared===0,movedDistance:moved===null?null:Math.round(moved*100)/100,note:reached?(squared===0?'已核实处于目标格。':'只到目标附近，未进入目标格。'):'没有核实到达指定范围，按实际位置继续判断。'};
}
