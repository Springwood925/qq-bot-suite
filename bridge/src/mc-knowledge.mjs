import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mc-knowledge.json');
// Knowledge is read on each turn, so it can be updated without restarting the bridge.
export function selectMcKnowledge({snapshot={}, previous=null, queryText='', fallback=true, file=defaultFile, maxTopics=4, maxChars=4600}={}) {
  let book;
  try { book=JSON.parse(fs.readFileSync(file,'utf8')); } catch { return ''; }
  if (!Array.isArray(book.topics)) return '';
  const query=[queryText,previous?.goal,previous?.next,previous?.outcome,previous?.progress,snapshot?.dimension,snapshot?.companionActivity?.activity].filter(Boolean).join(' ').toLowerCase();
  const topics=book.topics.map((t,index)=>({t,index,score:(t.keywords||[]).reduce((sum,k)=>sum+(query.includes(String(k).toLowerCase())?1:0),0)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score || a.index-b.index);
  if(!topics.length && fallback){const first=book.topics.find(t=>t.id==='first_day');if(first)topics.push({t:first,score:1,index:0});}
  if(!topics.length)return '';
  let text='【Minecraft 知识参考：'+String(book.version||'版本未知')+'】\n'+String(book.baseline||'');
  let count=0;
  for(const {t} of topics){const line='\n['+String(t.id)+'] '+String(t.text||'');if(count>=maxTopics || text.length+line.length>maxChars)continue;text+=line;count++;}
  return text;
}
