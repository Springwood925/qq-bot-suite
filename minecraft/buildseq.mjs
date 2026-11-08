// 建造 / 连串动作（设计抄自 whale_craft 的 mc_build / mc_sequence，MIT）
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import { placeAtTarget } from './place-target.mjs';
import { digWithHarvestCheck } from './dig-operations.mjs';
const { goals } = pathfinderPkg;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 背包里找可用的方块（按 item 名，或任意能放的） */
function findBlockItem(bot, want) {
  const items = bot.inventory.items();
  if (want) return items.find((i) => i.name === want);
  return items.find((i) => /dirt|cobble|plank|sand|stone|log/.test(i.name));
}

/**
 * 搭一个长方体（实心或空心墙）。
 * 逐格 placeNear 太慢，这里直接对着已知的实心参考方块放。
 */
export async function buildBox(bot, { x, y, z, width = 3, height = 3, depth = 3, item = null, hollow = true, log = console.log } = {}) {
  const it0 = findBlockItem(bot, item);
  if (!it0) throw new Error('背包里没有能放的方块');
  await bot.equip(it0, 'hand');

  const w = Math.max(1, Math.min(32, width));
  const h = Math.max(1, Math.min(32, height));
  const d = Math.max(1, Math.min(32, depth));
  const base = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };

  const cells = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      for (let dz = 0; dz < d; dz++) {
        if (hollow) {
          const edge = dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1 || dz === 0 || dz === d - 1;
          if (!edge) continue;
        }
        cells.push({ x: base.x + dx, y: base.y + dy, z: base.z + dz });
      }
    }
  }

  // 从低到高、从近到远排；贴着已有实心块放成功率最高
  const me = bot.entity.position;
  cells.sort((a, b) => (a.y - b.y) || (Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z)));

  let placed = 0, failed = 0, existing = 0, attempted = 0, consecutiveFailures = 0;
  const startedAt = Date.now();
  for (const c of cells) {
    if (Date.now() - startedAt > 120000) break;
    attempted++;
    const target = new Vec3(c.x,c.y,c.z);
    const cur = bot.blockAt(target, false);
    if (!cur) { failed++; consecutiveFailures++; if (consecutiveFailures >= 8) break; continue; }
    if (cur && cur.name !== 'air' && cur.name !== 'cave_air') {
      if (cur.name === it0.name) { existing++; consecutiveFailures=0; }
      else { failed++; consecutiveFailures++; if (consecutiveFailures >= 8) break; }
      continue;
    }

    // 太远就挪近一点
    const dist = Math.hypot(c.x - bot.entity.position.x, c.z - bot.entity.position.z);
    if (dist > 4.5) {
      let timer;
      try {
        await Promise.race([bot.pathfinder.goto(new goals.GoalNear(c.x, c.y, c.z, 3)), new Promise((_, reject) => { timer=setTimeout(()=>reject(Error('寻路超时')),12000); })]);
      } catch { try { bot.pathfinder.setGoal(null); } catch {} failed++; consecutiveFailures++; if (consecutiveFailures >= 8) break; continue; }
      finally { clearTimeout(timer); }
    }

    try {
      const it = findBlockItem(bot, item);
      if (!it) throw new Error('方块用完了');
      const result=await placeAtTarget(bot,target,{item:it.name});
      if(!result.ok)throw Error(result.reason||'目标方块未确认');
      if(result.already){existing++;consecutiveFailures=0;continue;}
      placed++;
      consecutiveFailures=0;
    } catch (e) {
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= 8) { log(`连续失败 ${consecutiveFailures} 次，停`); break; }
    }
    if (placed % 6 === 0) await sleep(120);
  }
  return { placed, failed, existing, attempted, total: cells.length, complete: attempted === cells.length && failed === 0, from: base, size: { w, h, d },note:'仅构建指定盒体，不自动创建门、室内空间或验收房屋。' };
}

/**
 * 连串动作：一次调用做一长串事。
 * steps: [{type, ...}]
 *   wait{ms} / move{x,y,z} / look{who} / say{text} / dig{x,y,z} / place{x,y,z,item} / equip{name} / jump{ms}
 */
export async function runSequence(bot, steps, { log = console.log, budgetMs = 300000, stopOnError = true, stations = null } = {}) {
  const t0 = Date.now();
  const results = [];
  const stepsArr = Array.isArray(steps) ? steps.slice(0, 64) : [];
  for (let i = 0; i < stepsArr.length; i++) {
    if (Date.now() - t0 > budgetMs) { results.push({ i, type: stepsArr[i].type, ok: false, error: '超出总预算' }); break; }
    const s = stepsArr[i] || {};
    const t = String(s.type || '').toLowerCase();
    try {
      let r = null;
      switch (t) {
        case 'wait': await sleep(Math.min(30000, Number(s.ms) || 500)); r = 'waited'; break;
        case 'move': {
          let timer;let ok;
          try {ok = await Promise.race([
            bot.pathfinder.goto(new goals.GoalNear(Number(s.x), Number(s.y), Number(s.z), Number(s.range) || 2)).then(() => true),
            new Promise(resolve=>{timer=setTimeout(()=>resolve(false),Math.min(90000, Number(s.budgetMs) || 40000));}),
          ]);} finally {clearTimeout(timer);}
          if(!ok){try{bot.pathfinder.setGoal(null)}catch{};throw Error('移动超时，已停止寻路');}
          r = { arrived: ok, pos: { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } };
          break;
        }
        case 'look': {
          const name = String(s.who || '').trim();
          const p = name ? bot.players?.[name]?.entity?.position : null;
          if (p) await bot.lookAt(p.offset(0, 1.6, 0), true);
          else if (bot.entity) await bot.look(Number(s.yaw) || bot.entity.yaw, Number(s.pitch) || 0, true);
          r = 'looked'; break;
        }
        case 'say': {
          const text = String(s.text || '').slice(0, 200);
          if (text) bot.chat(text);
          r = { said: text }; break;
        }
        case 'dig': {
          const b = bot.blockAt(new Vec3(Number(s.x), Number(s.y), Number(s.z)), false);
          const result=await digWithHarvestCheck(bot,b);
          if(!result.ok)throw Error(result.error||'挖掘未完成');
          r = result; break;
        }
        case 'place': {
          const it = findBlockItem(bot, s.item);
          if (!it) throw new Error('没有方块');
          const result=await placeAtTarget(bot,new Vec3(Number(s.x),Number(s.y),Number(s.z)),{item:it.name});
          if(!result.ok)throw Error(result.reason||'放置未确认');
          r = result; break;
        }
        case 'furnace': {
          if (!stations || typeof stations.run !== 'function') throw Error('熔炉操作不可用');
          if (![s.x,s.y,s.z].every(Number.isInteger)) throw Error('熔炉步骤需要整数 x y z');
          const op=String(s.operation || 'furnace-inspect');
          if (!['furnace-inspect','furnace-input','furnace-fuel','furnace-take','furnace-take-input','furnace-take-fuel'].includes(op)) throw Error('不支持的熔炉操作');
          const target=bot.blockAt(new Vec3(s.x,s.y,s.z),false);
          if (!target || !['furnace','lit_furnace'].includes(target.name)) throw Error('目标不是熔炉');
          const result=await stations.run(bot,target,{operation:op,name:s.name,count:s.count===undefined?1:s.count});
          if (!result.ok) throw Error(result.error||result.reason||'熔炉步骤未确认');
          r=result;break;
        }
        case 'equip': {
          const it = bot.inventory.items().find((x) => x.name === String(s.name || '') || x.name.includes(String(s.name || '')));
          if (!it) throw new Error('没有 ' + s.name);
          await bot.equip(it, s.dest || 'hand');
          r = { equipped: it.name }; break;
        }
        case 'jump': {
          bot.setControlState('jump', true);
          await sleep(Math.min(1500, Number(s.ms) || 300));
          bot.setControlState('jump', false);
          r = 'jumped'; break;
        }
        default: throw new Error('未知步骤类型: ' + t);
      }
      results.push({ i, type: t, ok: true, result: r });
    } catch (e) {
      results.push({ i, type: t, ok: false, error: String(e.message || e) });
      if (stopOnError) break;
    }
  }
  return { results, totalMs: Date.now() - t0, done: results.length };
}
