// Only the owner's own private conversation is passed in by the caller.
export function ownerDialogue(messages,{owner,now=Date.now(),maxAgeMs=20*60*1000,limit=8,isSensitive=()=>false,sanitize=x=>x}={}) {
  const id=String(owner||''); if(!/^\d+$/.test(id)||!Array.isArray(messages))return [];
  return messages.filter(m=>{
    const time=Number(m?.time), text=String(m?.plain||m?.text||'').trim();
    return (m?.isSelf===true||String(m?.userId||'')===id)&&Number.isFinite(time)&&time<=now+60000&&now-time<=maxAgeMs&&text&&!isSensitive(text);
  }).slice(-limit).map(m=>({speaker:m.isSelf?'小鲸鲸':'主人',time:Number(m.time),text:String(sanitize(String(m.plain||m.text))).slice(0,180)})).filter(m=>m.text);
}
