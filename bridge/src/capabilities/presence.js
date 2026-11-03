// 能力四：有对外的生活痕迹（头像 / 签名 / 空间及空间互动）
//
// task-0002 修复：
// - dry-run 也结算 gate（额度 + 审计），不会无限演练；
// - dryRun 判定只有一处（gate.effectiveDryRun），界面与执行读同一个值；
// - 增加后台自动计划：每个目标每天最多一次，经同一 gate，演练模式只记录；
// - 空间点赞/评论做成可配置 action 的适配，协议不支持时如实标 unsupported；
// - 头像备份失败不阻止动作，但会记录 backup 失败原因，状态里可查；
// - 发布内容只能来自公开活动证据，不引用群聊/私聊原文。
import fs from 'node:fs';
import path from 'node:path';
import { dayKey } from './config.js';

export function createPresence({ db, config, gate, now = Date.now, log = () => {}, onebot, fetchBuffer, root }) {
  const cfg = () => config().presence || {};
  const backupDir = path.join(root, 'state', 'capability-backups');

  function metaGet(key) {
    return db.prepare('SELECT value FROM cap_meta WHERE key=?').get(key)?.value ?? null;
  }
  function metaSet(key, value) {
    db.prepare('INSERT INTO cap_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  }
  function protocol() {
    try { return JSON.parse(metaGet('presence_protocol') || '{}'); } catch { return {}; }
  }
  function setProtocol(patch) {
    metaSet('presence_protocol', JSON.stringify({ ...protocol(), ...patch, probedAt: now() }));
  }
  function markCapability(kind, status, reason) {
    const p = protocol();
    setProtocol({ capabilities: { ...(p.capabilities || {}), [kind]: status }, [`${kind}Reason`]: reason || null });
  }

  /** 只读探测：不产生对外痕迹。 */
  async function probe() {
    if (typeof onebot !== 'function') return { ok: false, error: 'onebot_adapter_missing' };
    const result = { ok: false, read: {}, actions: {} };
    for (const action of ['get_status', 'get_version_info', 'get_login_info']) {
      try { result.read[action] = await onebot(action, {}); }
      catch (error) { result.read[action] = { error: String(error?.message ?? error).slice(0, 200) }; }
    }
    const info = result.read.get_version_info || {};
    const login = result.read.get_login_info || {};
    const p = cfg().protocol || {};
    result.ok = !Object.values(result.read).every((x) => x && x.error);
    for (const [name, action] of Object.entries({
      avatar: p.avatarAction, signature: p.profileAction, qzone: p.qzoneAction,
      qzoneLike: p.qzoneLikeAction, qzoneComment: p.qzoneCommentAction
    })) {
      if (!action) { result.actions[name] = 'unconfigured'; continue; }
      const prev = protocol().capabilities?.[name];
      // 历史数据可能存成字符串（task-0002 之前），对象/字符串都要能读，不能把已知能力重置成 unknown
      const prevStatus = typeof prev === 'string' ? prev : prev?.status;
      result.actions[name] = prevStatus === 'supported' ? 'supported' : prevStatus === 'unsupported' ? 'unsupported' : 'unknown';
    }
    setProtocol({
      adapter: String(info.app_name || info.appName || info.name || '').slice(0, 60),
      version: String(info.app_version || info.version || '').slice(0, 60),
      uin: String(login.user_id || ''),
      capabilities: result.actions,
      readOk: result.ok
    });
    return result;
  }

  function record({ kind, status, payload, response, error }) {
    const id = `p-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    db.prepare('INSERT INTO cap_presence(id,kind,status,payload,response,error,created_at,applied_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, kind, status, payload ? JSON.stringify(payload) : null,
        response ? JSON.stringify(response).slice(0, 4000) : null, error ? String(error).slice(0, 500) : null,
        now(), status === 'applied' ? now() : null);
    return id;
  }

  async function captureAvatarBackup(uin) {
    if (typeof fetchBuffer !== 'function') return { ok: false, error: 'fetch_unavailable' };
    const id = String(uin || protocol().uin || '');
    if (!id) return { ok: false, error: 'unknown_uin' };
    const url = `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(id)}&s=640`;
    try {
      const buf = await fetchBuffer(url, { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
      fs.mkdirSync(backupDir, { recursive: true });
      const file = path.join(backupDir, `avatar-${now()}.png`);
      fs.writeFileSync(file, buf);
      db.prepare('INSERT INTO cap_presence_backup(kind,backup_path,value,captured_at) VALUES(?,?,?,?) ON CONFLICT(kind) DO UPDATE SET backup_path=excluded.backup_path,value=excluded.value,captured_at=excluded.captured_at')
        .run('avatar', file, url, now());
      return { ok: true, file, url };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
    }
  }

  function restoreAvatar(actor = 'admin') {
    const row = db.prepare('SELECT * FROM cap_presence_backup WHERE kind=?').get('avatar');
    if (!row?.backup_path || !fs.existsSync(row.backup_path)) return { ok: false, error: 'no_avatar_backup' };
    return run('avatar', { file: row.backup_path }, { actor, restore: true });
  }

  /** 只允许用**显式发布许可**（publish_ok=1）的公开活动证据；群/私聊兴趣不能混进来。 */
  function composeFromEvidence() {
    const row = db.prepare("SELECT topic,evidence FROM cap_activity_job WHERE status='done' AND publish_ok=1 AND evidence IS NOT NULL ORDER BY finished_at DESC LIMIT 1").get();
    if (!row) return null;
    let ev;
    try { ev = JSON.parse(row.evidence); } catch { return null; }
    const first = ev.items?.[0];
    if (!first) return null;
    const title = String(first.title || '').trim();
    if (!title) return null;
    return { text: `最近在看：${title}`, sourceTopic: row.topic, sourceTitle: title, trust: 'public_activity_publish_ok' };
  }

  function actionFor(kind) {
    const p = cfg().protocol || {};
    return kind === 'avatar' ? p.avatarAction
      : kind === 'signature' ? p.profileAction
        : kind === 'qzone' ? p.qzoneAction
          : kind === 'qzone_like' ? p.qzoneLikeAction
            : kind === 'qzone_comment' ? p.qzoneCommentAction
              : null;
  }

  /** 本机路径转成 SnowLuma image 参数可接受的 file:// 引用；已是 URL/base64 的原样返回。 */
  function imageRef(file) {
    const s = String(file || '').trim();
    if (!s) return s;
    if (/^(file|https?|base64):\/\//i.test(s) || s.startsWith('data:')) return s;
    try {
      const abs = path.resolve(s).replace(/\\/g, '/');
      return 'file:///' + abs.replace(/^\/+/, '');
    } catch { return s; }
  }

  /**
   * 真实 OneBot/SnowLuma action 参数（按已安装 snowluma 的 action 定义适配）：
   * - set_qq_profile: {nickname?, personal_note?, sex?}
   * - set_qq_avatar: {file}
   * - send_qzone_msg: {content, images?, ugc_right, target_uins?}
   * - like_qzone: {tid, target_uin?, abstime}
   * - comment_qzone: {tid, content, target_uin?, images?}
   */
  function paramsFor(kind, payload) {
    const text = String(payload.text || '');
    return kind === 'avatar'
      ? { file: imageRef(payload.file) }
      : kind === 'signature'
        ? { personal_note: text, nickname: payload.nickname }
        : kind === 'qzone'
          ? {
            content: text,
            ...(Array.isArray(payload.images) && payload.images.length ? { images: payload.images.map(imageRef) } : {}),
            ugc_right: Number(payload.ugcRight) || 1,
            ...(Array.isArray(payload.targetUins) && payload.targetUins.length ? { target_uins: payload.targetUins } : {})
          }
          : kind === 'qzone_like'
            ? { tid: String(payload.tid || payload.target || ''), ...(payload.uin ? { target_uin: payload.uin } : {}), abstime: Number(payload.abstime) || 0 }
            : { tid: String(payload.tid || payload.target || ''), content: text, ...(payload.uin ? { target_uin: payload.uin } : {}), ...(Array.isArray(payload.images) && payload.images.length ? { images: payload.images.map(imageRef) } : {}) };
  }

  /**
   * 执行一次对外动作（后台自动与管理端手动共用）。
   * @param {'avatar'|'signature'|'qzone'|'qzone_like'|'qzone_comment'} kind
   */
  async function run(kind, payload = {}, opts = {}) {
    const c = cfg();
    if (c.enabled === false) return { skipped: 'disabled' };
    if (c.targets?.[kind] === false) return { skipped: 'target_disabled' };

    // 全局限额：所有生活痕迹动作共用一个每日预算，和 status 里的说明一致。
    const globalPermit = gate.check({
      module: 'presence', action: 'total', actor: opts.actor || 'background', scope: null,
      perDay: Number(c.dailyBudget || 1), forceReal: opts.forceReal === true, dryRun: opts.dryRun === true
    });
    if (!globalPermit.ok) return { skipped: globalPermit.reason };

    const permit = gate.check({
      module: 'presence', action: kind, actor: opts.actor || 'background', scope: null,
      minIntervalMs: Number(c.minIntervalHours ?? 24) * 3600000,
      forceReal: opts.forceReal === true,
      dryRun: opts.dryRun === true
    });
    if (!permit.ok) { globalPermit.fail(`skipped:${permit.reason}`); return { skipped: permit.reason }; }

    const settleBoth = (result, detail) => {
      if (result === 'fail') { permit.fail(detail); globalPermit.fail(detail); }
      else { permit.commit(detail); globalPermit.commit(detail); }
    };

    const action = actionFor(kind);
    if (!action) {
      settleBoth('fail', 'action_unconfigured');
      return { error: 'action_unconfigured', reason: `未配置 ${kind} 对应的 OneBot action` };
    }

    // 签名/空间正文必须是真实可公开文本：没有发布许可的材料就不用。
    if (kind === 'signature' && !String(payload.text || '').trim()) {
      const composed = composeFromEvidence();
      if (!composed) {
        settleBoth('fail', 'no_public_material');
        return { error: 'no_public_material', reason: '没有带发布许可的公开活动材料，不自动改签名' };
      }
      payload = { ...payload, text: composed.text };
    }
    if ((kind === 'qzone' || kind === 'qzone_comment') && !payload.text) {
      const composed = composeFromEvidence();
      if (!composed) { settleBoth('fail', 'no_public_material'); return { error: 'no_public_material', reason: '没有可公开的活动证据，不发布' }; }
      payload = { ...payload, text: composed.text };
    }
    if ((kind === 'qzone_like' || kind === 'qzone_comment') && !payload.target && !payload.tid) {
      settleBoth('fail', 'no_target');
      return { error: 'no_target', reason: '空间互动需要指定目标动态' };
    }

    let backup = null;
    if (kind === 'avatar' && opts.restore !== true && opts.backupFirst !== false) {
      backup = await captureAvatarBackup(protocol().uin);
      if (!backup.ok) {
        log(`[capabilities] 头像备份失败：${backup.error}`);
        // 真实更换必须有可还原备份；备份失败就阻止，不能“换了却还原不了”
        if (permit.dryRun !== true) {
          settleBoth('fail', 'avatar_backup_failed');
          const id = record({ kind, status: 'failed', payload: { ...payload }, error: `avatar_backup_failed:${backup.error}` });
          return { ok: false, id, error: 'avatar_backup_failed', reason: `头像备份失败（${backup.error}），已取消更换`, backup };
        }
      }
    }
    if (kind === 'avatar' && !payload.file) {
      const configured = String(c.avatarFile || '').trim();
      if (!configured) { settleBoth('fail', 'avatar_file_missing'); return { error: 'avatar_file_missing', reason: '未配置 presence.avatarFile' }; }
      payload = { ...payload, file: configured };
    }

    if (permit.dryRun) {
      // 演练也结算：额度被占用、审计留痕，不能无限演练
      settleBoth('ok', `dry-run:${kind}`);
      const id = record({ kind, status: 'dry-run', payload: { ...payload, backup }, error: 'dry_run' });
      return { ok: true, dryRun: true, id, action, backup, note: '演练模式：没有真正写入协议端' };
    }

    if (typeof onebot !== 'function') { settleBoth('fail', 'onebot_adapter_missing'); return { error: 'onebot_adapter_missing' }; }

    const params = paramsFor(kind, payload);

    try {
      const response = await onebot(action, params);
      settleBoth('ok', `${action}:ok`);
      markCapability(kind, 'supported', null);
      const id = record({ kind, status: 'applied', payload: { ...payload, backup }, response });
      return { ok: true, id, action, response, backup };
    } catch (error) {
      const message = String(error?.message ?? error);
      settleBoth('fail', message);
      const unsupported = /1404|404|unknown|not (found|implemented|support)|不支持|未实现/i.test(message);
      if (unsupported) markCapability(kind, 'unsupported', message.slice(0, 200));
      const id = record({ kind, status: 'failed', payload: { ...payload, backup }, error: message });
      return { ok: false, id, action, error: message, unsupported, backup };
    }
  }

  function planDone(kind) {
    return db.prepare('SELECT * FROM cap_presence_plan WHERE kind=? AND day=?').get(kind, dayKey(new Date(now())));
  }
  function planMark(kind, status, detail) {
    db.prepare(
      `INSERT INTO cap_presence_plan(kind,day,status,at,detail) VALUES(?,?,?,?,?)
       ON CONFLICT(kind,day) DO UPDATE SET status=excluded.status, at=excluded.at, detail=excluded.detail`
    ).run(kind, dayKey(new Date(now())), status, now(), detail ? String(detail).slice(0, 300) : null);
  }

  /**
   * 后台自动计划：全局每天最多一件（gate 的 presence:total 额度），演练也会占额度并审计。
   * 签名/空间正文只来自带发布许可的公开活动材料；没有材料就记录 blocked。
   */
  async function tick(actor = 'background') {
    const c = cfg();
    if (c.enabled === false) return { skipped: 'disabled' };
    const kinds = ['signature', 'qzone', 'qzone_like', 'qzone_comment', 'avatar'];
    const results = [];
    let ran = 0;
    for (const kind of kinds) {
      if (c.targets?.[kind] !== true) continue;
      if (planDone(kind)) continue;
      if (kind === 'avatar' && !String(c.avatarFile || '').trim()) { planMark(kind, 'blocked', 'avatar_file_missing'); results.push({ kind, skipped: 'avatar_file_missing' }); continue; }
      if (kind === 'qzone_like' || kind === 'qzone_comment') {
        const target = String(c.qzoneTarget || '').trim();
        if (!target) { planMark(kind, 'blocked', 'qzone_target_missing'); results.push({ kind, skipped: 'qzone_target_missing' }); continue; }
      }
      let payload = kind === 'avatar' ? {} : { target: kind.startsWith('qzone') ? String(c.qzoneTarget || '') : undefined };
      if (kind === 'signature' || kind === 'qzone') {
        const composed = composeFromEvidence();
        if (!composed) { planMark(kind, 'blocked', 'no_public_material'); results.push({ kind, skipped: 'no_public_material' }); continue; }
        payload = { ...payload, text: composed.text };
      }
      planMark(kind, 'running', null);
      const r = await run(kind, payload, { actor });
      planMark(kind, r.ok ? 'done' : (r.skipped || r.error || 'failed'), r.error || r.reason || null);
      results.push({ kind, ...r });
      ran++;
      break; // 全局每日额度是一件：成功/失败都不再继续下一个 kind
    }
    return { ran, results };
  }

  function status() {
    const c = cfg();
    const p = protocol();
    const rows = db.prepare('SELECT * FROM cap_presence ORDER BY created_at DESC LIMIT 10').all();
    const backup = db.prepare('SELECT * FROM cap_presence_backup WHERE kind=?').get('avatar') || null;
    const plans = db.prepare('SELECT * FROM cap_presence_plan WHERE day=?').all(dayKey(new Date(now())));
    return {
      enabled: c.enabled !== false,
      dryRun: gate.effectiveDryRun('presence'),
      // 全局每日预算（所有痕迹动作合计），与 run/tick 的 gate 键一致
      budget: { perDay: Number(c.dailyBudget || 1), used: gate.quotaUsed(`presence:total:${dayKey(new Date(now()))}`) },
      targets: c.targets || {},
      protocol: p,
      capabilities: p.capabilities || { avatar: 'unknown', signature: 'unknown', qzone: 'unknown' },
      backup: backup ? { path: backup.backup_path, capturedAt: backup.captured_at } : null,
      plans,
      recent: rows,
      dailyBudget: Number(c.dailyBudget || 1),
      minIntervalHours: Number(c.minIntervalHours ?? 24),
      note: gate.effectiveDryRun('presence') ? '当前是演练模式：动作只记录，不会真正改头像/签名/发空间' : null
    };
  }

  return { probe, run, tick, restoreAvatar, composeFromEvidence, status, protocol };
}
