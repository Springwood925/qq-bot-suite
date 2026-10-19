// qq-bot-suite — Client 半边：QQ 机器人控制面板（可交互，直接画在插件详情页里）
//
// slot：`plugins.bundle.config`（key = 包名 qq-bot-suite）
// 数据/操作都走 host 同源端点：
//   GET  /qq-bot-suite/panel          → 聚合快照
//   GET  /qq-bot-suite/api?path=...   → 受白名单限制的桥只读代理
//   POST /qq-bot-suite/api?path=...   → 受白名单限制的桥写代理
// token 只在 host 侧使用，前端永远看不到。
window.__ModuleLoader__.load({
  id: 'qq-bot-suite',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;

    // ── 小工具 ────────────────────────────────────────────────────────────
    const apiGet = (path) =>
      fetch('/qq-bot-suite/api?path=' + encodeURIComponent(path), { headers: { accept: 'application/json' } })
        .then((r) => r.json())
        .then((j) => { if (!j.ok) throw new Error(j.error || '请求失败'); return j.data; });
    const apiPost = (path, body) =>
      fetch('/qq-bot-suite/api?path=' + encodeURIComponent(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .then((j) => { if (!j.ok) throw new Error(j.error || '请求失败'); return j.data; });

    const fmtNum = (n) => {
      const v = Number(n) || 0;
      if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
      return String(v);
    };
    const money = (n) => {
      const v = Number(n) || 0;
      if (v === 0) return '¥0';
      if (v < 0.01) return '¥' + v.toFixed(4);
      if (v < 1) return '¥' + v.toFixed(3);
      return '¥' + v.toFixed(2);
    };
    const shortKey = (k) => {
      const s = String(k || '');
      if (s.startsWith('group:')) return '群 ' + s.slice(6);
      if (s.startsWith('private:')) return '私聊 ' + s.slice(8);
      if (s.startsWith('wx:group:')) return '微信·' + s.slice(9);
      if (s.startsWith('wx:private:')) return '微信·' + s.slice(11);
      return s;
    };

    // ── 档位 ⇄ 唤醒配置（照搬 status.html 的语义）────────────────────────────
    function levelToConfig(level, keywords) {
      const l = Math.max(0, Math.min(100, Math.round(level)));
      const base = { atMention: true, nameMention: false, question: false, keywords: [], poke: false, anyMessage: false, probability: 0 };
      const cfg = { mode: 'diving', infinite: true, triggers: base };
      if (l === 0) return cfg;
      cfg.triggers.nameMention = true;
      cfg.triggers.question = true;
      if (l <= 25) return cfg;
      cfg.triggers.keywords = keywords || [];
      if (l <= 50) return cfg;
      cfg.triggers.poke = true;
      if (l <= 75) { cfg.triggers.probability = +(0.02 + ((l - 50) / 25) * 0.08).toFixed(3); return cfg; }
      if (l < 100) { cfg.triggers.probability = +(0.1 + ((l - 75) / 24) * 0.4).toFixed(3); return cfg; }
      cfg.mode = 'active';
      cfg.triggers.anyMessage = true;
      cfg.triggers.probability = 1;
      return cfg;
    }
    function configToLevel(cfg, kwCount) {
      const c = cfg || {}; const tg = c.triggers || {};
      if (tg.anyMessage === true || c.mode === 'active') return 100;
      const hasKw = (Number(kwCount) || 0) > 0;
      const p = Number(tg.probability) || 0;
      if (!hasKw) { if (!tg.nameMention && !tg.question) return 0; return 10; }
      if (p <= 0) return 40;
      if (p <= 0.1) return Math.round(50 + (p / 0.1) * 25);
      return Math.round(75 + Math.min(1, (p - 0.1) / 0.4) * 24);
    }
    function levelLabel(l) {
      if (l === 0) return '完全潜水 · 只回 @';
      if (l <= 25) return '被叫到才回（@ / 名字 / 提问）';
      if (l <= 50) return '加上关键词唤醒';
      if (l <= 75) return '按概率参与 · 不叫也可能开口';
      if (l < 100) return '活跃 · 明显爱插话';
      return '全响应 · 每条消息都看（最贵）';
    }

    // ── 样式 ──────────────────────────────────────────────────────────────
    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, lineHeight: 1.55 },
      card: { border: '1px solid rgba(128,128,128,.26)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 9 },
      head: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      title: { fontWeight: 600, fontSize: 13.5 },
      dim: { opacity: 0.6 },
      tiny: { fontSize: 11.5 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
      row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, border: '1px solid rgba(128,128,128,.32)', fontSize: 11.5 },
      btn: { padding: '3px 10px', borderRadius: 7, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
      btnSm: { padding: '1px 7px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
      th: { textAlign: 'left', fontWeight: 500, opacity: 0.55, padding: '2px 6px 4px', borderBottom: '1px solid rgba(128,128,128,.2)' },
      td: { padding: '3px 6px', borderBottom: '1px solid rgba(128,128,128,.1)', verticalAlign: 'top' },
      num: { textAlign: 'right' },
      err: { color: '#d9534f', fontSize: 12 },
      ok: { color: '#2ea043', fontSize: 12 },
      range: { width: '100%', accentColor: 'currentColor', cursor: 'pointer' },
      label: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' },
    };
    const dot = (on, warn) => ({ width: 8, height: 8, borderRadius: 4, display: 'inline-block', flex: '0 0 auto', background: on ? (warn ? '#d29922' : '#2ea043') : '#8b949e' });

    // ── 组件 ──────────────────────────────────────────────────────────────
    function Panel() {
      const [panel, setPanel] = useState(null);
      const [err, setErr] = useState('');
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState('');
      const [slang, setSlang] = useState(null);
      const [wl, setWl] = useState(null);
      const [levels, setLevels] = useState({});   // key -> 拖动中的本地档位
      const [saving, setSaving] = useState('');
      // ── 首次配置向导（分享版）────────────────────────────────────────────
      const [setup, setSetup] = useState(null);          // /snowluma/detect 的结果
      const [setupForm, setSetupForm] = useState({ snowDir: '', uin: '', ownerQQ: '', groups: '' });
      const [setupOut, setSetupOut] = useState('');
      const [setupBusy, setSetupBusy] = useState(false);

      const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

      const loadPanel = useCallback(() => {
        setBusy(true);
        fetch('/qq-bot-suite/panel', { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => { setPanel(j); setErr(''); })
          .catch((e) => setErr(e && e.message ? e.message : '读取失败'))
          .finally(() => setBusy(false));
      }, []);

      const loadSide = useCallback(() => {
        apiGet('/api/slang').then((d) => setSlang(d)).catch(() => {});
        apiGet('/api/whitelist').then((d) => setWl(d)).catch(() => {});
      }, []);

      // 环境检测：只在「插件自带桥」的机器上有意义（开发机 isBundled=false，向导不显示）
      const loadSetup = useCallback(() => {
        fetch('/qq-bot-suite/snowluma/detect', { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => {
            if (!j || !j.ok) return;
            setSetup(j);
            setSetupForm((f) => ({
              snowDir: f.snowDir || j.snowDir || '',
              uin: f.uin || String((j.accounts && j.accounts.find((a) => a.hasNetwork) || {}).uin || ''),
              ownerQQ: f.ownerQQ,
              groups: f.groups,
            }));
          })
          .catch(() => {});
      }, []);

      const runSetup = useCallback(() => {
        setSetupBusy(true);
        setSetupOut('');
        const groups = String(setupForm.groups || '')
          .split(/[,，\s]+/)
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n) && n > 0);
        fetch('/qq-bot-suite/snowluma/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            snowDir: setupForm.snowDir,
            uin: setupForm.uin,
            ownerQQ: setupForm.ownerQQ,
            groups,
            profile: 'desktop',
          }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok) {
              const lines = ['✅ 配置已生成：' + j.target];
              lines.push('控制台令牌：' + j.consoleToken);
              lines.push('管理员：' + j.ownerQQ + ' · 群：' + JSON.stringify(j.groups));
              lines.push(j.installOk ? '✅ DSH 集成已装好（preset + MCP）' : '⚠️ DSH 集成没成功：' + j.installLog);
              lines.push('');
              lines.push('下一步：重启一次 DSH，然后登录 QQ、让 SnowLuma 扫码。');
              setSetupOut(lines.join('\n'));
              loadSetup();
            } else {
              setSetupOut('❌ ' + ((j && j.error) || '配置失败'));
            }
          })
          .catch((e) => setSetupOut('❌ ' + (e && e.message ? e.message : '请求失败')))
          .finally(() => setSetupBusy(false));
      }, [setupForm, loadSetup]);

      useEffect(() => { loadPanel(); loadSide(); loadSetup(); }, [loadPanel, loadSide, loadSetup]);

      const host = panel && panel.host;
      const br = panel && panel.bridge;
      const us = panel && panel.usage;
      const wx = panel && panel.wx;
      const convs = useMemo(() => {
        const list = (panel && panel.conversations) || [];
        return list.slice().sort((a, b) => (b.lastReplyAt || 0) - (a.lastReplyAt || 0));
      }, [panel]);

      const kwOf = (c) => {
        // host 已经把 keywords 摊平带过来了；兜底再读一次 wakeConfig
        if (Array.isArray(c.keywords)) return c.keywords;
        const t = c && c.wakeConfig && c.wakeConfig.triggers;
        return t && Array.isArray(t.keywords) ? t.keywords : [];
      };
      const levelOf = (c) => {
        if (levels[c.key] !== undefined) return levels[c.key];   // 拖动中的本地值优先
        if (typeof c.level === 'number') return c.level;         // host 算好的档位
        return configToLevel(c.wakeConfig, kwOf(c).length);       // 兜底自己算
      };

      const saveLevel = (c, lv) => {
        setSaving(c.key);
        apiPost('/api/socialV2/wake-config', { key: c.key, config: levelToConfig(lv, kwOf(c)) })
          .then(() => { flash('已保存：' + shortKey(c.key) + ' → ' + lv); loadPanel(); })
          .catch((e) => flash('保存失败：' + e.message))
          .finally(() => setSaving(''));
      };

      const saveWhitelist = () => {
        if (!wl) return;
        setSaving('wl');
        apiPost('/api/whitelist', { allow: wl.allow, deny: wl.deny })
          .then(() => { flash('白名单已保存'); loadPanel(); })
          .catch((e) => flash('保存失败：' + e.message))
          .finally(() => setSaving(''));
      };

      const toggleWl = (kind, id) => {
        setWl((prev) => {
          if (!prev) return prev;
          const allow = Object.assign({}, prev.allow || {});
          const cur = Array.isArray(allow[kind]) ? allow[kind].slice() : [];
          const i = cur.indexOf(id);
          if (i >= 0) cur.splice(i, 1); else cur.push(id);
          allow[kind] = cur;
          return Object.assign({}, prev, { allow });
        });
      };

      const slangResearch = () => {
        const cand = (slang && slang.candidates) || [];
        const ids = cand.slice(0, 8).map((e) => e.id);
        if (!ids.length) { flash('没有候选词'); return; }
        setSaving('slang');
        apiPost('/api/slang/research', { ids })
          .then(() => { flash('研究任务已提交'); loadSide(); loadPanel(); })
          .catch((e) => flash('研究失败：' + e.message))
          .finally(() => setSaving(''));
      };

      const wxToggle = () => {
        if (!wx) return;
        setSaving('wx');
        apiPost('/api/wx/enabled', { enabled: !wx.enabled })
          .then(() => { flash('微信已' + (!wx.enabled ? '开启' : '停用')); loadPanel(); })
          .catch((e) => flash('操作失败：' + e.message))
          .finally(() => setSaving(''));
      };

      const usageRows = (us && Array.isArray(us.sessions) ? us.sessions : []).filter((s) => s.turns > 0);

      return h('div', { style: S.wrap },
        // ══ 头部 ══
        h('div', { style: Object.assign({}, S.row, { justifyContent: 'space-between' }) },
          h('div', { style: S.row },
            h('span', { style: S.title }, 'QQ 机器人控制面板'),
            h('span', { style: Object.assign({}, S.pill, { border: 'none', opacity: 0.5 }) }, busy ? '刷新中…' : (panel ? '已连接' : '连接中…')),
            msg ? h('span', { style: S.ok }, msg) : null,
          ),
          h('button', { style: S.btn, onClick: () => { loadPanel(); loadSide(); }, disabled: busy }, '刷新'),
        ),
        err ? h('div', { style: S.err }, '读取失败：' + err) : null,
        panel && panel.error ? h('div', { style: S.err }, panel.error) : null,

        // ══ 运行状态 ══
        h('div', { style: S.card },
          h('div', { style: S.head },
            h('span', { style: S.title }, '运行状态'),
            h('span', { style: { marginLeft: 'auto' } }),
            h('span', {
              style: Object.assign({}, S.tiny, { opacity: 0.7, cursor: 'pointer' }),
              onClick: () => fetch('/qq-bot-suite/console-url').then((r) => r.json()).then((j) => { if (j.url) window.open(j.url, '_blank', 'noopener'); }).catch(() => {}),
            }, '完整控制台 ↗'),
          ),
          h('div', { style: S.row },
            h('span', { style: dot(host && host.snowPort) }), h('span', { style: S.dim }, 'SnowLuma'),
            h('span', { style: S.pill }, host ? '真身 ' + host.real : '—'),
            host && host.fake > 0 ? h('span', { style: Object.assign({}, S.pill, { color: '#d29922' }) }, '假进程 ' + host.fake) : null,
            h('span', { style: { width: 8 } }),
            h('span', { style: dot(host && host.bridgePort) }), h('span', { style: S.dim }, '桥'),
            host && host.bridgePort ? null : h('span', { style: Object.assign({}, S.pill, { color: '#d29922' }) }, '未监听'),
            h('span', { style: { width: 8 } }),
            h('span', { style: dot(host && host.account) }), h('span', { style: S.dim }, '账号'),
            h('span', { style: S.pill }, host && host.account ? host.account.nick + ' (' + host.account.qq + ')' : '不可达'),
          ),
          br && !br.__error ? h('div', { style: S.row },
            h('span', { style: S.pill }, '模式 ' + br.mode),
            h('span', { style: S.pill }, '角色 ' + (br.role || '—')),
            h('span', { style: S.pill }, br.dshReady ? 'DSH 就绪' : 'DSH 未就绪'),
            h('span', { style: Object.assign({}, S.pill, br.socialV2Paused ? { color: '#d29922' } : {}) }, br.socialV2Paused ? '⏸ 已暂停' : '▶ 运行中'),
          ) : null,
        ),

        // ══ 响应档位（滑条，松手即保存）══
        h('div', { style: S.card },
          h('div', { style: S.head },
            h('span', { style: S.title }, '响应档位'),
            h('span', { style: Object.assign({}, S.tiny, S.dim) }, '拖动松手即保存 · 0=只回@ / 100=每条都看'),
          ),
          convs.length === 0 ? h('div', { style: S.dim }, '没有会话')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                convs.map((c) => {
                  const lv = levelOf(c);
                  return h('div', { key: c.key, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    h('div', { style: S.row },
                      h('span', { style: Object.assign({}, S.mono, { minWidth: 118 }) }, shortKey(c.key)),
                      h('span', { style: Object.assign({}, S.tiny, S.dim) }, levelLabel(lv)),
                      saving === c.key ? h('span', { style: Object.assign({}, S.tiny, { color: '#d29922' }) }, '保存中…') : null,
                      h('span', { style: { marginLeft: 'auto' } }),
                      h('span', { style: Object.assign({}, S.mono, { fontWeight: 600, minWidth: 26, textAlign: 'right' }) }, String(lv)),
                    ),
                    h('input', {
                      type: 'range', min: 0, max: 100, step: 1, value: lv, style: S.range,
                      onChange: (e) => setLevels((prev) => { const n = Object.assign({}, prev); n[c.key] = Number(e.target.value); return n; }),
                      onMouseUp: (e) => saveLevel(c, Number(e.target.value)),
                      onTouchEnd: (e) => saveLevel(c, Number(e.target.value)),
                      disabled: saving === c.key,
                    }),
                  );
                }),
              ),
        ),

        // ══ 用量与计价（口径同 web：按 nowPeak 二选一，不相加）══
        h('div', { style: S.card },
          h('div', { style: S.head },
            h('span', { style: S.title }, '用量与计价'),
            h('span', { style: Object.assign({}, S.tiny, S.dim) },
              us && !us.__error
                ? (us.nowPeak ? '当前高峰时段' : '当前闲时') + ' · 命中率 ' + ((us.hitRate * 100) || 0).toFixed(1) + '% · 共 ' + us.turns + ' 回合'
                : '—'),
          ),
          us && !us.__error
            ? h('table', { style: S.table },
                h('thead', null, h('tr', null,
                  h('th', { style: S.th }, '会话'),
                  h('th', { style: Object.assign({}, S.th, S.num) }, '命中率'),
                  h('th', { style: Object.assign({}, S.th, S.num) }, '缓存读'),
                  h('th', { style: Object.assign({}, S.th, S.num) }, '未命中'),
                  h('th', { style: Object.assign({}, S.th, S.num) }, '输出'),
                  h('th', { style: Object.assign({}, S.th, S.num) }, '回合'),
                  h('th', { style: Object.assign({}, S.th, S.num) }, '费用'),
                )),
                h('tbody', null, usageRows.map((s) => h('tr', { key: s.key },
                  h('td', { style: S.td }, shortKey(s.key)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, ((s.hitRate * 100) || 0).toFixed(1) + '%'),
                  h('td', { style: Object.assign({}, S.td, S.num) }, fmtNum(s.cacheRead)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, fmtNum(s.uncached)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, fmtNum(s.output)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, String(s.turns)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, money(s.cost)),
                ))),
                h('tfoot', null, h('tr', null,
                  h('td', { style: S.td }, '合计'),
                  h('td', { style: Object.assign({}, S.td, S.num) }, ((us.hitRate * 100) || 0).toFixed(1) + '%'),
                  h('td', { style: Object.assign({}, S.td, S.num) }, fmtNum(us.cacheRead)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, fmtNum(us.uncached)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, fmtNum(us.output)),
                  h('td', { style: Object.assign({}, S.td, S.num) }, String(us.turns)),
                  h('td', { style: Object.assign({}, S.td, S.num, { fontWeight: 600 }) }, money(us.cost)),
                )),
              )
            : h('div', { style: S.dim }, us && us.__error ? us.__error : '—'),
          us && us.priceNow
            ? h('div', { style: Object.assign({}, S.tiny, S.dim) },
                '单价（' + (us.model || '') + '，元/百万 tokens）：缓存命中 ' + us.priceNow.cacheHit +
                ' · 未命中 ' + us.priceNow.miss + ' · 输出 ' + us.priceNow.output +
                '　|　平均 ' + money(us.turns ? us.cost / us.turns : 0) + '/回合 · ' + (us.stepsPerTurn || 0).toFixed(1) + ' 次调用/回合')
            : null,
        ),

        // ══ 白名单 ══
        h('div', { style: S.card },
          h('div', { style: S.head },
            h('span', { style: S.title }, '白名单'),
            h('span', { style: { marginLeft: 'auto' } }),
            h('button', { style: S.btnSm, onClick: saveWhitelist, disabled: !wl || saving === 'wl' }, saving === 'wl' ? '保存中…' : '保存'),
          ),
          wl
            ? h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
                h('div', { style: { flex: '1 1 200px' } },
                  h('div', { style: Object.assign({}, S.tiny, S.dim, { marginBottom: 4 }) }, '群'),
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    (((panel && panel.bridge && panel.bridge.allowGroups) || [])).map((g) =>
                      h('label', { key: g, style: S.label },
                        h('input', { type: 'checkbox', checked: ((wl.allow && wl.allow.groups) || []).includes(g), onChange: () => toggleWl('groups', g) }),
                        h('span', { style: S.mono }, g),
                      ),
                    ),
                  ),
                ),
                h('div', { style: { flex: '1 1 200px' } },
                  h('div', { style: Object.assign({}, S.tiny, S.dim, { marginBottom: 4 }) }, '私聊'),
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    (((panel && panel.bridge && panel.bridge.allowPrivate) || [])).map((p) =>
                      h('label', { key: p, style: S.label },
                        h('input', { type: 'checkbox', checked: ((wl.allow && wl.allow.private) || []).includes(p), onChange: () => toggleWl('private', p) }),
                        h('span', { style: S.mono }, p),
                      ),
                    ),
                  ),
                ),
              )
            : h('div', { style: S.dim }, '白名单读取中…'),
        ),

        // ══ 黑话 ══
        h('div', { style: S.card },
          h('div', { style: S.head },
            h('span', { style: S.title }, '黑话库'),
            h('span', { style: { marginLeft: 'auto' } }),
            h('button', { style: S.btnSm, onClick: slangResearch, disabled: !slang || saving === 'slang' },
              saving === 'slang' ? '研究中…' : '研究 8 条候选'),
          ),
          slang
            ? h('div', { style: S.row },
                h('span', { style: S.pill }, '已确认 ' + ((slang.confirmed || []).length)),
                h('span', { style: S.pill }, '候选 ' + ((slang.candidates || []).length)),
                h('span', { style: S.pill }, '已拒 ' + ((slang.rejected || []).length)),
                h('span', { style: Object.assign({}, S.tiny, S.dim) }, '研究只写解释；入库点「确认」在完整控制台里'),
              )
            : h('div', { style: S.dim }, '黑话读取中…'),
        ),

        // ══ 微信 ══
        h('div', { style: S.card },
          h('div', { style: S.head },
            h('span', { style: dot(wx && wx.enabled) }),
            h('span', { style: S.title }, '微信'),
            h('span', { style: { marginLeft: 'auto' } }),
            h('button', { style: S.btnSm, onClick: wxToggle, disabled: !wx || saving === 'wx' },
              saving === 'wx' ? '…' : (wx && wx.enabled ? '停用' : '开启')),
          ),
          wx && !wx.__error
            ? h('div', { style: S.row },
                h('span', { style: S.pill }, wx.enabled ? '已开启' : '已停用'),
                h('span', { style: S.pill }, '私聊 ' + wx.allowPrivate + ' · 群 ' + wx.allowGroups),
                h('span', { style: S.pill }, '队列 ' + wx.queueLength),
                h('span', { style: S.pill }, '事件 ' + wx.eventTotal),
              )
            : h('div', { style: S.dim }, wx && wx.__error ? wx.__error : '—'),
        ),

        // ══ 活动流 ══
        // First-run setup wizard: only for the bundled bridge when config.json is missing.
        // On the dev machine isBundled=false, so this block never renders there.
        setup && setup.isBundled && !setup.hasConfig
          ? h('div', { style: S.card },
              h('div', { style: S.head },
                h('span', { style: S.title }, '⚙ 首次配置'),
                h('span', { style: { marginLeft: 'auto' } }),
                h('button', { style: S.btnSm, onClick: loadSetup, disabled: setupBusy }, '重新检测'),
              ),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('div', { style: S.dim },
                  setup.snowDir
                    ? '① 已找到 SnowLuma：' + setup.snowDir
                    : '① 没找到 SnowLuma。请先安装，然后在下面填它的安装目录（含 index.mjs 和 node.exe 的那个文件夹）。'),
                h('input', {
                  style: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
                  placeholder: 'SnowLuma 安装目录',
                  value: setupForm.snowDir,
                  onChange: (e) => setSetupForm(Object.assign({}, setupForm, { snowDir: e.target.value })),
                }),
                setup.accounts && setup.accounts.length
                  ? h('div', { style: Object.assign({}, S.row, { alignItems: 'center', gap: 8 }) },
                      h('span', { style: S.dim }, '② 机器人账号：'),
                      h('select', {
                        style: { padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
                        value: setupForm.uin,
                        onChange: (e) => setSetupForm(Object.assign({}, setupForm, { uin: e.target.value })),
                      }, setup.accounts.map((a) =>
                        h('option', { key: a.uin, value: a.uin },
                          a.uin + (a.hasNetwork ? '（已配 OneBot）' : '（未配 OneBot）')),
                      )),
                    )
                  : h('div', { style: S.dim }, '② 还没读到账号 —— 确认 SnowLuma 装好、并且至少登录过一次 QQ。'),
                h('div', { style: Object.assign({}, S.row, { gap: 8 }) },
                  h('input', {
                    style: { flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
                    placeholder: '你的 QQ 号（管理员）',
                    value: setupForm.ownerQQ,
                    onChange: (e) => setSetupForm(Object.assign({}, setupForm, { ownerQQ: e.target.value })),
                  }),
                  h('input', {
                    style: { flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', fontSize: 13 },
                    placeholder: '要接入的群号，逗号分隔',
                    value: setupForm.groups,
                    onChange: (e) => setSetupForm(Object.assign({}, setupForm, { groups: e.target.value })),
                  }),
                ),
                h('div', { style: Object.assign({}, S.row, { alignItems: 'center', gap: 10 }) },
                  h('button', {
                    style: S.btnSm,
                    onClick: runSetup,
                    disabled: setupBusy || !setupForm.snowDir || !setupForm.uin,
                  }, setupBusy ? '配置中…' : '③ 开始配置'),
                  h('span', { style: S.dim }, '会生成 config.json，并自动装好 DSH 的 preset + MCP。'),
                ),
                setupOut
                  ? h('pre', { style: Object.assign({}, S.mono, { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, lineHeight: 1.6 }) }, setupOut)
                  : null,
              ),
            )
          : null,

        br && Array.isArray(br.activity) && br.activity.length
          ? h('div', { style: S.card },
              h('div', { style: S.head }, h('span', { style: S.title }, '最近活动')),
              h('div', { style: Object.assign({}, S.mono, S.dim, { display: 'flex', flexDirection: 'column', gap: 2 }) },
                br.activity.map((line, i) => h('div', { key: i, style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, line)),
              ),
            )
          : null,

        h('div', { style: Object.assign({}, S.tiny, S.dim) },
          '只做检测与展示，不启动进程：拉起与自愈由 qqbot-guard.vbs 负责。SnowLuma 必须用自带的 node.exe（hook 与版本绑定）。',
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'qq-bot-suite',
        }, Panel));
      },
    };
  },
});
