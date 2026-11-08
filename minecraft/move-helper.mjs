// 移动辅助：寻路失败时自己挖开路 / 搭柱子上去
// 只在需要时调，不做常驻逻辑
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;

export function createMoveHelper(bot, log = console.log) {
  const pos = () => bot.entity && bot.entity.position;

  // 创造模式：直接给自己几组方块，不然没法搭
  function ensureBlocks() {
    if (bot.game.gameMode !== 'creative') return false;
    if (typeof bot.creative?.setInventorySlot !== 'function') return false;
    try {
      const items = ['dirt', 'cobblestone', 'oak_planks'];
      for (let i = 0; i < items.length; i++) {
        const it = bot.registry.itemsByName[items[i]];
        if (!it) continue;
        bot.creative.setInventorySlot(36 + i, { name: it.name, count: 64 });
      }
      return true;
    } catch (e) {
      log('给方块失败:', e.message);
      return false;
    }
  }

  // 背包里找一块能用来搭的方块
  function findBlockItem() {
    return bot.inventory.items().find((it) =>
      /dirt|cobble|plank|stone|netherrack|sand/.test(it.name) && it.count > 0
    );
  }

  // 挖掉挡在面前/头顶的方块（最多 n 块）
  async function digAhead(n = 4) {
    let dug = 0;
    for (let i = 0; i < n; i++) {
      const me = pos();
      const front = me.offset(-Math.sin(bot.entity.yaw) * 1.6, 0, -Math.cos(bot.entity.yaw) * 1.6);
      let b = bot.blockAt(front);
      if (!b || b.name === 'air' || b.name === 'bedrock') {
        b = bot.blockAt(me.offset(0, 2, 0)); // 头顶
      }
      if (!b || b.name === 'air' || b.name === 'bedrock' || /(?:^|_)(?:chest|shulker_box|barrel)$/.test(b.name)) break;
      try {
        await bot.dig(b);
        dug++;
      } catch { break; }
    }
    return dug;
  }

  // 往上搭柱子（脚下放方块，跳上去，重复）
  async function pillarUp(blocks = 10) {
    if (bot.game.gameMode !== 'creative') ensureBlocks();
    let placed = 0;
    for (let i = 0; i < blocks; i++) {
      const item = findBlockItem();
      if (!item) { log('没有方块可以搭'); break; }
      const me = pos();
      // 脚下是实的才能往上放
      const below = bot.blockAt(me.offset(0, -1, 0));
      if (!below || below.name === 'air') {
        // 脚下没东西，先往下挖一格稳住
        break;
      }
      try {
        await bot.equip(item, 'hand');
        bot.setControlState('jump', true);
        await new Promise((r) => setTimeout(r, 180));
        // 放脚下那块（面朝上）
        const ref = bot.blockAt(me.offset(0, -1, 0));
        if (ref) {
          await bot.placeBlock(ref, { x: 0, y: 1, z: 0 });
          placed++;
        }
      } catch (e) {
        // 放失败很常见，继续试
      } finally {
        bot.setControlState('jump', false);
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    log(`往上搭了 ${placed} 格`);
    return placed;
  }

  // 综合自救：先挖，再搭，最后跳
  async function unstickTo(targetY = null) {
    if (bot.game.gameMode === 'creative') ensureBlocks();
    const meY = pos()?.y ?? 0;
    // 目标在头顶上方 2 格以上 → 搭柱子
    if (targetY !== null && targetY > meY + 1.5) {
      log('目标在上面，试着搭上去');
      const n = await pillarUp(Math.min(12, Math.ceil(targetY - meY) + 2));
      if (n > 0) return true;
    }
    // 否则挖开路
    const dug = await digAhead(4);
    if (dug > 0) {
      log(`挖开 ${dug} 块挡路的`);
      return true;
    }
    // 都不行就原地跳
    try {
      bot.setControlState('jump', true);
      await new Promise((r) => setTimeout(r, 300));
      bot.setControlState('jump', false);
    } catch {}
    return false;
  }

  return { ensureBlocks, pillarUp, digAhead, unstickTo };
}
