// Only the owner receives this game-specific context. It is a record, not a
// claim that the world is currently unchanged.
export function knownMine(record) {
  const p=record?.mineEntrance;
  if(!p||!['x','y','z'].every(k=>Number.isInteger(p[k]))||typeof record.world!=='string'||!record.world.trim())return null;
  const route=Array.isArray(record.mineRoute)?record.mineRoute.filter(v=>v && ['x','y','z'].every(k=>Number.isInteger(v[k]))).slice(0,12).map(v=>({x:v.x,y:v.y,z:v.z,...(typeof v.note==='string'?{note:v.note.slice(0,100)}:{})})):[];
  return {world:record.world.slice(0,40),entrance:{x:p.x,y:p.y,z:p.z},...(route.length?{route}:{}),note:'历史记录，世界或入口可能变化；先检查地形与可达性。'};
}
export function sharedMcContext({key,owner,enabled,home,record,plan,now=Date.now()}) {
  if (!enabled || key!=='private:'+String(owner || '')) return '';
  const valid=p=>p && ['x','y','z'].every(k=>Number.isInteger(p[k]));
  if (!valid(home)) return '';
  const same=valid(record?.home) && ['x','y','z'].every(k=>record.home[k]===home[k]);
  const lines=['【Minecraft 游戏记录：仅供与主人聊游戏时参考】',`当前保存的回家点：(${home.x},${home.y},${home.z})。`];
  if (same && typeof record.world==='string' && valid(record.houseOrigin)) {
    const p=record.houseOrigin;
    lines.push(`此前在${record.world.slice(0,40)}，小鲸鲸建过小屋，房屋原点 (${p.x},${p.y},${p.z})；主人已指定这间小屋为共同的家。`);
    lines.push('这是已记录的历史和约定；现状可能改变，需时使用 status/scan 核实。不能仅因为当前位置看不到就说没建过或重新建造。');
  } else lines.push('具体房屋和世界尚未确认，不能仅凭回家点推测。');
  const mine=same?knownMine(record):null;
  if(mine)lines.push(`已记录的旧矿道入口：${mine.world} (${mine.entrance.x},${mine.entrance.y},${mine.entrance.z})；${mine.note}主人提到旧矿道时，先核实已有入口，不要默认另开新矿。`);
  const age=now-Number(plan?.updatedAt);
  if(Number.isFinite(age) && age>=0 && age<7200000 && typeof plan?.goal==='string')
    lines.push('最近自主目标（可能过时）：'+plan.goal.slice(0,160));
  return lines.join('\n')+'\n\n';
}
