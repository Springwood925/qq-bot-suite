import path from 'node:path';
import {fileURLToPath} from 'node:url';
// 自主行为：LLM 决策（不用规则引擎）+ 三条底线 + 家保护
// 底线：① 掉血过半回家 ② 离主人超 200 格往回走 ③ 家附近不挖不建
// 决策交给 llm.mjs，这里只负责"收集现场 + 执行模型的决定"
import fs from 'node:fs';
import pathfinderPkg from 'mineflayer-pathfinder';
import { createLlmDecider } from './llm.mjs';
import { createMoveHelper } from './move-helper.mjs';
const { goals } = pathfinderPkg;

const DEFAULTS = {
  enabled: true,
  decideIntervalMs: 60000,   // 每 60 秒问一次模型（别太频繁，省 token）
  maxTripMs: 22000,
  maxDistanceFromOwner: 200,
  healthReturnRatio: 0.5,
  homeSafeRadius: 40,
  allowDig: true,
  allowPlace: true,
  maxDigPerRound: 4,
};

export function createAutonomy(bot, actions, log = console.log, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let running = false;
  let timer = null;
  let home = null;
  let returning = false;
  let llm = null;
  let lastAction = null;
  let sameActionTimes = 0;
  const stats = { rounds: 0, dug: 0, placed: 0, llmCalls: 0 };
  let moveHelper = null;

  const pos = () => bot.entity && bot.entity.position;
  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

  const HOME_FILE = opts.homeFile || path.join(path.dirname(fileURLToPath(import.meta.url)),'home.json');
  function loadHome() {
    try { const j = JSON.parse(fs.readFileSync(HOME_FILE, 'utf8')); if (j && Number.isFinite(j.x)) { home = j; return home; } } catch {}
    return null;
  }
  function saveHome() {
    try { fs.writeFileSync(HOME_FILE, JSON.stringify(home, null, 2), 'utf8'); } catch {}
  }

  function setHome(p, { at = 'owner' } = {}) {
    let q = p;
    if (!q && at === 'owner') {
      const ow = ownerPos();
      if (ow) { q = ow.p; log(`用 ${ow.name} 现在站的位置当家`); }
    }
    if (!q) q = pos();
    if (!q) return null;
    home = { x: Math.round(q.x), y: Math.round(q.y), z: Math.round(q.z) };
    log(`家设在这里 ${home.x} ${home.y} ${home.z}`);
    saveHome();
    return home;
  }
  const getHome = () => home;

  function ownerPos() {
    for (const name of Object.keys(bot.players)) {
      if (name === bot.username) continue;
      const e = bot.players[name].entity;
      if (e) return { name, p: e.position };
    }
    return null;
  }

  function nearHome(p, r = cfg.homeSafeRadius) {
    if (!home || !p) return false;
    return dist(p, home) <= r;
  }

  function checkSafety() {
    const me = pos();
    if (!me) return null;
    if (bot.health !== undefined && bot.health !== null && bot.health / 20 <= cfg.healthReturnRatio) {
      const t = home || (ownerPos() && ownerPos().p);
      if (t) { log(`血只剩 ${bot.health}，往回走`); return t; }
    }
    const ow = ownerPos();
    if (ow && dist(me, ow.p) > cfg.maxDistanceFromOwner) {
      log(`离主人 ${Math.round(dist(me, ow.p))} 格，太远了往回走`);
      return ow.p;
    }
    return null;
  }

  async function goHome() {
    const t = home || (ownerPos() && ownerPos().p);
    if (!t) return false;
    returning = true;
    const ok = await actions.gotoXYZ(t.x, t.y, t.z, 2);
    returning = false;
    return ok;
  }

  // 给模型看的现场
  function snapshot() {
    const me = pos();
    const ow = ownerPos();
    const r = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n));
    const inv = bot.inventory.items().slice(0, 8).map((i) => `${i.name}x${i.count}`);
    const entities = Object.values(bot.entities)
      .filter((e) => e !== bot.entity && e.position.distanceTo(me) < 16)
      .slice(0, 8)
      .map((e) => (e.username ? `玩家:${e.username}` : (e.name || e.type)));
    const blocks = [];
    const around = ['log', 'log2', 'stone', 'coal_ore', 'iron_ore', 'tall_grass', 'water', 'lava'];
    for (const n of around) {
      const id = bot.registry.blocksByName[n] && bot.registry.blocksByName[n].id;
      if (id === undefined) continue;
      const f = bot.findBlocks({ matching: id, maxDistance: 24, count: 1 });
      if (f.length) blocks.push(`${n}@${r(me.distanceTo(f[0]))}格`);
    }
    return {
      pos: { x: r(me.x), y: r(me.y), z: r(me.z) },
      health: bot.health,
      food: bot.food,
      mode: bot.game.gameMode,
      inventory: inv.length ? inv : ['空'],
      home,
      owner: ow ? { 名字: ow.name, 距离: r(dist(me, ow.p)) } : null,
      distHome: home ? r(dist(me, home)) : null,
      timeOfDay: bot.time ? Math.round(bot.time.timeOfDay) : null,
      nearby: { 实体: entities, 方块: blocks },
      lastAction,
      sameActionTimes,
    };
  }

  // ── 动作 ────────────────────────────────────────────────────────
  async function goNear(x, y, z, range = 2) {
    const ok = await actions.gotoXYZ(x, y, z, range);
    if (ok) return true;
    // 走不过去 → 让她自己挖开路或搭上去
    log('走不过去，自己想办法');
    try { await moveHelper.unstickTo(y); } catch (e) { log('自救失败:', e.message); }
    // 自救后再试一次
    return actions.gotoXYZ(x, y, z, range);
  }

  function nearestBlock(names, maxDist = 28) {
    const me = pos();
    const ids = names.map((n) => bot.registry.blocksByName[n] && bot.registry.blocksByName[n].id).filter((x) => x !== undefined);
    if (!ids.length) return null;
    const f = bot.findBlocks({ matching: ids, maxDistance: maxDist, count: 6 });
    let best = null, bd = Infinity;
    for (const p of f) {
      const d = me.distanceTo(p);
      if (d > 1.5 && d < bd) { bd = d; best = p; }
    }
    return best ? { pos: best, dist: bd } : null;
  }

  async function doChop() {
    const f = nearestBlock(['log', 'log2'], 32);
    if (!f) return false;
    if (nearHome(f.pos)) { log('树在家附近，不砍'); return false; }
    log(`去砍树 ${Math.round(f.dist)} 格`);
    if (!(await goNear(f.pos.x, f.pos.y, f.pos.z, 2))) return false;
    let dug = 0;
    for (let i = 0; i < cfg.maxDigPerRound; i++) {
      const b = bot.blockAt(f.pos.offset(0, -i, 0));
      if (!b || !['log', 'log2'].includes(b.name)) break;
      if (nearHome(b.position)) { log('这块在家附近，跳过'); break; }
      try { await bot.dig(b); dug++; stats.dug++; } catch { break; }
    }
    return dug > 0;
  }

  async function doMine() {
    const f = nearestBlock(['stone', 'coal_ore', 'iron_ore'], 24);
    if (!f) return false;
    if (nearHome(f.pos)) { log('矿在家附近，不挖'); return false; }
    log(`去挖 ${Math.round(f.dist)} 格`);
    if (!(await goNear(f.pos.x, f.pos.y, f.pos.z, 2))) return false;
    let dug = 0;
    for (let i = 0; i < cfg.maxDigPerRound; i++) {
      const b = bot.blockAt(f.pos.offset(0, -i, 0));
      if (!b || !['stone', 'coal_ore', 'iron_ore'].includes(b.name)) break;
      if (nearHome(b.position)) break;
      try { await bot.dig(b); dug++; stats.dug++; } catch { break; }
    }
    return dug > 0;
  }

  async function doGather() {
    const f = nearestBlock(['tall_grass', 'yellow_flower', 'red_flower'], 16);
    if (!f || nearHome(f.pos)) return false;
    if (!(await goNear(f.pos.x, f.pos.y, f.pos.z, 2))) return false;
    try { const b = bot.blockAt(f.pos); if (b) { await bot.dig(b); stats.dug++; return true; } } catch {}
    return false;
  }

  async function doExplore() {
    const me = pos();
    const base = home || me;
    const ang = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 24;
    const x = Math.round(base.x + Math.cos(ang) * r);
    const z = Math.round(base.z + Math.sin(ang) * r);
    const y = Math.round(me.y);
    return actions.gotoXYZ(x, y, z, 2);
  }

  function doSay(text) {
    if (!text) return false;
    try { bot.chat(String(text).slice(0, 120)); return true; } catch { return false; }
  }

  function idleFidget() {
    try { bot.look(bot.entity.yaw + (Math.random() - 0.5) * 1.4, bot.entity.pitch, false); } catch {}
    if (Math.random() < 0.35) {
      try { bot.setControlState('jump', true); setTimeout(() => { try { bot.setControlState('jump', false); } catch {} }, 250); } catch {}
    }
  }

  // ── 主循环 ──────────────────────────────────────────────────────
  // 启动时把上次记的家读回来
  loadHome();

  async function tick() {
    if (!running) return;
    if (!bot.entity) { timer = setTimeout(tick, 3000); return; }
    if (!llm) llm = createLlmDecider({ root: process.cwd(), log });
    if (!moveHelper) moveHelper = createMoveHelper(bot, log);

    // 底线优先（不花 token）
    const danger = checkSafety();
    if (danger) {
      await actions.gotoXYZ(danger.x, danger.y, danger.z, 2);
      lastAction = 'safety';
      timer = setTimeout(tick, 3000);
      return;
    }

    // 如果还在"跟随某人"状态，先问自己：是不是主人让它自己玩了
    // 规则：跟随状态 != 停止自主。只有"贴着主人"时才不跑远；
    // 主人说"自己玩"时会调 stopFollow()，这里就不该再被 following 挡住。
    const following = actions.status().following;
    if (following) {
      const ow = ownerPos();
      const me = pos();
      const d = ow && me ? dist(me, ow.p) : 999;
      // 贴着主人（<6 格）时才停下不乱逛，免得绕着他转圈
      if (d < 6) {
        timer = setTimeout(tick, cfg.decideIntervalMs);
        return;
      }
    }

    stats.rounds++;
    const snap = snapshot();
    const d = await llm.decide(snap);
    stats.llmCalls++;

    if (d.action === lastAction) sameActionTimes++; else sameActionTimes = 0;
    lastAction = d.action;

    try {
      switch (d.action) {
        case 'chop': await doChop(); break;
        case 'mine': await doMine(); break;
        case 'gather': await doGather(); break;
        case 'gohome': await goHome(); break;
        case 'say': doSay(d.say || d.why); break;
        case 'explore': await doExplore(); break;
        default: idleFidget(); break;
      }
    } catch (e) { log('动作失败:', e.message); }

    timer = setTimeout(tick, cfg.decideIntervalMs);
  }

  function start() {
    if (running) return;
    running = true;
    log(`自主行为开启（LLM 决策，每 ${Math.round(cfg.decideIntervalMs / 1000)}s 一次；挖=${cfg.allowDig} 家保护=${cfg.homeSafeRadius}格）`);
    tick();
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    try { bot.pathfinder.setGoal(null); } catch {}
    try { bot.clearControlStates(); } catch {}
    log('自主行为关闭');
  }

  function status() {
    return {
      enabled: running,
      home,
      returning,
      health: bot.health,
      llm: llm ? llm.status() : null,
      decideIntervalMs: cfg.decideIntervalMs,
      homeSafeRadius: cfg.homeSafeRadius,
      lastAction,
      stats,
    };
  }

  return { start, stop, setHome, getHome, goHome, status, config: cfg, llmRef: () => llm };
}
