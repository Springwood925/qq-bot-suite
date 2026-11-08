// 动作库：跟随、走到坐标、停下来、看看周围
// 关键：所有寻路都带超时 + 卡住检测，否则 pathfinder 卡一次就再也不动了
import pathfinderPkg from 'mineflayer-pathfinder';
import {navigationTimeout,followNeedsUnstick} from './navigation-budget.mjs';
import {nearbyHostiles} from './combat-operations.mjs';
const { goals } = pathfinderPkg;

const FOLLOW_DISTANCE = 3;   // 隔多远算"跟上了"
const REPATH_MS = 1200;      // 多久重新评估一次
const GOTO_TIMEOUT_MS = 8000; // 单次寻路上限，超时就放弃重来
const STUCK_WINDOW_MS = 2500; // 这么久没挪动算卡住

function droppedItemInfo(entity) {
  try {
    const item=entity.getDroppedItem?.();
    return item ? {name:item.name,id:item.type,metadata:item.metadata??0,count:item.count} : null;
  } catch { return null; }
}

export function createActions(bot, log = console.log) {
  let followTarget = null;
  let followTimer = null;
  let moving = false;
  let stuckCount = 0;
  let followGeneration = 0;
  let activeMove = null;

  // ── 单次寻路，带超时 ────────────────────────────────────────────
  function gotoWithTimeout(goal, timeoutMs = GOTO_TIMEOUT_MS) {
    if (activeMove) activeMove('superseded');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok, why) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (activeMove === cancel) {
          activeMove = null;
          try { bot.pathfinder.setGoal(null); } catch {}
        }
        resolve({ ok, why });
      };
      const cancel = why => finish(false, why);
      activeMove = cancel;
      const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
      bot.pathfinder.goto(goal)
        .then(() => finish(true, 'arrived'))
        .catch((e) => finish(false, e && e.message ? e.message : 'failed'));
    });
  }

  function stopMoving() {
    if (followTimer) { clearTimeout(followTimer); followTimer = null; }
    if (activeMove) activeMove('cancelled');
    moving = false;
    try { bot.pathfinder.setGoal(null); } catch {}
    try { bot.clearControlStates(); } catch {}
  }

  function stopFollow() {
    followGeneration++;
    followTarget = null;
    stopMoving();
    log('停止跟随');
  }

  function pos() {
    return bot.entity && bot.entity.position;
  }

  function distTo(name) {
    const p = bot.players[name] && bot.players[name].entity;
    if (!p) return Infinity;
    return pos().distanceTo(p.position);
  }

  // 卡住时自救：先跳一下，还不行就换个落点（左右各偏一点）
  async function unstick(name, valid = () => true) {
    if (!valid()) return false;
    stuckCount += 1;
    log(`被卡住了（第 ${stuckCount} 次），试着跳一下`);
    try { bot.setControlState('jump', true); } catch {}
    await new Promise((r) => setTimeout(r, 350));
    try { bot.setControlState('jump', false); } catch {}
    if (!valid()) return false;

    if (stuckCount >= 3) {
      // 连续卡三次：往旁边歪一格再试
      stuckCount = 0;
      const t = bot.players[name] && bot.players[name].entity;
      if (!t) return false;
      const dx = (Math.random() - 0.5) * 6;
      const dz = (Math.random() - 0.5) * 6;
      log('连续卡住，换个落点绕');
      const goal = new goals.GoalNear(t.position.x + dx, t.position.y, t.position.z + dz, 1);
      const r = await gotoWithTimeout(goal, GOTO_TIMEOUT_MS);
      return r.ok;
    }
    return false;
  }

  // 走到某个玩家附近
  async function gotoPlayer(name, range = FOLLOW_DISTANCE) {
    stopFollow();
    const target = bot.players[name] && bot.players[name].entity;
    if (!target) { log(`看不到 ${name}`); return false; }
    const goal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, range);
    const r = await gotoWithTimeout(goal);
    return r.ok;
  }

  // 跟随：定时检查距离，远了就重新规划；卡住会自救
  function follow(name) {
    stopFollow();
    const generation = followGeneration;
    const valid = () => generation === followGeneration && followTarget === name;
    stuckCount = 0;
    followTarget = name;
    log(`开始跟随 ${name}`);

    const tick = async () => {
      if (!valid()) return;
      const me = pos();
      if (!me) { followTimer = setTimeout(tick, REPATH_MS); return; }

      const d = distTo(followTarget);
      if (d === Infinity) {
        // 看不到人（不在视野 / 跨维度），歇一会儿再看
        followTimer = setTimeout(tick, REPATH_MS);
        return;
      }

      if (d > FOLLOW_DISTANCE + 1 && !moving) {
        moving = true;
        const startPos = me.clone();
        const targetPosition=bot.players[followTarget]?.entity?.position || me;
        await gotoWithTimeout(new goals.GoalNear(
          (bot.players[followTarget] && bot.players[followTarget].entity
            ? bot.players[followTarget].entity.position.x : me.x),
          (bot.players[followTarget] && bot.players[followTarget].entity
            ? bot.players[followTarget].entity.position.y : me.y),
          (bot.players[followTarget] && bot.players[followTarget].entity
            ? bot.players[followTarget].entity.position.z : me.z),
          FOLLOW_DISTANCE
        ),Math.min(20000,navigationTimeout(me,targetPosition)));
        if (!valid()) return;

        // 判断这次是不是"白走了"（没动多少就到了，或者超时）
        const moved = pos().distanceTo(startPos);
        const stillFar = distTo(followTarget);
        if (followNeedsUnstick(moved,stillFar)) await unstick(followTarget, valid);
        else stuckCount = 0;
        moving = false;
      }

      if (valid()) followTimer = setTimeout(tick, REPATH_MS);
    };
    tick();
  }

  // 走到绝对坐标
  async function gotoXYZ(x, y, z, range = 1) {
    stopFollow();
    const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), range);
    const r = await gotoWithTimeout(goal, navigationTimeout(pos(),{x,y,z}));
    log(r.ok ? `到达 ${x},${y},${z}` : `走不过去（${r.why}）`);
    return r.ok;
  }

  function lookAt(name) {
    const t = bot.players[name] && bot.players[name].entity;
    if (!t) return false;
    bot.lookAt(t.position.offset(0, t.height, 0), true);
    return true;
  }

  function status() {
    const p = pos();
    return {
      pos: p ? { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) } : null,
      dimension: bot.game.dimension,
      mode: bot.game.gameMode,
      health: bot.health,
      food: bot.food,
      experienceLevel: Number.isFinite(bot.experience?.level) ? bot.experience.level : null,
      timeOfDay: Number.isFinite(bot.time?.timeOfDay) ? bot.time.timeOfDay : null,
      sleeping: !!bot.isSleeping,
      inWater: !!bot.entity?.isInWater,
      oxygenLevel: Number.isFinite(bot.oxygenLevel) ? bot.oxygenLevel : null,
      swimRescue: bot.swimRescue?.status() || null,
      heldItem: bot.heldItem ? {name:bot.heldItem.name,id:bot.heldItem.type,metadata:bot.heldItem.metadata??0,count:bot.heldItem.count} : null,
      following: followTarget,
      players: Object.keys(bot.players).filter((n) => n !== bot.username),
      visiblePlayers: Object.entries(bot.players).filter(([name,player])=>name!==bot.username && player?.entity?.position).map(([name,player])=>({name,x:+player.entity.position.x.toFixed(1),y:+player.entity.position.y.toFixed(1),z:+player.entity.position.z.toFixed(1),distance:p?+p.distanceTo(player.entity.position).toFixed(1):null})),
      followVisible: followTarget ? !!bot.players[followTarget]?.entity?.position : null,
      followDistance: followTarget && Number.isFinite(distTo(followTarget)) ? +distTo(followTarget).toFixed(1) : null,
      nearbyHostiles: nearbyHostiles(bot),
      nearbyDrops: p ? Object.values(bot.entities || {}).filter(e => e?.position && ['item','item_stack'].includes(String(e.name || '').toLowerCase()) && p.distanceTo(e.position) <= 24).sort((a,b)=>p.distanceTo(a.position)-p.distanceTo(b.position)).slice(0, 12).map(e => {const item=droppedItemInfo(e);return {x:+e.position.x.toFixed(1),y:+e.position.y.toFixed(1),z:+e.position.z.toFixed(1),distance:+p.distanceTo(e.position).toFixed(1),...(item?{item}:{})};}) : [],
    };
  }

  return { follow, stopFollow, stopMoving, gotoPlayer, gotoXYZ, lookAt, status };
}
