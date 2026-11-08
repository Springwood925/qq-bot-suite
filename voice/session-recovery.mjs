import fs from 'node:fs';
import path from 'node:path';

export function readSessionCandidates(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    try { const entry=JSON.parse(line); return typeof entry.sessionId==='string'&&entry.sessionId ? [entry] : []; }
    catch { return []; }
  });
}

export function findResumableSession(records, items, root) {
  const normalize=p=>path.resolve(String(p||'')).replace(/\\/g,'/').toLowerCase();
  const target=normalize(root);
  const sessions=new Map(items.filter(x=>x?.sessionId).map(x=>[x.sessionId,x]));
  for(const record of [...records].reverse()) {
    const item=sessions.get(record.sessionId);
    if(item && item.cwd && normalize(item.cwd)===target && item.agentAvailable!==false && !item.parentSessionId && item.origin!=='subagent') return record.sessionId;
  }
  return null;
}
