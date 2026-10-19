// 终末地（森空岛）API 客户端 —— 纯数据层，不含出图逻辑
// 所有接口与签名规则均于 2026-10-04 实测通过；踩过的坑写在对应位置，别照"看起来更规范"的写法改。
import crypto from 'node:crypto';

const APP_CODE = '4ca99fa6b56cc2ba';       // 国服鹰角通行证
const WEB_APP_CODE = 'be36d44aa36bfb5b';   // 拿 web_token 用
const UA = 'Skland/1.32.1 (com.hypergryph.skland; build:103201004; Android 33; ) Okhttp/4.11.0';
const AS = 'https://as.hypergryph.com';
const ZONAI = 'https://zonai.skland.com';
const BINDING_API = 'https://binding-api-account-prod.hypergryph.com';
const EF_WEBVIEW = 'https://ef-webview.hypergryph.com';
const TOKEN_TTL_MS = 30 * 60 * 1000;       // cred 是每次现换的短命凭证，缓存 30 分钟

export const ENDFIELD_APP_CODE = APP_CODE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => (s ? String(s).slice(0, 6) + '…' : '');

async function req(url, { method = 'GET', body, headers = {}, timeout = 25000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!json) throw new Error(`终末地接口返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 120)}`);
  return json;
}

// ---------------- 扫码绑定 ----------------
export async function genQrCode() {
  const r = await req(`${AS}/general/v1/gen_scan/login`, { method: 'POST', body: { appCode: APP_CODE } });
  // ⚠️ 这个接口的返回里**没有 code 字段**，只能按真实字段判断（照抄插件时的第一坑）
  if (!r?.data?.scanId) throw new Error('生成二维码失败：' + JSON.stringify(r).slice(0, 200));
  return r.data; // { scanId, scanUrl }  scanUrl 形如 hypergryph://scan_login?scanId=...
}

export async function checkQrStatus(scanId) {
  const r = await req(`${AS}/general/v1/scan_status?scanId=${encodeURIComponent(scanId)}`);
  return r; // status: 100 未扫码 / 101 已扫待确认 / 0 成功(data.scanCode) / 102 失效
}

/** 轮询直到扫码成功；返回 token（长期凭证）。timeoutMs 内未成功则抛错。 */
export async function waitForScan(scanId, { timeoutMs = 170000, intervalMs = 4000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const st = await checkQrStatus(scanId);
    if (st.status !== last) { last = st.status; onTick?.(st); }
    if (st.status === 0) return await tokenByScanCode(st.data?.scanCode);
    if (st.status === 102) throw new Error('二维码已失效');
  }
  throw new Error('二维码超时未扫描');
}

export async function tokenByScanCode(scanCode) {
  const r = await req(`${AS}/user/auth/v1/token_by_scan_code`, { method: 'POST', body: { scanCode } });
  const token = r?.data?.token;
  if (!token) throw new Error('换取 token 失败：' + JSON.stringify(r).slice(0, 200));
  return token;
}

// ---------------- 登录态（token → cred / signToken / 角色信息）----------------
function signSkland(signToken, pathname, query = '') {
  const timestamp = String(Math.floor(Date.now() / 1000) - 10); // ⚠️ 故意减 10 秒，别"修正"它
  const sh = { platform: '', timestamp, dId: '', vName: '' };
  const h = crypto.createHmac('sha256', signToken).update(pathname + query + timestamp + JSON.stringify(sh)).digest('hex');
  return { sign: crypto.createHash('md5').update(h).digest('hex'), ...sh };
}

function sklandHeaders(cred, signToken, pathname, query = '') {
  return {
    cred,
    'User-Agent': UA,
    'Accept-Encoding': 'gzip',
    Connection: 'close',
    'Content-Type': 'application/json; charset=UTF-8',
    ...signSkland(signToken, pathname, query),
    // ⚠️ 不要传 sk-language：传 'zh-cn' 会 fallback 成英文，不传才是中文
  };
}

export async function exchangeCred(token) {
  const g = await req(`${AS}/user/oauth2/v2/grant`, { method: 'POST', body: { appCode: APP_CODE, token, type: 0 } });
  const code = g?.data?.code;
  if (!code) throw new Error('grant 失败：' + JSON.stringify(g).slice(0, 200));
  const c = await req(`${ZONAI}/api/v1/user/auth/generate_cred_by_code`, { method: 'POST', body: { code, kind: 1 } });
  const cred = c?.data?.cred;
  const signToken = c?.data?.token;
  if (!cred || !signToken) throw new Error('换 cred 失败：' + JSON.stringify(c).slice(0, 200));
  return { cred, signToken };
}

/** 解析出这个 token 对应的终末地角色（roleId/serverId/uid/userId/昵称） */
export async function resolveProfile(token) {
  const { cred, signToken } = await exchangeCred(token);
  const bind = await req(`${ZONAI}/api/v1/game/player/binding`, { headers: sklandHeaders(cred, signToken, '/api/v1/game/player/binding') });
  const app = (bind?.data?.list ?? []).find((a) => a.appCode === 'endfield');
  if (!app) throw new Error('该账号没有绑定终末地角色');
  const b = app.bindingList[0];
  const role = b.defaultRole ?? b.roles?.[0] ?? {};
  const teen = await req(`${ZONAI}/api/v1/user/teenager`, { headers: sklandHeaders(cred, signToken, '/api/v1/user/teenager') });
  const userId = teen?.data?.teenager?.userId;
  if (!userId) throw new Error('取账号信息失败：' + JSON.stringify(teen).slice(0, 200));
  return {
    cred, signToken,
    roleId: role.roleId, serverId: role.serverId, uid: b.uid, userId,
    nickname: role.nickname ?? role.nickName ?? '', channel: b.channelName ?? '',
    skGameRole: `3_${role.roleId}_${role.serverId}`,
    fetchedAt: Date.now(),
  };
}

/** 会话缓存：同 token 30 分钟内复用 cred（cred 是短命凭证，别持久化） */
const profileCache = new Map();
export async function getProfile(token, { force = false } = {}) {
  const hit = profileCache.get(token);
  if (!force && hit && Date.now() - hit.fetchedAt < TOKEN_TTL_MS) return hit;
  const p = await resolveProfile(token);
  profileCache.set(token, p);
  return p;
}
export function dropProfileCache(token) { profileCache.delete(token); }

function gameHeaders(p, pathname, query = '') {
  return {
    ...sklandHeaders(p.cred, p.signToken, pathname, query),
    'sk-game-role': p.skGameRole,
  };
}

// ---------------- 拉数据 ----------------
const q3 = (p) => new URLSearchParams({ roleId: String(p.roleId), serverId: String(p.serverId), userId: String(p.userId) }).toString();

/** 账号总览（角色/据点/成就/战争回响/影拓丰碑 概要） */
export async function fetchCardDetail(p) {
  const path = '/web/v1/game/endfield/card/detail';
  const q = q3(p);
  const r = await req(`${ZONAI}${path}?${q}`, { headers: gameHeaders(p, path, q) });
  if (!r?.data?.detail) throw new Error('取账号总览失败：' + JSON.stringify(r).slice(0, 200));
  return r.data.detail;
}

/** 影拓丰碑（含每关最佳通关用时 bestRecord.passTs 与四人阵容）*/
export async function fetchIndieHard(p) {
  const path = '/web/v1/game/endfield/card/indie-hard';
  const q = q3(p);
  const r = await req(`${ZONAI}${path}?${q}`, { headers: gameHeaders(p, path, q) });
  if (!r?.data?.indieHard) throw new Error('取影拓丰碑失败：' + JSON.stringify(r).slice(0, 200));
  return r.data.indieHard;
}

/** 战争回响（赛季/周/关卡 + bestRecord；⚠️ 当前赛季通常是 null，只有已结算赛季才有）*/
export async function fetchWarEchoes(p) {
  const path = '/web/v1/game/endfield/card/war-echoes';
  const q = q3(p);
  const r = await req(`${ZONAI}${path}?${q}`, { headers: gameHeaders(p, path, q) });
  if (!r?.data?.warEchoes) throw new Error('取战争回响失败：' + JSON.stringify(r).slice(0, 200));
  return r.data.warEchoes;
}

/** 角色/武器/装备拥有情况 */
export async function fetchUserGameData(p) {
  const path = '/web/v1/game/endfield/team/user-game-data';
  const r = await req(`${ZONAI}${path}`, { headers: gameHeaders(p, path) });
  if (!r?.data?.userGameData) throw new Error('取角色装备失败：' + JSON.stringify(r).slice(0, 200));
  return r.data.userGameData;
}

// ---------------- 抽卡记录（另一套域名，且 token 要换成 roleToken）----------------
const POOLS = [
  { key: 'standard', type: 'E_CharacterGachaPoolType_Standard', api: 'char' },
  { key: 'special', type: 'E_CharacterGachaPoolType_Special', api: 'char' },
  { key: 'beginner', type: 'E_CharacterGachaPoolType_Beginner', api: 'char' },
  { key: 'joint', type: 'E_CharacterGachaPoolType_Joint', api: 'char' },
  { key: 'weapon', type: '', api: 'weapon' },
];

/** 拉全量抽卡记录；existing 传上次的结果可做增量（遇到已见过的 seqId 就停） */
export async function fetchGacha(p, { existing = null, onProgress } = {}) {
  const g = await req(`${AS}/user/oauth2/v2/grant`, { method: 'POST', body: { appCode: WEB_APP_CODE, token: p.__token, type: 1 } });
  const webToken = g?.data?.token;
  if (!webToken) throw new Error('取 web_token 失败');
  const rt = await req(`${BINDING_API}/account/binding/v1/u8_token_by_uid`, { method: 'POST', body: { uid: p.uid, token: webToken } });
  const roleToken = rt?.data?.token;
  if (!roleToken) throw new Error('取 roleToken 失败');

  const out = {};
  for (const pool of POOLS) {
    const seen = new Set((existing?.[pool.key] ?? []).map((x) => String(x.seqId)));
    const minSeq = existing?.[pool.key]?.length ? Math.min(...(existing[pool.key]).map((x) => Number(x.seqId) || Infinity)) : 0;
    const all = [];
    let seq = null;
    for (let i = 0; i < 400; i++) {
      const params = new URLSearchParams({ token: roleToken, server_id: String(p.serverId), lang: 'zh-cn', pool_type: pool.type });
      if (seq) params.set('seq_id', seq);
      const r = await req(`${EF_WEBVIEW}/api/record/${pool.api}?${params}`);
      const list = r?.data?.list ?? [];
      if (!list.length) break;
      if (existing && minSeq) {
        const fresh = list.filter((x) => !seen.has(String(x.seqId)));
        all.push(...fresh);
        if (fresh.length !== list.length) break; // 碰到旧记录即停
      } else {
        all.push(...list);
      }
      if (!r.data.hasMore) break;
      seq = list[list.length - 1].seqId;
      await sleep(320); // ⚠️ 森空岛短时间多次请求会 Unauthorized，必须带延迟
    }
    out[pool.key] = all;
    onProgress?.(pool.key, all.length);
  }
  return out;
}

/** 给 fetchGacha 用：把 token 挂到 profile 上（避免每次传两个参数）*/
export function withToken(p, token) { return { ...p, __token: token }; }

export function formatDuration(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.round(n % 60)).padStart(2, '0')}`;
}
