// 常驻 Minecraft bot：跟随 + 听指令 + 自主探索 + 本地 HTTP 接口
// 启动：node bot.mjs
// 游戏内指令：!follow !stop !come !status !say !goto !home !auto !idle
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActions } from './actions.mjs';
import { createAutonomy } from './autonomy.mjs';
import { createWatchdog } from './watchdog.mjs';
import { createServer } from './server.mjs';
import { createCompanionObserver } from './companion-observer.mjs';
import { createCompanionPlay } from './companion-play.mjs';
import forgeProtocol from 'minecraft-protocol-forge';
import minecraftProtocol from 'minecraft-protocol';
import {discoverLocalLan} from './local-lan-discovery.mjs';
import {createSwimRescue} from './swim-rescue.mjs';
import {applySafeNavigation} from './navigation-policy.mjs';
import {installLegacyDoorView} from './legacy-door-view.mjs';

const { pathfinder, Movements } = pathfinderPkg;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.resolve(process.env.QQ_BRIDGE_DIR || path.join(ROOT, '..', 'bridge'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OWNER = cfg.owner || 'Player';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let bot = null;
let actions = null;
let auto = null;
let watchdog = null;
let companionObserver = null;
let companionPlay = null;
let swimRescue = null;
let manualSelfPlay = null;
try {const value=JSON.parse(fs.readFileSync(path.join(BRIDGE_DIR,'state','mc-self-play.json'),'utf8'));if(typeof value?.manual==='boolean')manualSelfPlay=value.manual;} catch {}
let companionWanted = cfg.companionPlay?.enabled === true && manualSelfPlay !== false;
let bridgeToken = '';
try { bridgeToken = fs.readFileSync(path.join(BRIDGE_DIR,'state','console-token'), 'utf8').trim(); } catch {}
let reconnectTimer = null;
let discovering = false;
let lastDiscoveryMessage = '';
let stopping = false;
let followOwner = cfg.autoFollow !== false && manualSelfPlay !== false;
const state = { online: false, owner: OWNER, since: null, lastError: null };

const api = createServer({
  getState: () => state,
  getActions: () => actions ? { ...actions, status: () => ({ ...actions.status(), companionActivity: companionObserver?.status() || null }) } : { status: () => ({ online: false }) },
  getAutonomy: () => auto,
  getCompanionPlay: () => companionPlay && {status:companionPlay.status,start:()=>{companionWanted=true;companionPlay.start();},stop:()=>{companionWanted=false;companionPlay.stop();}},
  forgeGameDirectory: ['127.0.0.1','localhost','::1'].includes(cfg.host) && cfg.forge?.enabled ? cfg.forge?.localGameDir : null,
  log,
});
api.setBot({ chat: (t) => say(t) });

function scheduleReconnect(ms=8000) {
  if (stopping || reconnectTimer) return;
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;void connect();},ms);
}
async function connect() {
  if (stopping || discovering) return;
  if (cfg.forge?.localGameDir && cfg.forge?.localWorldName && ['127.0.0.1','localhost','::1'].includes(cfg.host)) {
    discovering=true;
    let port=null;
    try {port=await discoverLocalLan({gameDir:cfg.forge.localGameDir,world:cfg.forge.localWorldName,ping:p=>minecraftProtocol.ping({host:'127.0.0.1',port:p,version:cfg.version,closeTimeout:2500,noPongTimeout:1500})});}
    finally {discovering=false;}
    if(stopping)return;
    if(!port){
      if(lastDiscoveryMessage!=='waiting')log('等待指定测试世界开放局域网，未找到唯一端口');
      lastDiscoveryMessage='waiting';state.lastError='等待指定世界开放局域网';scheduleReconnect(15000);return;
    }
    if(Number(cfg.port)!==port)log(`发现测试世界的新端口 ${port}`);
    cfg.port=port;lastDiscoveryMessage='';
  }
  log(`连接 ${cfg.host}:${cfg.port} (${cfg.version}) 用户名=${cfg.username}`);
  try {bot = mineflayer.createBot({
    host: cfg.host, port: Number(cfg.port), username: cfg.username,
    version: cfg.forge?.enabled ? false : cfg.version, auth: cfg.auth || 'offline', hideErrors: false,
  });} catch(e) {state.lastError=String(e?.message||e);log('连接启动失败:',state.lastError);scheduleReconnect();return;}
  if (cfg.forge?.enabled) {
    forgeProtocol.autoVersionForge(bot._client);
    log('Forge 自动检测已启用：握手通过不代表所有模组机制可用');
  }
  api.setBot(bot);
  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    try { installLegacyDoorView(bot); } catch (e) { log('门碰撞视图未启用：'+String(e?.message||e)); }
    swimRescue=createSwimRescue(bot,{log});bot.swimRescue=swimRescue;
    const moves = applySafeNavigation(new Movements(bot));
    // 寻路不能为了跟随或移动擅自拆方块、搭脚手架。
    moves.canDig = false;
    moves.allow1by1towers = false;
    moves.scafoldingBlocks = [];
    bot.pathfinder.setMovements(moves);

    actions = createActions(bot, log);
    companionObserver = createCompanionObserver(bot, OWNER, { onActivity: activity => watchdog?.companionActivity(activity) });
    auto = createAutonomy(bot, actions, log, cfg.autonomy || {});
    api.setAutonomy(auto);
    state.online = true;
    state.since = Date.now();
    state.lastError = null;
    startHeartbeat();   // 告诉桥"我在打游戏"

    const st = actions.status();
    log('✅ 已进入世界', JSON.stringify(st.pos), st.dimension, st.mode);
    log(`周围玩家: ${st.players.join(', ') || '(没有)'}`);
    say(`我进来了 在 ${st.pos.x} ${st.pos.y} ${st.pos.z}`);

    if (followOwner) actions.follow(OWNER);
    // 创造模式先塞点方块，不然想搭也没材料（失败不影响启动：setInventorySlot 可能超时）
    if (bot.game.gameMode === 'creative' && typeof bot.creative?.setInventorySlot === 'function') {
      void (async () => {
        let ok = 0;
        for (const [name, count] of [['dirt', 64], ['cobblestone', 64], ['oak_planks', 64]]) {
          const it = bot.registry.itemsByName[name];
          if (!it) continue;
          try {
            await Promise.race([
              bot.creative.setInventorySlot(36 + ok, { name: it.name, count }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
            ]);
            ok++;
          } catch (e) {
            log(`给 ${name} 失败（${e.message}），跳过`);
          }
        }
        if (ok) log(`给了 ${ok} 组方块（创造模式）`);
      })();
    }
    // 看门狗：事件驱动唤醒（替代 60 秒定时 tick）
    watchdog = createWatchdog(bot, {
      log,
      onWake: async (payload) => {
        if (!bridgeToken) throw Error('没有桥的 console-token');
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await fetch('http://127.0.0.1:3100/api/mc/event?token=' + encodeURIComponent(bridgeToken), {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
          });
          const result = await r.json();
          if (!r.ok || result.ok === false) throw Error(result.error || `HTTP ${r.status}`);
          if (result.skipped !== 'throttled') return;
          if (attempt || !payload.reasons?.includes('companionActivity')) throw Error('游戏事件被节流');
          const delay = Math.min(21000, Math.max(1000, 21000 - Number(result.sinceMs || 0)));
          await new Promise(resolve => setTimeout(resolve, delay));
          if (!state.online) throw Error('游戏已断开，取消待发送事件');
        }
      },
    });
    watchdog.arm();
    api.setWatchdog(watchdog);
    companionPlay = createCompanionPlay({bot, actions, owner:OWNER, log, intervalMs:cfg.companionPlay?.intervalMs || 90000});
    if (companionWanted) companionPlay.start();
    if (cfg.autonomy?.autoStart !== false) auto.start();
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return;
    const text = String(message || '').trim();
    if (!text.startsWith('!')) { log(`💬 <${username}> ${text}`); return; }
    log(`🎮 <${username}> ${text}`);
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    if (['follow','stop','停','come','来','auto','逛','idle','回','goto'].includes(cmd.toLowerCase())) {companionWanted=false; companionPlay?.stop();}
    if (['stop','停','idle','回'].includes(cmd.toLowerCase()) && bridgeToken) {
      try { await fetch('http://127.0.0.1:3100/api/mc/self-play?token='+encodeURIComponent(bridgeToken), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on:false}),signal:AbortSignal.timeout(5000)}); }
      catch (e) { log('停止游戏规划失败:', e.message); }
    }
    if (['play','auto','逛'].includes(cmd.toLowerCase()) && bridgeToken) {
      try { await fetch('http://127.0.0.1:3100/api/mc/self-play?token='+encodeURIComponent(bridgeToken), {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on:true}),signal:AbortSignal.timeout(5000)}); }
      catch (e) { log('启动游戏规划失败:', e.message); }
    }
    try {
      switch (cmd.toLowerCase()) {
        case 'play': auto?.stop(); companionWanted=true; companionPlay?.start(); say('我在你附近探索'); break;
        case 'follow': followOwner = true; actions.follow(arg || username); say(`跟着 ${arg || username}`); break;
        case 'stop': case '停': followOwner = false; actions.stopFollow(); say('停了'); break;
        case 'come': case '来': say('来了'); await actions.gotoPlayer(arg || username, 2); break;
        case 'status': case '状态': say(JSON.stringify({ ...actions.status(), auto: auto.status() })); break;
        case 'look': case '看': actions.lookAt(arg || username); break;
        case 'say': say(arg); break;
        case 'home': case '家': { const h = auto.setHome(); say(h ? `家记在 ${h.x} ${h.y} ${h.z}` : '没记住'); break; }
        case 'watch': { const s = watchdog ? watchdog.status() : null; say(JSON.stringify(s ? { armed: s.armed, fired: s.stats.fired, recent: s.recent.slice(-3).map(r => r.text) } : null)); break; }
        case 'auto': case '逛': auto?.stop(); companionWanted=true; companionPlay?.start(); say('我在你附近探索'); break;
        case 'idle': case '回': auto.stop(); actions.stopFollow(); followOwner = false; say('我待着不动'); break;
        case 'goto':
          if (rest.length === 3) { say('走'); await actions.gotoXYZ(Number(rest[0]), Number(rest[1]), Number(rest[2])); say('到了'); }
          else say('用法 !goto x y z');
          break;
        default: say('指令有 !follow !stop !come !status !say !home !auto !idle !goto');
      }
    } catch (e) { log('指令执行失败:', e.message); say('刚才那条没做成'); }
  });

  bot.on('playerJoined', (p) => { if (p.username !== bot.username) log(`👋 ${p.username} 进来了`); });
  bot.on('playerLeft', (p) => { if (p.username !== bot.username) log(`👋 ${p.username} 走了`); });
  bot.on('death', () => { log('💀 我死了'); say('我死了'); });
  bot.on('kicked', (r) => { state.lastError = 'kicked: ' + JSON.stringify(r).slice(0, 200); log('🚫 被踢:', state.lastError); });
  bot.on('error', (e) => { state.lastError = e && e.message ? e.message : String(e); log('❌ 错误:', state.lastError); });
  bot.on('end', (reason) => {
    swimRescue?.close();swimRescue=null;
    companionPlay?.stop(); companionPlay = null;
    companionObserver?.close(); companionObserver = null;
    state.online = false;
    void sendHeartbeat();
    log('连接结束:', reason);
    if (stopping || reconnectTimer) return;
    log('8 秒后重连…');
    scheduleReconnect();
  });
}

function say(text) {
  try { if (bot) bot.chat(String(text).slice(0, 250)); } catch {}
}

// ── 心跳：每 30 秒告诉桥"我在打游戏" ──────────────────────────────
let heartbeatTimer = null;
let consoleToken = '';
try { consoleToken = fs.readFileSync(path.join(BRIDGE_DIR,'state','console-token'), 'utf8').trim(); } catch {}

async function sendHeartbeat() {
  if (!consoleToken) return;
  try {
    await fetch('http://127.0.0.1:3100/api/mc/heartbeat?token=' + encodeURIComponent(consoleToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ online: !!state.online, reason: state.online ? 'in-game' : 'offline' }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}
function startHeartbeat() {
  if (heartbeatTimer) return;
  void sendHeartbeat();
  heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, 30000);
}

process.on('SIGINT', () => {
  stopping = true;
  log('收到退出信号');
  try { auto?.stop(); } catch {}
  try { actions?.stopFollow(); } catch {}
  try { bot?.quit(); } catch {}
  setTimeout(() => process.exit(0), 500);
});

// 只有成功占用控制端口的实例才能加入世界；避免重复实例互相踢下线。
api.listen().then(() => connect()).catch((e) => {
  log('HTTP 接口启动失败，机器人不会连接游戏:', e.message);
  process.exitCode = 1;
});
