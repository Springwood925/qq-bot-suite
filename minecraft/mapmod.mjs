// 地图 / 高度图 / 扫描（设计抄自 whale_craft 的 mc_map / mc_height / mc_scan，MIT）
// 让 AI "看见"地形，而不是只拿到一串坐标。
import { Vec3 } from 'vec3';

/** 方块名 → 一个字符。按常见程度排序。 */
const GLYPHS = [
  [['water', 'flowing_water'], '~'],
  [['lava', 'flowing_lava'], '!'],
  [['grass', 'grass_block'], '"'],
  [['dirt', 'coarse_dirt', 'podzol'], '.'],
  [['stone', 'cobblestone', 'andesite', 'diorite', 'granite'], '#'],
  [['sand', 'red_sand', 'gravel'], ':'],
  [['log', 'log2', 'wood', 'leaves', 'leaves2'], 'T'],
  [['coal_ore'], 'c'],
  [['iron_ore'], 'i'],
  [['gold_ore'], 'g'],
  [['diamond_ore'], 'D'],
  [['redstone_ore', 'lit_redstone_ore'], 'r'],
  [['crafting_table'], 'W'],
  [['chest', 'trapped_chest', 'ender_chest'], 'C'],
  [['furnace', 'lit_furnace'], 'F'],
  [['torch', 'glowstone', 'sea_lantern'], '*'],
  [['planks', 'oak_planks', 'birch_planks'], '='],
  [['snow', 'snow_layer'], '_'],
  [['ice', 'packed_ice'], '-'],
  [['air', 'cave_air'], ' '],
];

const NAME_TO_GLYPH = new Map();
for (const [names, g] of GLYPHS) for (const n of names) NAME_TO_GLYPH.set(n, g);

function glyphOf(name) {
  if (NAME_TO_GLYPH.has(name)) return NAME_TO_GLYPH.get(name);
  if (/water/.test(name)) return '~';
  if (/lava/.test(name)) return '!';
  if (/log|wood|leaves/.test(name)) return 'T';
  if (/ore/.test(name)) return 'o';
  if (/plank/.test(name)) return '=';
  if (/stone|cobble/.test(name)) return '#';
  if (/dirt|grass/.test(name)) return '.';
  if (/sand|gravel/.test(name)) return ':';
  return '?';
}

/**
 * 地表方块图（俯视）。
 * 从 startY 往下找第一个非空气方块，取它的名字转字符。
 * @returns {{ lines: string[], center: {x,y,z}, radius: number }}
 */
export function surfaceMap(bot, { radius = 24, startY = null, step = 2 } = {}) {
  const me = bot.entity?.position;
  if (!me) return null;
  const cx = Math.floor(me.x);
  const cy = startY === null ? Math.floor(me.y) + 2 : startY;
  const cz = Math.floor(me.z);
  const r = Math.max(2, Math.min(48, radius));
  const s = Math.max(1, Math.min(4, step));

  const lines = [];
  for (let dz = -r; dz <= r; dz += s) {
    let row = '';
    for (let dx = -r; dx <= r; dx += s) {
      let ch = '?';
      for (let dy = 0; dy <= 12; dy++) {
        const b = bot.blockAt(new Vec3(cx + dx, cy - dy, cz + dz), false);
        if (!b) continue;
        if (b.name === 'air' || b.name === 'cave_air') continue;
        ch = glyphOf(b.name);
        break;
      }
      row += ch;
    }
    lines.push(row);
  }
  return { lines, center: { x: cx, y: cy, z: cz }, radius: r, step: s };
}

/**
 * 高度图：每列一个地表 Y。
 * @returns {{ lines: string[], min: number, max: number }}
 */
export function heightMap(bot, { radius = 20, startY = null, step = 2 } = {}) {
  const me = bot.entity?.position;
  if (!me) return null;
  const cx = Math.floor(me.x);
  const cy = startY === null ? Math.floor(me.y) + 2 : startY;
  const cz = Math.floor(me.z);
  const r = Math.max(2, Math.min(40, radius));
  const s = Math.max(1, Math.min(4, step));
  const SHADES = ' .:-=+*#%@';

  const heights = [];
  let min = Infinity, max = -Infinity;
  for (let dz = -r; dz <= r; dz += s) {
    const row = [];
    for (let dx = -r; dx <= r; dx += s) {
      let h = cy - 12;
      for (let dy = 0; dy <= 20; dy++) {
        const b = bot.blockAt(new Vec3(cx + dx, cy - dy, cz + dz), false);
        if (b && b.name !== 'air' && b.name !== 'cave_air') { h = cy - dy; break; }
      }
      row.push(h);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    heights.push(row);
  }

  const span = Math.max(1, max - min);
  const lines = heights.map((row) =>
    row.map((h) => SHADES[Math.min(SHADES.length - 1, Math.max(0, Math.round(((h - min) / span) * (SHADES.length - 1))))]).join('')
  );
  return { lines, min, max, center: { x: cx, y: cy, z: cz } };
}

/**
 * 范围扫描：哪些方块有多少。
 */
export function scanArea(bot, { radius = 16, height = 8 } = {}) {
  const me = bot.entity?.position;
  if (!me) return null;
  const r = Math.max(2, Math.min(24, radius));
  const h = Math.max(2, Math.min(16, height));
  const cx = Math.floor(me.x), cy = Math.floor(me.y), cz = Math.floor(me.z);
  const counts = {};
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dy = -h; dy <= h; dy += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        const b = bot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz), false);
        if (!b || b.name === 'air' || b.name === 'cave_air') continue;
        counts[b.name] = (counts[b.name] || 0) + 1;
      }
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
  return { center: { x: cx, y: cy, z: cz }, radius: r, top };
}

/** 把地图拼成给 AI 看的文本 */
export function formatMap(m, label = '地表图') {
  if (!m) return '(拿不到地图)';
  const L = [];
  L.push(`【${label}】中心 (${m.center.x}, ${m.center.y}, ${m.center.z})，半径 ${m.radius}，每 ${m.step} 格一格`);
  L.push('北 ↑ 南 ↓ 西 ← 东 →   图例：~水 !岩浆 "草 .土 #石 T树 c煤 i铁 D钻石 W工作台 C箱子 =木板 *光源 空格=空气');
  L.push('');
  L.push(...m.lines);
  return L.join('\n');
}
