// 统一动作闸门（task-0002 重写）：
// - 额度在 check() 里**事务性预留**（原子 upsert + WHERE used<limit），并发不会超发；
// - 支持 perDay 与 perHour（真实按小时窗口，不再用「每小时×6」冒充日额度）；
// - 演练模式与真实模式共用同一套结算：演练也占额度、写审计；
// - dryRun 语义只有一处定义（全局 OR 模块），状态界面与执行读同一个值；
// - 先写 reserved 审计，再结算 applied/dry-run/failed，崩溃后能看出“有一笔没回来”。
import crypto from 'node:crypto';
import { audit } from './store.js';
import { dayKey } from './config.js';

const TERMINAL = new Set(['applied', 'dry-run', 'failed']);

export function hourKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
}

export function createGate({ db, config, now = Date.now, log = () => {} }) {
  function moduleEnabled(module) {
    const cfg = config();
    if (cfg.enabled === false) return { ok: false, reason: 'capabilities_disabled' };
    const m = cfg[module];
    if (m && m.enabled === false) return { ok: false, reason: `${module}_disabled` };
    return { ok: true };
  }

  /** 唯一的演练判定：全局 dryRun 或模块 dryRun 任一为真，就是演练。 */
  function effectiveDryRun(module, cfg = config()) {
    return cfg.dryRun !== false || cfg[module]?.dryRun === true;
  }

  function quotaUsed(key) {
    return Number(db.prepare('SELECT used FROM cap_quota WHERE key=?').get(key)?.used || 0);
  }

  /** 原子预留一格额度；返回是否成功。并发/多进程都只会有一个成功。 */
  function reserve(key, limit, t) {
    if (!(limit > 0)) return true;
    const res = db.prepare(
      `INSERT INTO cap_quota(key,used,updated_at) VALUES(?,1,?)
       ON CONFLICT(key) DO UPDATE SET used=used+1, updated_at=excluded.updated_at
       WHERE used < ?`
    ).run(String(key), t, Number(limit));
    return Number(res.changes) > 0;
  }

  function lastTerminalAt(module, action, scope) {
    const row = db.prepare(
      `SELECT at FROM cap_action WHERE module=? AND action=? AND result IN ('applied','dry-run','failed')
         AND (? IS NULL OR scope IS NULL OR scope=?) ORDER BY at DESC LIMIT 1`
    ).get(module, action, scope ?? null, scope ?? null);
    return Number(row?.at || 0);
  }

  /**
   * @param {{module:string, action:string, actor?:'background'|'admin',
   *          scope?:string, perDay?:number, perHour?:number, minIntervalMs?:number,
   *          forceReal?:boolean, dryRun?:boolean}} req
   */
  function check(req) {
    const { module, action, actor = 'background', scope = null, perDay = 0, perHour = 0, minIntervalMs = 0 } = req;
    const t = now();
    const en = moduleEnabled(module);
    if (!en.ok) { audit(db, { module, action, actor, scope, result: 'denied', detail: en.reason, now: t }); return deny(en.reason); }

    const cfg = config();
    const dryRun = req.dryRun === true || (req.forceReal !== true && effectiveDryRun(module, cfg));

    if (minIntervalMs > 0) {
      const last = lastTerminalAt(module, action, scope);
      if (last && t - last < minIntervalMs) {
        audit(db, { module, action, actor, scope, result: 'denied', detail: 'cooldown', now: t });
        return deny('cooldown');
      }
    }

    if (perDay > 0) {
      const key = `${module}:${action}:${dayKey(new Date(t))}`;
      if (!reserve(key, perDay, t)) {
        audit(db, { module, action, actor, scope, result: 'denied', detail: 'daily_quota_exhausted', now: t });
        return deny('daily_quota_exhausted');
      }
    }
    if (perHour > 0) {
      const key = `${module}:${action}:h:${hourKey(new Date(t))}`;
      if (!reserve(key, perHour, t)) {
        audit(db, { module, action, actor, scope, result: 'denied', detail: 'hourly_quota_exhausted', now: t });
        return deny('hourly_quota_exhausted');
      }
    }

    // 预留成功就先留一条 reserved 审计；崩溃时能看出有一笔没有结算。
    try { audit(db, { module, action, actor, scope, result: 'reserved', detail: dryRun ? 'dry-run' : null, now: t }); } catch { /* ignore */ }

    let settled = false;
    return {
      ok: true,
      dryRun,
      reason: dryRun ? 'dry_run' : null,
      commit(detail) { settle('dry-run', detail, dryRun); },
      apply(detail) { settle('applied', detail, dryRun); },
      fail(detail) { settle('failed', detail, dryRun); }
    };

    function settle(result, detail, isDry) {
      if (settled) return;
      settled = true;
      const final = isDry && result !== 'failed' ? 'dry-run' : result;
      try {
        audit(db, {
          module, action, actor, scope, result: final,
          detail: detail != null ? String(detail).slice(0, 500) : null, now: now()
        });
      } catch (error) { log(`[capabilities] 审计写入失败：${error?.message ?? error}`); }
    }

    function deny(reason) {
      return { ok: false, dryRun: false, reason, commit() {}, apply() {}, fail() {} };
    }
  }

  function tokenHash(input) {
    return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 16);
  }

  function reservations(module, action, day = dayKey(new Date(now()))) {
    return quotaUsed(`${module}:${action}:${day}`);
  }

  return { check, moduleEnabled, effectiveDryRun, quotaUsed, tokenHash, lastTerminalAt, reservations };
}
