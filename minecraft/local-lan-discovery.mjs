import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {currentLocalWorld} from './forge-item-lookup.mjs';

export function portsForProcesses(netstat,pids) {
 const allowed=new Set(pids.map(Number).filter(Number.isInteger)),ports=new Set();
 for(const line of String(netstat).split(/\r?\n/)){
  const m=line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
  if(m && allowed.has(Number(m[2]))){const port=Number(m[1]);if(port>0&&port<=65535)ports.add(port);}
 }
 return [...ports];
}
export async function pickUniqueMinecraftPort(ports,ping) {
 const matches=[];
 for(const port of ports){try{const result=await ping(port);if(Number(result?.version?.protocol)===340)matches.push(port)}catch{}}
 return matches.length===1?matches[0]:null;
}
// The game rotates latest.log at midnight while the same world keeps running.
// Only join the archive created alongside this latest.log, never an older session.
export async function localWorldFromLogs(gameDir) {
 const dir=path.join(gameDir,'logs'),latestPath=path.join(dir,'latest.log');
 const latest=await fs.readFile(latestPath,'utf8');
 const world=currentLocalWorld(latest);
 if(world || latest.includes('Starting integrated minecraft server')) return world;
 const latestStat=await fs.stat(latestPath);
 const files=(await fs.readdir(dir)).filter(n=>/^\d{4}-\d{2}-\d{2}-\d+\.log\.gz$/.test(n));
 const archives=await Promise.all(files.map(async n=>({n,stat:await fs.stat(path.join(dir,n))})));
 const candidates=archives.filter(v=>Math.abs(v.stat.birthtimeMs-latestStat.birthtimeMs)<10000).sort((a,b)=>b.stat.birthtimeMs-a.stat.birthtimeMs);
 if(candidates.length!==1)return null;
 const prior=gunzipSync(await fs.readFile(path.join(dir,candidates[0].n))).toString('utf8');
 return currentLocalWorld(prior+'\n'+latest);
}
export async function discoverLocalLan({gameDir,world,exec=promisify(execFileCallback),readFile=fs.readFile,ping}) {
 if(process.platform!=='win32' || !gameDir || !world || typeof ping!=='function')return null;
 try {
  const observed=readFile===fs.readFile ? await localWorldFromLogs(gameDir) : currentLocalWorld(await readFile(path.join(gameDir,'logs','latest.log'),'utf8'));
  if(observed!==world)return null;
  const encodedDir=Buffer.from(gameDir,'utf8').toString('base64');
  const script=`$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedDir}')).Replace([char]92,'/').ToLowerInvariant(); Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^javaw?\\.exe$' -and $_.CommandLine -and $_.CommandLine.Replace([char]92,'/').ToLowerInvariant().Contains($d) -and $_.CommandLine.Contains('net.minecraft.launchwrapper.Launch') } | ForEach-Object { $_.ProcessId }`;
  const cmd=Buffer.from(script,'utf16le').toString('base64');
  const p=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',cmd],{timeout:10000,windowsHide:true});
  const pids=String(p.stdout).split(/\s+/).filter(s=>/^\d+$/.test(s)).map(Number);
  if(!pids.length)return null;
  const n=await exec('netstat.exe',['-ano','-p','tcp'],{timeout:10000,windowsHide:true});
  return await pickUniqueMinecraftPort(portsForProcesses(n.stdout,pids),ping);
 } catch {return null;}
}
