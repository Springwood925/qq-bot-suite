import fs from 'node:fs';

export async function transcribeLocal({wav,whisper,model,run,signal,script=process.env.CALL_ASR_SCRIPT || ''}) {
  if(script && fs.existsSync(script)){
    try{
      const result=await run('python',[script,wav],{timeout:45000,windowsHide:true,maxBuffer:2*1024*1024,signal,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
      return String(result.stdout||'').trim();
    }catch(error){
      if(signal?.aborted||error?.name==='AbortError')throw error;
      console.warn('本地 SenseVoice 不可用，回退 Whisper');
    }
  }
  const result=await run(whisper.cli,['-m',model,'-f',wav,'-l',whisper.language||'zh','-nt','--no-prints'],{timeout:whisper.timeoutMs||90000,windowsHide:true,maxBuffer:8*1024*1024,signal});
  return String(result.stdout||'').split(/\r?\n/).map(s=>s.replace(/^\[[\d:.\s>-]+\]\s*/,'').trim()).filter(Boolean).join(' ');
}
