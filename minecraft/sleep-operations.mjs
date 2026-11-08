export async function sleepOnBed(bot,bed) {
  if (!bed || !/(^|_)bed$/.test(String(bed.name))) return {ok:false,error:'目标不是床'};
  const dimension=String(bot.game?.dimension || '').toLowerCase();
  if (!['overworld','minecraft:overworld'].includes(dimension)) return {ok:false,error:'仅在确认主世界时使用床'};
  if (bot.isSleeping) return {ok:true,action:'sleep',already:true,sleeping:true};
  try {
    await bot.sleep(bed);
    if (!bot.isSleeping) return {ok:false,error:'服务器尚未确认睡眠',sleeping:false};
    return {ok:true,action:'sleep',sleeping:true};
  } catch(e) {return {ok:false,error:'未能睡觉：'+String(e?.message||e),sleeping:!!bot.isSleeping};}
}

export async function wakeFromBed(bot,timeoutMs=3000) {
  if (!bot.isSleeping) return {ok:true,action:'wake',already:true,sleeping:false};
  return await new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);bot.removeListener('wake',onWake);resolve(bot.isSleeping?{ok:false,error:'服务器尚未确认起床',sleeping:true}:{ok:true,action:'wake',sleeping:false});};
    const onWake=()=>finish();
    const timer=setTimeout(finish,timeoutMs);
    bot.once('wake',onWake);
    Promise.resolve().then(()=>bot.wake()).catch(e=>{if(done)return;done=true;clearTimeout(timer);bot.removeListener('wake',onWake);resolve({ok:false,error:'未能起床：'+String(e?.message||e),sleeping:!!bot.isSleeping});});
  });
}
