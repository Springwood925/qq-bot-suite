// 终末地出图：HTML 模板 + 无头浏览器截图。不依赖任何外部服务。
// 视觉规范（用户 2026-10-04 定稿）：森空岛 App 浅色风 + 大字号（群发图别套网页尺寸）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, 'state', 'endfield');
const FONT = path.join(ROOT, 'assets', 'endfield', 'EF_fonts.ttf');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
const day = (ts) => (ts ? new Date(Number(ts) * 1000).toISOString().slice(0, 10) : '');

// 出图裁剪需要一个带 Pillow 的 python。按优先级找：
//   ① 环境变量 ENDFIELD_PYTHON（分享给别人时用这个指定）
//   ② 桥目录旁边的「群相」自带 python（作者本机的布局）
//   ③ 系统 python（PATH 里的 python.exe）
// 都找不到 ⇒ PYTHON 为 undefined，isRenderAvailable() 里配合判断即可（终末地出图降级）。
const PYTHON_CANDIDATES = [
  process.env.ENDFIELD_PYTHON,
  path.join(ROOT, '..', '群相', 'runtime', 'python', 'python.exe'),
  'python',
];
const PYTHON = PYTHON_CANDIDATES.filter(Boolean).find((p) => p === 'python' || fs.existsSync(p));
const CROP_SCRIPT = path.join(ROOT, 'scripts', 'crop-png.py');

export const RENDER_WORKDIR = WORK;
export function isRenderAvailable() { return Boolean(EDGE); }

// ---- 通用样式（浅色森空岛风 + 大字号）----
const BASE_CSS = `
@font-face{font-family:'EF';src:url('EF_fonts.ttf') format('truetype');font-display:block}
*{box-sizing:border-box;margin:0;padding:0}
html{background:#f4f2ee}
body{width:860px;background:#f4f2ee;color:#1a1a1a;font-family:'EF','Microsoft YaHei',sans-serif;padding:28px 28px 24px}
.head{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:16px;border-bottom:2px solid #1a1a1a}
.hl{display:flex;align-items:center;gap:16px}
.hl img{width:72px;height:72px;object-fit:cover;background:#eeece8;border-radius:10px}
h1{font-size:36px;font-weight:400;letter-spacing:1px}
h1 b{color:#e8552f}
.sub{color:#87837c;font-size:15px;margin-top:8px}
.stamp{color:#a09c95;font-size:14px;text-align:right;line-height:1.9}
.top{display:flex;gap:11px;margin:20px 0 4px}
.stat{flex:1;background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:14px 16px;position:relative;overflow:hidden}
.stat:before{content:'';position:absolute;left:0;top:0;width:100%;height:4px;background:#ddd9d2}
.stat.hi:before{background:#e8552f}
.stat .k{color:#a09c95;font-size:13px;letter-spacing:1px}
.stat .v{font-size:32px;margin-top:6px}
.stat.hi .v{color:#e8552f}
.sec{margin-top:26px}
.sec h2{font-size:22px;font-weight:400;letter-spacing:1px;padding-bottom:11px;border-bottom:1px solid #ddd9d2}
.sec h2:before{content:'// ';color:#c4bfb6;font-weight:700}
.sec h2 i{font-style:normal;font-size:14px;color:#a09c95;margin-left:12px}
.duo{display:flex;gap:13px;margin-top:13px}
.domain{flex:1;background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:15px 17px;border-top:4px solid #e8552f}
.dhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:11px}
.dname{font-size:20px}
.dlv{color:#e8552f;font-size:20px}
.stm{display:flex;gap:10px;align-items:baseline;font-size:15px;color:#4a4741;padding:8px 0;border-bottom:1px solid #f2f0eb}
.stm:last-child{border:none}
.stm b{color:#2f7bbf;font-weight:400}
.stm i{margin-left:auto;font-style:normal;color:#a09c95;font-size:13px}
.stm i s{text-decoration:none;color:#c4bfb6}
table{width:100%;border-collapse:collapse;font-size:15px;margin-top:13px;background:#fff;border:1px solid #e6e3dd;border-radius:9px;overflow:hidden}
th,td{padding:9px 12px;text-align:right;border-bottom:1px solid #f2f0eb}
th:first-child,td:first-child{text-align:left}
th{color:#87837c;font-weight:400;font-size:13px;letter-spacing:1px;background:#faf9f6}
td{color:#4a4741}
.sumrow td{border-top:2px solid #ddd9d2;color:#e8552f;font-weight:700}
.medals{display:flex;flex-wrap:wrap;gap:12px;margin-top:13px}
.medal{width:calc(20% - 10px);background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:13px 8px;display:flex;flex-direction:column;align-items:center;gap:9px}
.medal.plated{border-color:#e3c88f;background:#fffcf3}
.medal img{width:66px;height:66px;object-fit:contain}
.medal span{font-size:12px;color:#4a4741;text-align:center;line-height:1.35;max-height:33px;overflow:hidden}
.rooms{display:flex;gap:11px;flex-wrap:wrap;margin-top:13px}
.room{flex:1;min-width:150px;background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:13px}
.rhead{font-size:12px;color:#a09c95;margin-bottom:9px;letter-spacing:1px}
.rchars{display:flex;gap:6px}
.rchars img{width:46px;height:46px;object-fit:cover;background:#eeece8;border-radius:8px}
.rfav{font-size:12px;color:#a09c95;margin-top:9px}
.rows{display:flex;gap:10px;flex-wrap:wrap;margin-top:13px}
.row{background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:12px 18px;font-size:15px;color:#87837c}
.row b{color:#1a1a1a;font-size:19px;margin-left:9px;font-weight:400}
.row.hi b{color:#e8552f}
.empty{color:#a09c95}
.foot{margin-top:20px;color:#a09c95;font-size:13px;border-top:1px solid #ddd9d2;padding-top:13px;line-height:2}
`;

/** 写 HTML → 无头 Edge 截图 → 返回 PNG 路径。每次用全新 profile 避免吃到旧 HTML 的缓存 */
export async function renderHtmlToPng(html, name, { width = 860, height = 6000 } = {}) {
  if (!EDGE) throw new Error('本机找不到 Edge/Chrome，无法出图');
  fs.mkdirSync(WORK, { recursive: true });
  if (fs.existsSync(FONT) && !fs.existsSync(path.join(WORK, 'EF_fonts.ttf'))) {
    fs.copyFileSync(FONT, path.join(WORK, 'EF_fonts.ttf'));
  }
  const htmlPath = path.join(WORK, `${name}.html`);
  const pngPath = path.join(WORK, `${name}.png`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const profile = path.join(WORK, `p_${crypto.randomUUID().slice(0, 8)}`);
  const url = 'file:///' + htmlPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/[^\x20-\x7E]/g, (c) => encodeURIComponent(c)) + `?v=${Date.now()}`;
  try {
    await execFileAsync(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--virtual-time-budget=22000', `--window-size=${width},${height}`,
      `--user-data-dir=${profile}`, `--screenshot=${pngPath}`, url,
    ], { timeout: 120000, windowsHide: true });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (!fs.existsSync(pngPath)) throw new Error('截图未生成：' + pngPath);
  // 裁掉底部空白（固定视口截图必然多出空白；没有 Python 就退回未裁的原图）
  if (PYTHON && fs.existsSync(CROP_SCRIPT)) {
    const trimmed = pngPath.replace(/\.png$/, '-crop.png');
    try {
      await execFileAsync(PYTHON, [CROP_SCRIPT, pngPath, trimmed, '10'], { timeout: 40000, windowsHide: true });
      if (fs.existsSync(trimmed)) return trimmed;
    } catch { /* 裁剪失败就用原图 */ }
  }
  return pngPath;
}

// ---------------- 账号信息卡（群友 @ 时发的第一张）----------------
export function buildInfoCardHtml(detail) {
  const domainHtml = (detail.domain ?? []).map((dm) => `
  <div class="domain">
    <div class="dhead"><span class="dname">${esc(dm.name)}</span><span class="dlv">Lv.${dm.level}</span></div>
    ${(dm.settlements ?? []).map((s) => `<div class="stm"><span>${esc(s.name)}</span><b>Lv.${s.level}</b><i>${fmt(s.remainMoney)}<s>/${fmt(s.moneyMax)}</s></i></div>`).join('')}
  </div>`).join('');

  const areas = [];
  for (const dm of detail.domain ?? []) for (const lv of dm.levels ?? []) areas.push(lv);
  const sum = (k, f) => areas.reduce((a, x) => a + (x[k]?.[f] ?? 0), 0);
  const collectHtml = `<table><tr><th>区域</th><th>解谜</th><th>宝箱</th><th>装备箱</th><th>碎片</th><th>黑匣</th><th>塔晶</th></tr>
${areas.map((lv) => `<tr><td>${esc(lv.name)}</td><td>${lv.puzzleCount?.count}/${lv.puzzleCount?.total}</td><td>${lv.trchestCount?.count}/${lv.trchestCount?.total}</td><td>${lv.equipTrchestCount?.count}/${lv.equipTrchestCount?.total}</td><td>${lv.pieceCount?.count}/${lv.pieceCount?.total}</td><td>${lv.blackboxCount?.count}/${lv.blackboxCount?.total}</td><td>${lv.trstarCount?.count}/${lv.trstarCount?.total}</td></tr>`).join('')}
<tr class="sumrow"><td>合计</td><td>${sum('puzzleCount', 'count')}/${sum('puzzleCount', 'total')}</td><td>${sum('trchestCount', 'count')}/${sum('trchestCount', 'total')}</td><td>${sum('equipTrchestCount', 'count')}/${sum('equipTrchestCount', 'total')}</td><td>${sum('pieceCount', 'count')}/${sum('pieceCount', 'total')}</td><td>${sum('blackboxCount', 'count')}/${sum('blackboxCount', 'total')}</td><td>${sum('trstarCount', 'count')}/${sum('trstarCount', 'total')}</td></tr></table>`;

  // 账号"当前展示"的 10 枚勋章（achieve.display 是展示位 → achievementData.id）
  const byId = new Map();
  for (const m of detail.achieve?.achieveMedals ?? []) byId.set(m.achievementData?.id, m);
  const shown = Object.entries(detail.achieve?.display ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0])).map(([, id]) => byId.get(id)).filter(Boolean);
  const plated = (detail.achieve?.achieveMedals ?? []).filter((m) => m.isPlated).length;
  const medalHtml = shown.map((m) => {
    const d = m.achievementData ?? {};
    const icon = d.platedIcon || d.reforge3Icon || d.reforge2Icon || d.initIcon;
    return `<div class="medal ${m.isPlated ? 'plated' : ''}"><img src="${esc(icon)}" onerror="this.style.visibility='hidden'"><span>${esc(d.name)}</span></div>`;
  }).join('');

  const rooms = (detail.spaceShip?.rooms ?? []).filter((r) => (r.chars ?? []).length);
  const roomHtml = rooms.map((r) => `<div class="room"><div class="rhead">ROOM ${r.type} · Lv.${r.level}</div><div class="rchars">${(r.chars ?? []).map((c) => `<img src="${esc(c.avatarUrl)}" onerror="this.style.visibility='hidden'">`).join('')}</div><div class="rfav">好感 ${(r.chars ?? []).map((c) => c.favorability).join(' / ')}</div></div>`).join('');

  const crisis = (detail.crisisContract ?? []).length
    ? (detail.crisisContract ?? []).map((c) => `${esc(c.name)} 最高${c.highest}`).join('　') : '<span class="empty">本期无记录</span>';

  const b = detail.base ?? {};
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
<div class="head">
  <div class="hl">
    ${b.avatarUrl ? `<img src="${esc(b.avatarUrl)}" onerror="this.style.visibility='hidden'">` : ''}
    <div><h1>${esc(b.name)} <b>·</b> 账号信息</h1>
    <div class="sub">明日方舟：终末地　${esc(b.serverName || '官服')}　Lv.${b.level}　世界等级 ${b.worldLevel}　UID ${esc(b.roleId)}</div>
    <div class="sub">创建 ${day(b.createTime)}　最后登录 ${day(b.lastLoginTime)}　主线「${esc(b.mainMission?.description)}」</div></div>
  </div>
  <div class="stamp">${new Date().toLocaleString('zh-CN', { hour12: false })}<br>数据来源 森空岛</div>
</div>
<div class="top">
  <div class="stat hi"><div class="k">角色</div><div class="v">${b.charNum}</div></div>
  <div class="stat hi"><div class="k">武器</div><div class="v">${b.weaponNum}</div></div>
  <div class="stat"><div class="k">档案</div><div class="v">${b.docNum}</div></div>
  <div class="stat"><div class="k">勋章</div><div class="v">${detail.achieve?.count}</div></div>
  <div class="stat"><div class="k">据点</div><div class="v">${(detail.domain ?? []).length}</div></div>
</div>
<div class="sec"><h2>据点</h2><div class="duo">${domainHtml}</div></div>
<div class="sec"><h2>收集度</h2>${collectHtml}</div>
<div class="sec"><h2>勋章展示<i>账号当前展示的 ${shown.length} 枚 · 总收集 ${detail.achieve?.count} · 已镀层 ${plated}</i></h2><div class="medals">${medalHtml}</div></div>
<div class="sec"><h2>飞船房间 · 角色好感度</h2><div class="rooms">${roomHtml}</div></div>
<div class="sec"><h2>其他</h2><div class="rows">
  <div class="row hi">通行证<b>${detail.bpSystem?.curLevel}/${detail.bpSystem?.maxLevel}</b></div>
  <div class="row hi">体力<b>${detail.dungeon?.curStamina}/${detail.dungeon?.maxStamina}</b></div>
  <div class="row">日常<b>${detail.dailyMission?.dailyActivation}/${detail.dailyMission?.maxDailyActivation}</b></div>
  <div class="row">周常<b>${detail.weeklyMission?.score}/${detail.weeklyMission?.total}</b></div>
  <div class="row">危机合约<b>${crisis}</b></div>
</div></div>
<div class="foot">数据来源：森空岛　·　战争回响与影拓丰碑的详细战绩、角色装备见另图</div>
</body></html>`;
}

export async function renderInfoCard(detail, { name = 'info' } = {}) {
  return await renderHtmlToPng(buildInfoCardHtml(detail), name);
}

/**
 * 生成扫码登录二维码 PNG。
 * ⚠️ 必须本地生成 —— scanUrl 扫了就等于登录，绝不能交给任何在线二维码服务。
 */
export async function renderQrToPng(scanUrl, { width = 460 } = {}) {
  const QRCode = (await import('qrcode')).default;
  fs.mkdirSync(WORK, { recursive: true });
  const out = path.join(WORK, `qr-${Date.now()}.png`);
  await QRCode.toFile(out, scanUrl, { width, margin: 2 });
  return out;
}

// ---------------- 武器图标（endfieldtools，按 weaponId；本地缓存）----------------
const ICON_DIR = path.join(WORK, 'icons');

/** 为这些武器记录准备本地图标，返回 名字 → dataURI 的映射（内联，避免 headless 加载不稳）*/
export async function ensureWeaponIcons(entries = []) {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const out = {};
  const targets = [];
  const seen = new Set();
  for (const r of entries) {
    const name = r.weaponName || r.nameText;
    const wid = r.weaponId;
    if (!name || !wid || seen.has(name)) continue;
    seen.add(name);
    targets.push({ name, wid, file: path.join(ICON_DIR, `${wid}.png`) });
  }
  // 并发下载（每批 8 个）—— 串行下 38 张要 3 分钟，并发后几秒（有缓存时几乎瞬时）
  for (let i = 0; i < targets.length; i += 8) {
    await Promise.all(targets.slice(i, i + 8).map(async (t) => {
      try {
        if (!fs.existsSync(t.file)) {
          const res = await fetch(`https://endfieldtools.dev/assets/images/endfield/itemicon/${t.wid}.png`, {
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://endfieldtools.dev/' },
            signal: AbortSignal.timeout(12000),
          });
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 100) return;
          fs.writeFileSync(t.file, buf);
        }
        out[t.name] = 'data:image/png;base64,' + fs.readFileSync(t.file).toString('base64');
      } catch { /* 单张失败不影响整体 */ }
    }));
  }
  return out;
}

const EXTRA_GACHA = `
.top{display:flex;gap:11px;margin:20px 0 4px}
.stat{flex:1;background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:14px 16px;position:relative;overflow:hidden}
.stat:before{content:'';position:absolute;left:0;top:0;width:100%;height:4px;background:#ddd9d2}
.stat.hi:before{background:#e8552f}.stat .k{color:#a09c95;font-size:13px;letter-spacing:1px}
.stat .v{font-size:32px;margin-top:6px}.stat .v small{font-size:15px;color:#a09c95}.stat.hi .v{color:#e8552f}
.legend{display:flex;gap:16px;margin:16px 0 2px;font-size:14px;color:#87837c;flex-wrap:wrap}
.legend i{display:inline-block;width:22px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}
.pool{background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:15px 17px;margin-top:13px;border-left:4px solid #e8552f}
.pool.wp{border-left-color:#5b8def}
.phead{display:flex;align-items:baseline;gap:10px;margin-bottom:13px}
.pname{font-size:20px}.pmeta{margin-left:auto;font-size:15px;color:#87837c}
.pmeta b{color:#1a1a1a;font-size:19px;padding:0 3px}
.rows{display:flex;flex-direction:column;gap:9px}
.row{display:flex;align-items:center;gap:12px;height:46px}
.av{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#eeece8;flex:none}
.track{flex:1;height:28px;background:#f0eeea;border-radius:6px;position:relative;overflow:hidden}
.fill{height:100%;border-radius:6px}
.fill.lucky{background:linear-gradient(90deg,#37a06e,#5ecf96)}.fill.good{background:linear-gradient(90deg,#6fae3f,#9ed466)}
.fill.mid{background:linear-gradient(90deg,#d9a017,#f5c542)}.fill.bad{background:linear-gradient(90deg,#e07a30,#f5a05a)}
.fill.worst{background:linear-gradient(90deg,#cf3f30,#ee6455)}
.val{position:absolute;right:14px;top:3px;font-size:17px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.4);font-weight:700}
.tag{width:62px;text-align:center;font-size:14px;padding:5px 0;border-radius:6px;flex:none;font-weight:700}
.tag.lucky{background:#e3f5ec;color:#2f8f61}.tag.good{background:#eaf5e0;color:#5f9a32}
.tag.mid{background:#fdf3d9;color:#b8860b}.tag.bad{background:#fdeade;color:#d2691e}.tag.worst{background:#fde5e2;color:#cf3f30}
.name{width:150px;font-size:15px;color:#4a4741;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
.name i{font-style:normal;color:#e8552f;font-size:12px;margin-left:6px}
.psec{margin-top:26px}
.psec h2{font-size:22px;font-weight:400;letter-spacing:1px;padding-bottom:11px;border-bottom:1px solid #ddd9d2}
.psec h2:before{content:'// ';color:#c4bfb6;font-weight:700}
.psec h2 i{font-style:normal;font-size:14px;color:#a09c95;margin-left:12px}
`;
const EXTRA_BATTLE = `
.grp{background:#fff;border:1px solid #e6e3dd;border-radius:9px;margin-top:13px;overflow:hidden}
.ghead{display:flex;align-items:baseline;gap:12px;padding:14px 18px;background:#faf9f6;border-bottom:1px solid #eeebe5}
.gname{font-size:20px}
.gmeta{margin-left:auto;font-size:15px;color:#a09c95}
.stage{display:flex;align-items:center;gap:14px;padding:11px 18px;border-bottom:1px solid #f5f3ef}
.stage:last-child{border-bottom:none}
.sleft{flex:1;min-width:0}.sname{font-size:17px}
.sname .diff{font-size:12px;color:#8a867f;margin-left:9px;border:1px solid #e0ddd6;border-radius:4px;padding:1px 6px}
.sdate{font-size:13px;color:#b3aea6;margin-top:4px}
.stime{width:112px;text-align:right;font-size:20px;flex:none}.stime .none{font-size:14px;color:#c4bfb6}
.sline{display:flex;gap:6px;flex:none}
.unit{position:relative;width:48px;height:48px}
.unit img{width:48px;height:48px;border-radius:8px;object-fit:cover;background:#eeece8;display:block}
.unit .lv{position:absolute;left:0;bottom:0;background:rgba(26,26,26,.78);color:#fff;font-size:12px;padding:0 5px;border-radius:0 0 0 8px;line-height:18px}
.unit .r6{position:absolute;right:0;top:0;width:7px;height:7px;background:#e8552f;border-radius:0 8px 0 8px}
`;
const EXTRA_GEAR = `
.list{background:#fff;border:1px solid #e6e3dd;border-radius:9px;margin-top:13px;overflow:hidden}
.ch{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid #f2f0eb}
.ch:last-child{border-bottom:none}.ch:nth-child(even){background:#fcfbf9}
.who{display:flex;align-items:center;gap:11px;width:210px;flex:none}
.cav{width:46px;height:46px;border-radius:8px;object-fit:cover;background:#eeece8;flex:none}
.cname{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cname .st{font-size:12px;color:#e8552f;margin-left:6px}
.cmeta{font-size:12px;color:#a09c95;margin-top:3px;white-space:nowrap}
.gear{display:flex;gap:8px;flex:1}
.slot{width:calc(16.66% - 7px);display:flex;flex-direction:column;align-items:center;gap:5px}
.sicon{width:42px;height:42px;object-fit:contain;background:#f6f4f0;border:1px solid #eae7e1;border-radius:7px}
.stxt{width:100%;text-align:center}
.stxt b{display:block;font-size:12px;font-weight:400;color:#3a3833;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stxt span{display:block;font-size:11px;color:#b3aea6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

const headOf = (detail) => `<div class="head">
  <div><h1>${esc(detail.base?.name)} <b>·</b> 抽卡分析</h1>
  <div class="sub">明日方舟：终末地　${esc(detail.base?.serverName || '官服')}　Lv.${detail.base?.level}　UID ${esc(detail.base?.roleId)}</div></div>
  <div class="stamp">${new Date().toLocaleString('zh-CN', { hour12: false })}<br>数据来源 森空岛</div>
</div>`;
const headNamed = (detail, title, right = '数据来源 森空岛') => `<div class="head">
  <div><h1>${esc(detail.base?.name)} <b>·</b> ${title}</h1>
  <div class="sub">明日方舟：终末地　${esc(detail.base?.serverName || '官服')}　Lv.${detail.base?.level}　UID ${esc(detail.base?.roleId)}</div></div>
  <div class="stamp">${new Date().toLocaleString('zh-CN', { hour12: false })}<br>${right}</div>
</div>`;

/** 抽卡分析（角色池 / 武器池分开，按卡池期次分区 + 横向条形）*/
export async function renderGachaCard({ detail, pools }, { name = 'gacha' } = {}) {
  const all = Object.values(pools ?? {}).flat();
  if (!all.length) throw new Error('没有抽卡记录');
  const icons = await ensureWeaponIcons(all);
  const groups = new Map();
  for (const [poolKey, list] of Object.entries(pools)) {
    for (const r of list ?? []) {
      const n = r.poolName || poolKey;
      if (!groups.has(n)) groups.set(n, { name: n, key: poolKey, recs: [] });
      groups.get(n).recs.push(r);
    }
  }
  const analyze = (recs) => {
    const sorted = [...recs].sort((a, b) => Number(a.gachaTs) - Number(b.gachaTs));
    let since = 0; const six = [];
    for (const r of sorted) { if (Number(r.rarity) === 6) { six.push({ ...r, pulls: since + 1 }); since = 0; } else since++; }
    return { total: sorted.length, six, pity: since, lastTs: Number(sorted.at(-1)?.gachaTs ?? 0) };
  };
  const plist = [...groups.values()].map((x) => ({ ...x, ...analyze(x.recs) })).filter((x) => x.total > 0);
  const isWeapon = (p) => p.key === 'weapon';
  const TIER = [[20, 'lucky', '超欧'], [35, 'good', '欧'], [60, 'mid', '正常'], [79, 'bad', '非'], [999, 'worst', '超非']];
  const row = (s, wp) => {
    const nm = s.charName || s.weaponName || s.nameText || '?';
    const img = wp ? icons[nm] : null;
    const [cls, label] = TIER.find(([m]) => s.pulls <= m).slice(1);
    const w = Math.min(100, (s.pulls / 90) * 100).toFixed(1);
    return `<div class="row">${img ? `<img class="av" src="${img}">` : '<div class="av"></div>'}
      <div class="track"><div class="fill ${cls}" style="width:${w}%"></div><span class="val">${s.pulls}</span></div>
      <div class="tag ${cls}">${label}</div><div class="name">${esc(nm)}${s.isNew ? '<i>NEW</i>' : ''}</div></div>`;
  };
  const block = (p) => `<div class="pool ${isWeapon(p) ? 'wp' : ''}">
    <div class="phead"><span class="pname">${esc(p.name)}</span><span class="pmeta">合计 <b>${p.total}</b> 抽 · 6★ <b>${p.six.length}</b> · 水位 <b>${p.pity}</b></span></div>
    <div class="rows">${p.six.map((s) => row(s, isWeapon(p))).join('') || '<div class="empty">本期无 6★</div>'}</div></div>`;
  const charPools = plist.filter((p) => !isWeapon(p)).sort((a, b) => b.lastTs - a.lastTs);
  const wpPools = plist.filter(isWeapon).sort((a, b) => b.lastTs - a.lastTs);
  const sixTotal = all.filter((r) => Number(r.rarity) === 6).length;
  const five = all.filter((r) => Number(r.rarity) === 5).length;
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BASE_CSS}${EXTRA_GACHA}</style></head><body>
${headOf(detail)}
<div class="top">
  <div class="stat hi"><div class="k">总抽数</div><div class="v">${all.length}</div></div>
  <div class="stat"><div class="k">6★ / 5★</div><div class="v">${sixTotal}<small> / </small>${five}</div></div>
  <div class="stat hi"><div class="k">出率</div><div class="v">${((sixTotal / all.length) * 100).toFixed(2)}<small>%</small></div></div>
  <div class="stat"><div class="k">平均出货</div><div class="v">${(all.length / sixTotal).toFixed(1)}<small> 抽</small></div></div>
</div>
<div class="legend">
  <span><i style="background:#5ecf96"></i>≤20 超欧</span><span><i style="background:#9ed466"></i>21-35 欧</span>
  <span><i style="background:#f5c542"></i>36-60 正常</span><span><i style="background:#f5a05a"></i>61-79 非</span>
  <span><i style="background:#ee6455"></i>≥80 超非</span><span style="color:#c4bfb6">条形满格 = 90 抽</span>
</div>
<div class="psec"><h2>角色池<i>${charPools.reduce((a, p) => a + p.total, 0)} 抽 · ${charPools.length} 期</i></h2>${charPools.map(block).join('')}</div>
<div class="psec"><h2>武器池<i>${wpPools.reduce((a, p) => a + p.total, 0)} 抽 · ${wpPools.length} 期</i></h2>${wpPools.map(block).join('')}</div>
<div class="foot">数据来源：森空岛　·　按卡池期次分区，每行 = 一个 6★ 及其消耗抽数　·　6★ 基础 0.8%｜80 抽硬保底｜65 抽后每抽 +5%｜UP 占 50%</div>
</body></html>`;
  return await renderHtmlToPng(html, name);
}

/** 战绩：影拓丰碑 + 战争回响（各一张，含最佳通关用时与四人阵容）*/
export async function renderBattleCards({ detail, indieHard, warEchoes }, { tag = '' } = {}) {
  const mmss = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.round(n % 60)).padStart(2, '0')}` : null; };
  const lineup = (rec) => (rec?.chars ?? []).map((c) => `<div class="unit"><img src="${esc(c.avatarUrl)}" onerror="this.style.visibility='hidden'"><span class="lv">${c.level}</span>${Number(c.rarity?.value) === 6 ? '<i class="r6"></i>' : ''}</div>`).join('');
  const stage = (nm, diff, x) => {
    const rec = x?.bestRecord ?? null;
    const t = mmss(rec?.passTs);
    const status = t ? `⏱ ${t}` : (x?.isPass ? '<span class="none">已通关</span>' : '<span class="none">未通关</span>');
    return `<div class="stage"><div class="sleft"><div class="sname">${esc(nm)}${diff ? `<span class="diff">${diff}</span>` : ''}</div><div class="sdate">${rec ? day(rec.ts) : ''}</div></div><div class="stime">${status}</div><div class="sline">${rec ? lineup(rec) : ''}</div></div>`;
  };
  const groups = (indieHard?.indieHardGroups ?? []).map((g) => {
    const rows = [];
    for (const d of g.dungeonGroups ?? []) {
      if (d.normalDungeon) rows.push(stage(d.normalDungeon.name, '普通', d.normalDungeon));
      if (d.hardDungeon) rows.push(stage(d.hardDungeon.name, '苦难', d.hardDungeon));
    }
    return `<div class="grp"><div class="ghead"><span class="gname">${esc(g.name)}</span><span class="gmeta">${rows.length} 关</span></div>${rows.join('')}</div>`;
  }).join('');
  const html1 = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BASE_CSS}${EXTRA_BATTLE}</style></head><body>
${headNamed(detail, '战绩 · 影拓丰碑')}
<div class="sec"><h2>影拓丰碑<i>${(indieHard?.indieHardGroups ?? []).length} 个系列 · 含最佳通关用时与阵容</i></h2>${groups}</div>
<div class="foot">⏱ 为最佳通关用时（mm:ss）　·　头像左下角是等级、右上橙点表示 6★　·　数据来源：森空岛</div></body></html>`;

  const weeks = (warEchoes?.seasons ?? []).map((s) => {
    const wks = (s.weeks ?? []).map((w) => {
      const rows = [];
      for (const d of w.dungeonGroups ?? []) {
        for (const [k, label] of [['normalDungeon', '普通'], ['hardDungeon', '苦难'], ['cruelDungeon', '极难']]) {
          if (d[k]?.bestRecord) rows.push(stage(d.name, label, d[k]));
        }
      }
      return rows.length ? `<div class="stage" style="background:#fcfbf9;font-size:16px;color:#4a4741"><div class="sleft">${esc(w.name)}　<span style="font-size:13px;color:#b3aea6">${day(w.startTs)} ~ ${day(w.endTs)}</span></div><div class="stime" style="color:#e8a33d">★ ${w.stars}</div></div>${rows.join('')}` : '';
    }).join('');
    return wks ? `<div class="grp"><div class="ghead"><span class="gname">${esc(s.name)}</span><span class="gmeta">${day(s.startTs)} ~ ${day(s.endTs)}</span></div>${wks}</div>` : '';
  }).join('');
  const html2 = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BASE_CSS}${EXTRA_BATTLE}</style></head><body>
${headNamed(detail, '战绩 · 战争回响')}
<div class="sec"><h2>战争回响<i>仅列接口返回了最佳记录的关卡</i></h2>${weeks || '<div class="empty">暂无记录</div>'}</div>
<div class="foot">⏱ 为最佳通关用时（mm:ss）　·　当前赛季接口通常无记录，此处多为已结算赛季　·　数据来源：森空岛</div></body></html>`;

  const pngs = [await renderHtmlToPng(html1, `battle1${tag ? '-' + tag : ''}`)];
  if (weeks) pngs.push(await renderHtmlToPng(html2, `battle2${tag ? '-' + tag : ''}`));
  return pngs;
}

const EXTRA_CHARS = `
.grid{display:flex;flex-wrap:wrap;gap:11px;margin-top:13px}
.chr{width:calc(50% - 6px);background:#fff;border:1px solid #e6e3dd;border-radius:9px;padding:13px 15px;display:flex;gap:13px;align-items:center;border-left:4px solid #ddd9d2}
.chr.r6{border-left-color:#e8552f}.chr.r5{border-left-color:#5b8def}
.chr img{width:58px;height:58px;object-fit:cover;background:#eeece8;border-radius:9px;flex:none}
.cb{min-width:0;flex:1}
.cn{font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cn .star{font-size:12px;color:#e8552f;margin-left:7px}
.chr.r5 .cn .star{color:#5b8def}.chr.r4 .cn .star{color:#a09c95}
.ci{font-size:13px;color:#87837c;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw2{font-size:13px;color:#4a4741;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw2 b{color:#3da97a;font-weight:400;margin-left:7px}
`;

/** 角色图鉴（全部角色，含稀有度/职业/等级/精英化/潜能/武器）*/
export async function renderCharsCard(detail, { name = 'chars' } = {}) {
  const chars = [...(detail.chars ?? [])].sort((a, b) =>
    (Number(b.charData?.rarity?.value ?? 0) - Number(a.charData?.rarity?.value ?? 0))
    || ((b.level ?? 0) - (a.level ?? 0)) || ((b.evolvePhase ?? 0) - (a.evolvePhase ?? 0)));
  const card = (c) => {
    const cd = c.charData ?? {};
    const r = Number(cd.rarity?.value ?? 4);
    return `<div class="chr r${r}"><img src="${esc(cd.avatarSqUrl)}" onerror="this.style.visibility='hidden'">
      <div class="cb"><div class="cn">${esc(cd.name)}<span class="star">${r}★</span></div>
      <div class="ci">${esc(cd.profession?.value ?? '')}　${esc(cd.property?.value ?? '')}</div>
      <div class="ci">Lv.${c.level}　精英${c.evolvePhase}　潜能${c.potentialLevel}</div>
      <div class="cw2">${esc(c.weapon?.weaponData?.name ?? '—')}<b>Lv.${c.weapon?.level ?? '?'}</b></div></div></div>`;
  };
  const groups = [6, 5, 4].map((r) => ({ r, list: chars.filter((c) => Number(c.charData?.rarity?.value) === r) }));
  const avg = (l) => l.length ? (l.reduce((a, x) => a + (x.level ?? 0), 0) / l.length).toFixed(1) : '—';
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BASE_CSS}${EXTRA_CHARS}</style></head><body>
${headNamed(detail, '角色图鉴', `共 ${chars.length} 名角色`)}
<div class="top">
  ${groups.map((g, i) => `<div class="stat ${i === 0 ? 'hi' : ''}"><div class="k">${g.r}★ 角色</div><div class="v">${g.list.length}</div></div>`).join('')}
  <div class="stat"><div class="k">6★ 平均等级</div><div class="v">${avg(groups[0].list)}</div></div>
</div>
${groups.filter((g) => g.list.length).map((g) => `<div class="sec"><h2>${g.r}★ 干员<i>${g.list.length} 名</i></h2><div class="grid">${g.list.map(card).join('')}</div></div>`).join('')}
<div class="foot">数据来源：森空岛　·　装备与战术物品见「角色装备」图</div></body></html>`;
  return await renderHtmlToPng(html, name);
}

/** 角色装备（武器 + 护甲 + 臂甲 + 两配件 + 战术物品）*/
export async function renderGearCard(detail, { name = 'gear' } = {}) {
  const chars = [...(detail.chars ?? [])].sort((a, b) =>
    (Number(b.charData?.rarity?.value ?? 0) - Number(a.charData?.rarity?.value ?? 0)) || ((b.level ?? 0) - (a.level ?? 0)));
  const slot = (kind, nm, sub, icon) => (!nm
    ? `<div class="slot"><div class="sicon" style="opacity:.3"></div><div class="stxt"><b>—</b><span>${kind}</span></div></div>`
    : `<div class="slot"><img class="sicon" src="${esc(icon)}" onerror="this.style.visibility='hidden'"><div class="stxt"><b>${esc(nm)}</b><span>${esc(sub)}</span></div></div>`);
  const rows = chars.map((c) => {
    const cd = c.charData ?? {}, w = c.weapon ?? {}, wd = w.weaponData ?? {};
    const eq = (o) => o?.equipData ?? {};
    const body = eq(c.bodyEquip), arm = eq(c.armEquip), a1 = eq(c.firstAccessory), a2 = eq(c.secondAccessory);
    const tac = c.tacticalItem?.tacticalItemData ?? {};
    return `<div class="ch"><div class="who"><img class="cav" src="${esc(cd.avatarSqUrl)}" onerror="this.style.visibility='hidden'">
      <div><div class="cname">${esc(cd.name)}<span class="st">${cd.rarity?.value ?? ''}★</span></div>
      <div class="cmeta">${esc(cd.profession?.value ?? '')} · Lv.${c.level}</div><div class="cmeta">精英${c.evolvePhase} · 潜能${c.potentialLevel}</div></div></div>
      <div class="gear">
        ${slot('武器', wd.name, `Lv.${w.level ?? '?'}${w.refineLevel ? ' · 精炼' + w.refineLevel : ''}`, wd.iconUrl)}
        ${slot('护甲', body.name, body.level?.value ?? '', body.iconUrl)}
        ${slot('臂甲', arm.name, arm.level?.value ?? '', arm.iconUrl)}
        ${slot('配件', a1.name, a1.level?.value ?? '', a1.iconUrl)}
        ${slot('配件', a2.name, a2.level?.value ?? '', a2.iconUrl)}
        ${slot('战术', tac.name, tac.rarity?.value ? `${tac.rarity.value}★` : '', tac.iconUrl)}
      </div></div>`;
  }).join('');
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${BASE_CSS}${EXTRA_GEAR}</style></head><body>
${headNamed(detail, '角色装备', `共 ${chars.length} 名角色`)}
<div class="sec"><h2>当前装备<i>武器 · 护甲 · 臂甲 · 配件 ×2 · 战术物品</i></h2><div class="list">${rows}</div></div>
<div class="foot">数据来源：森空岛　·　按稀有度与等级排序</div></body></html>`;
  return await renderHtmlToPng(html, name);
}
