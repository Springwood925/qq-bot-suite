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



    const UI_VERSION = '1.1.6';







    const DASHBOARD_CSS = ".qq-workbench{--qq-line:rgba(139,156,178,.22);--qq-muted:#8997a9;--qq-accent:#4cc9b0;--qq-surface:rgba(130,150,175,.045);max-width:1400px;margin:0 auto;gap:22px!important;line-height:1.65!important;font-size:13px!important;color:inherit}\n.qq-workbench *{box-sizing:border-box}.qq-workbench [hidden]{display:none!important}\n.qq-workbench h2,.qq-workbench h3,.qq-workbench p{margin:0}.qq-workbench h2{font-size:24px;letter-spacing:-.7px;font-weight:680}.qq-workbench h3{font-size:16px;font-weight:650}.qq-workbench button,.qq-workbench input,.qq-workbench textarea,.qq-workbench select{font-family:inherit;color:inherit}\n.qq-workbench button{transition:background .15s,border-color .15s,box-shadow .15s;cursor:pointer;line-height:1.5}.qq-workbench button:disabled{cursor:default;opacity:.42}.qq-workbench button:focus-visible,.qq-workbench input:focus-visible,.qq-workbench select:focus-visible,.qq-workbench textarea:focus-visible,.qq-workbench summary:focus-visible{outline:2px solid var(--qq-accent);outline-offset:3px}\n.qq-workbench button:not(:disabled):hover{border-color:var(--qq-accent)!important;background-color:rgba(76,201,176,.085)!important}.qq-workbench input:not([type=range]):not([type=checkbox]),.qq-workbench select,.qq-workbench textarea{border:1px solid var(--qq-line)!important;border-radius:9px!important;background:var(--qq-surface)!important;padding:9px 11px!important;min-height:36px;max-width:100%}.qq-workbench select option{background:#20252e;color:#f0f4fa}.qq-workbench input[type=checkbox]{accent-color:var(--qq-accent);width:15px;height:15px;flex:none}\n.qq-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 0 2px}.qq-brand{display:flex;align-items:center;gap:15px}.qq-brand-mark{width:52px;height:52px;display:grid;place-items:center;border-radius:17px;font-size:26px;font-weight:750;color:#75e0cb;background:linear-gradient(140deg,rgba(76,201,176,.25),rgba(89,125,245,.13));border:1px solid rgba(76,201,176,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}.qq-brand p{font-size:12px;opacity:.58;margin-top:3px}.qq-hero-actions{display:flex;gap:12px;align-items:center}.qq-hero-actions button{padding:8px 12px!important}.qq-connection{display:flex;gap:6px;align-items:center;font-size:12px;white-space:nowrap;opacity:.8}.qq-connection i{box-shadow:0 0 10px rgba(76,201,176,.2)}\n.qq-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.qq-stat{text-align:left;position:relative;overflow:hidden;padding:19px 20px;border:1px solid var(--qq-line);border-radius:16px;background:var(--qq-surface);color:inherit;display:flex;flex-direction:column;gap:3px;min-width:0}.qq-stat:after{content:'';position:absolute;right:-22px;top:-33px;width:100px;height:100px;border-radius:50%;background:var(--glow);filter:blur(22px);opacity:.16;pointer-events:none}.qq-stat-label{font-size:12px;opacity:.72}.qq-stat strong{font-size:30px;letter-spacing:-1px;line-height:1.5;font-weight:650}.qq-stat>span:last-of-type{font-size:11px;opacity:.48;line-height:1.6}.qq-stat b{position:absolute;right:18px;top:18px;font-size:16px;color:var(--glow)}.qq-stat-mint{--glow:#4cc9b0}.qq-stat-amber{--glow:#efb75b}.qq-stat-blue{--glow:#7eabff}.qq-stat-purple{--glow:#b69aff}\n.qq-main-nav{display:flex;gap:6px;border-bottom:1px solid var(--qq-line);padding:0 0 13px;overflow-x:auto}.qq-main-nav>button{border:1px solid transparent;border-radius:11px;background:transparent;color:inherit;text-align:left;padding:10px 14px;min-width:130px;flex:1}.qq-main-nav strong{display:block;font-size:13px;font-weight:600}.qq-main-nav span{display:block;font-size:10px;opacity:.48;margin-top:2px;white-space:nowrap}.qq-main-nav button[aria-current=page]{border-color:rgba(76,201,176,.25);background:rgba(76,201,176,.09);color:var(--qq-accent)}.qq-section-title{display:flex;align-items:baseline;gap:12px;margin-top:0}.qq-section-title span{font-size:11px;opacity:.45}.qq-section{display:flex;flex-direction:column;gap:18px;min-width:0}.qq-section>div[style*=\"border\"]{padding:20px!important;border-color:var(--qq-line)!important;border-radius:14px!important;background:var(--qq-surface)}\n.qq-overview-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:18px}.qq-welcome-card{padding:25px!important;border-radius:16px!important;justify-content:center;background:linear-gradient(130deg,rgba(76,201,176,.09),rgba(116,144,240,.03));border-color:rgba(76,201,176,.18)!important;gap:14px!important}.qq-eyebrow{font-size:9px;letter-spacing:2.2px;color:var(--qq-accent)}.qq-welcome-card h3{font-size:21px;font-weight:550}.qq-welcome-card p{opacity:.58;line-height:1.9;max-width:440px}.qq-primary{background:rgba(76,201,176,.16)!important;color:var(--qq-accent)!important;border:1px solid rgba(76,201,176,.4)!important;padding:9px 17px!important;border-radius:9px!important}.qq-quick-card{padding:20px!important;border-radius:16px!important;gap:0!important}.qq-quick-card h3{margin-bottom:10px}.qq-quick-card>button{position:relative;border:0;border-top:1px solid var(--qq-line);background:transparent;text-align:left;padding:13px 4px;color:inherit;border-radius:0}.qq-quick-card strong{font-size:13px;display:block;font-weight:500}.qq-quick-card span{display:block;opacity:.48;font-size:11px;margin-top:2px}.qq-quick-card b{position:absolute;right:8px;top:21px;opacity:.5;font-weight:400}\n.qq-memory{border:0!important;padding:0!important;gap:16px!important}.qq-memory [role=tablist]{gap:5px!important;padding-bottom:10px;border-bottom:1px solid var(--qq-line)}.qq-memory [role=tab]{padding:8px 13px!important;border-radius:9px!important;font-size:12px!important}.qq-memory [role=tab][aria-selected=true]{background:rgba(76,201,176,.1)!important;border-color:rgba(76,201,176,.35)!important;color:var(--qq-accent)!important}.qq-memory details{border:1px solid var(--qq-line)!important;border-radius:10px!important;padding:10px 12px!important;background:var(--qq-surface)}.qq-memory summary{cursor:pointer;font-weight:500;font-size:12px;opacity:.85}.qq-memory summary::marker{color:var(--qq-muted)}.qq-memory details[open]>summary{margin-bottom:9px}\n.qq-memory-list{max-height:780px;overflow:auto;padding-right:4px;scrollbar-width:thin}.qq-memory-list>details{background:transparent;border:0!important;padding:4px 0!important}.qq-record{border:1px solid var(--qq-line)!important;border-radius:11px!important;padding:13px 14px!important;margin-top:9px!important;background:var(--qq-surface)!important}.qq-record[aria-pressed=true]{background:rgba(76,201,176,.07)!important;border-color:rgba(76,201,176,.5)!important;box-shadow:inset 3px 0 0 var(--qq-accent)}.qq-record-content{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:13px}.qq-memory-list .qq-batch{position:sticky;top:0;z-index:2;background:color-mix(in srgb,currentColor 7%,transparent);backdrop-filter:blur(20px);border:1px solid var(--qq-line);border-radius:10px;padding:10px;font-size:11px}.qq-memory-detail{border-radius:14px!important;padding:19px!important;gap:12px!important;border-color:var(--qq-line)!important;position:sticky;top:12px}.qq-memory-detail>div[style*=\"font-size: 10\"]{opacity:.35!important;font-size:9px!important}.qq-detail-reading{padding:5px 0 12px}.qq-next-step{padding:12px 14px;border-radius:10px;margin-bottom:12px;background:rgba(76,201,176,.07);border:1px solid rgba(76,201,176,.14)}.qq-next-step strong{display:block;font-size:10px;color:var(--qq-accent);letter-spacing:.4px;margin-bottom:4px}.qq-edit-form{display:flex;flex-direction:column;gap:12px;border:1px solid rgba(126,171,255,.3);padding:15px;border-radius:12px;background:rgba(126,171,255,.035)}.qq-evidence{padding:14px;background:var(--qq-surface);border:1px solid var(--qq-line);border-radius:10px}.qq-danger{margin-top:10px}.qq-danger>summary{opacity:.45;font-size:11px}.qq-memory button{min-height:30px}.qq-workbench blockquote{background:rgba(139,156,178,.045);border-radius:0 8px 8px 0;line-height:1.85}\n.qq-workbench table{display:table!important;max-width:100%;font-variant-numeric:tabular-nums}.qq-section-usage>div{overflow-x:auto}.qq-workbench th{font-size:11px!important;padding:10px!important}.qq-workbench td{padding:11px 10px!important}.qq-workbench tr:hover{background:rgba(139,156,178,.04)}.qq-workbench textarea{line-height:1.85!important;font-size:13px!important}.qq-workbench button[style*=\"padding: 3px\"]{padding:7px 11px!important}\n.qq-alert{padding:12px 16px;background:rgba(230,104,104,.08);border:1px solid rgba(230,104,104,.25);border-radius:10px;color:#e97f7f}.qq-toast{padding:10px 14px;border:1px solid rgba(76,201,176,.3);background:rgba(76,201,176,.1);border-radius:9px;color:var(--qq-accent)}.qq-build-info{opacity:.5;font-size:10px;border-top:1px solid var(--qq-line);padding-top:13px;margin-top:4px}.qq-build-info summary{cursor:pointer}.qq-build-info>div{margin-top:7px}\n@media(min-width:1100px){.qq-section-channels{display:grid;grid-template-columns:1fr 1fr;align-items:start}.qq-section-channels>div:first-child{grid-row:span 2}}\n@media(max-width:760px){.qq-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.qq-stat{padding:15px}.qq-stat strong{font-size:26px}.qq-overview-grid{grid-template-columns:1fr}.qq-main-nav>button{min-width:0;padding:9px 5px;text-align:center;white-space:nowrap}.qq-main-nav strong{font-size:11px}.qq-main-nav span{display:none}.qq-hero{align-items:flex-start}.qq-brand p{max-width:230px}.qq-connection{display:none}.qq-workbench h2{font-size:20px}.qq-brand-mark{width:44px;height:44px}.qq-section-title span{display:none}.qq-memory-detail{position:static}.qq-memory-list{max-height:570px}.qq-memory [role=tablist]{flex-wrap:wrap!important}.qq-workbench table{font-size:10px!important}.qq-workbench td,.qq-workbench th{padding:7px 5px!important}}\n@media(prefers-reduced-motion:reduce){.qq-workbench *{transition:none!important;scroll-behavior:auto!important}}\n\n.qq-workbench *{scrollbar-width:thin;scrollbar-color:rgba(139,156,178,.35) transparent}.qq-workbench ::-webkit-scrollbar{width:6px;height:6px}.qq-workbench ::-webkit-scrollbar-thumb{background:rgba(139,156,178,.3);border-radius:8px}.qq-workbench ::-webkit-scrollbar-track{background:transparent}\n\n.qq-status-card{padding:20px!important;border-color:var(--qq-line)!important;border-radius:14px!important;background:var(--qq-surface);gap:16px!important}.qq-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.qq-status-grid>div{display:flex;flex-direction:column;gap:3px}.qq-status-grid span{font-size:10px;opacity:.45}.qq-status-grid strong{font-size:14px;font-weight:500}.qq-status-grid small{font-size:10px;opacity:.45}@media(max-width:760px){.qq-status-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}}\n\n.mt-garden{display:flex;flex-direction:column;gap:24px;min-width:0}.mt-garden h2{font-size:22px!important}.mt-garden h3{font-size:15px}.mt-garden p{line-height:1.8}.mt-garden button,.mt-garden input,.mt-garden select,.mt-garden textarea{font:inherit}.mt-garden button{border:1px solid var(--qq-line);background:transparent;color:inherit;border-radius:9px;padding:7px 12px;font-size:12px}.mt-garden button:disabled{opacity:.4;cursor:default}.mt-toolbar,.mt-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.mt-toolbar p,.mt-section-head p{opacity:.58;font-size:12px;margin-top:4px}.mt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.mt-toolbar select{max-width:240px}.mt-loading,.mt-note,.mt-message{font-size:12px;padding:12px 15px;border:1px solid var(--qq-line);border-radius:10px;background:var(--qq-surface)}.mt-message{display:flex;align-items:center;gap:12px;color:var(--qq-accent)}.mt-empty{padding:24px;border:1px dashed var(--qq-line);border-radius:12px;text-align:center;font-size:13px;opacity:.65}\n.mt-tree{position:relative;border:1px solid var(--qq-line);border-radius:20px;padding:28px 20px 22px;background:radial-gradient(ellipse at 50% 10%,rgba(79,166,129,.11),transparent 70%);overflow:hidden}.mt-root{position:relative;width:190px;margin:0 auto 32px;text-align:center;border:1px solid rgba(101,191,151,.33);background:rgba(101,191,151,.08);border-radius:16px;padding:15px;display:flex;flex-direction:column;align-items:center;gap:3px;color:#7acfb0}.mt-root strong{font-size:16px;font-weight:600}.mt-root span{font-size:10px;opacity:.65}.mt-root:after{content:'';position:absolute;bottom:-33px;left:50%;width:2px;height:32px;background:rgba(101,191,151,.3)}.mt-branches{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;padding-top:23px}.mt-branches:before{content:'';position:absolute;top:0;left:10%;right:10%;height:2px;background:rgba(139,156,178,.25)}.mt-branch{position:relative;min-width:0}.mt-branch:before{content:'';position:absolute;left:50%;top:-22px;height:22px;width:2px;background:var(--branch-color);opacity:.4}.mt-branch-head{display:flex;align-items:center;gap:7px;width:100%;padding:10px!important;border-color:color-mix(in srgb,var(--branch-color) 35%,transparent)!important;background:color-mix(in srgb,var(--branch-color) 8%,transparent)!important}.mt-branch-head i{font-style:normal;font-size:11px;width:25px;height:25px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--branch-color) 14%,transparent);color:var(--branch-color)}.mt-branch-head strong{font-size:12px;font-weight:550;white-space:nowrap}.mt-branch-head>span{margin-left:auto;font-size:12px;color:var(--branch-color)}.mt-branch-head[aria-pressed=true]{box-shadow:0 0 0 1px var(--branch-color)}.mt-branch-hint{font-size:11px!important;opacity:.5;min-height:35px;margin:10px 0!important}.mt-leaves{border-left:1px dashed color-mix(in srgb,var(--branch-color) 40%,transparent);margin-left:10px;padding-left:9px;display:flex;flex-direction:column;gap:9px}.mt-leaf{position:relative;text-align:left;display:flex;flex-direction:column;width:100%;padding:10px!important;background:var(--qq-surface)!important;border-color:var(--qq-line)!important}.mt-leaf:before{content:'';position:absolute;left:-10px;top:18px;width:9px;height:1px;background:var(--branch-color);opacity:.5}.mt-leaf>span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:1.8;overflow-wrap:anywhere}.mt-leaf small{font-size:10px;opacity:.4;margin-top:8px}.mt-empty-leaf{font-size:10px;opacity:.32;padding:12px 2px}.mt-more{width:100%;border:0!important;font-size:10px!important;margin-top:8px;opacity:.65;padding:5px!important}\n.mt-benefits{display:flex;flex-direction:column;gap:13px}.mt-section-head small{font-size:10px;opacity:.45}.mt-benefit-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.mt-benefit-grid button{text-align:left;background:var(--qq-surface);padding:17px!important;display:flex;flex-direction:column;gap:10px}.mt-benefit-grid strong{font-size:12px;color:var(--qq-accent)}.mt-benefit-grid p{font-size:12px;opacity:.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.mt-benefit-grid small{font-size:10px;opacity:.4;margin-top:auto}.mt-expanded,.mt-detail{border:1px solid var(--qq-line);border-radius:15px;padding:20px;display:flex;flex-direction:column;gap:14px;background:var(--qq-surface)}.mt-expanded>input{width:100%}.mt-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.mt-list button{text-align:left;display:flex;flex-direction:column;gap:8px;padding:13px!important}.mt-list span{line-height:1.85;font-size:12px;overflow-wrap:anywhere}.mt-list small{font-size:10px;opacity:.45}.mt-person-grid{display:flex;gap:10px;flex-wrap:wrap}.mt-detail-text{font-size:15px;line-height:1.95!important;white-space:pre-wrap;overflow-wrap:anywhere}.mt-detail>small{font-size:11px;opacity:.5}.mt-next{border-left:2px solid var(--qq-accent);padding:10px 12px;background:rgba(76,201,176,.06);font-size:12px}.mt-source{border:1px solid var(--qq-line);border-radius:12px;padding:14px}.mt-source small{font-size:10px;opacity:.5}.mt-source blockquote{margin:10px 0 14px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-size:12px}.mt-edit{display:flex;flex-direction:column;gap:10px}.mt-edit textarea{width:100%;min-height:90px;resize:vertical}\n.mt-review{border-top:1px solid var(--qq-line);padding-top:22px}.mt-review-list{display:flex;flex-direction:column;gap:12px;margin-top:15px}.mt-review-card{border:1px solid rgba(213,177,113,.2);border-radius:13px;padding:17px;background:rgba(213,177,113,.025)}.mt-review-card>small{font-size:10px;opacity:.5}.mt-review-item{padding:10px 0}.mt-review-item+.mt-review-item{border-top:1px solid var(--qq-line)}.mt-review-item>p{font-size:13px;line-height:1.85;margin-bottom:12px;overflow-wrap:anywhere}.mt-positive{color:var(--qq-accent)!important;background:rgba(76,201,176,.1)!important;border-color:rgba(76,201,176,.35)!important}.mt-recent,.mt-advanced{border-top:1px solid var(--qq-line);padding-top:16px;font-size:12px}.mt-recent summary,.mt-advanced>summary{cursor:pointer;opacity:.5;font-size:11px}.mt-recent p{margin-top:10px;padding:10px;border-radius:8px;background:var(--qq-surface)}.mt-recent small{display:block;margin-top:10px;opacity:.4}.mt-advanced[open]>.qq-memory{margin-top:20px}\n.qq-main-nav>button{min-width:0}.qq-section-persona,.qq-section-channels,.qq-section-usage,.qq-section-overview{display:block!important;border:1px solid var(--qq-line);border-radius:13px;padding:16px}.qq-section-persona>summary,.qq-section-channels>summary,.qq-section-usage>summary,.qq-section-overview>summary{font-size:14px;font-weight:550;cursor:pointer}.qq-section-persona>div,.qq-section-channels>div,.qq-section-usage>div,.qq-section-overview>section{margin-top:16px}.qq-workbench .qq-section[hidden]{display:none!important}\n@media(max-width:1000px){.mt-branches{gap:10px}.mt-tree{padding:24px 12px 16px}.mt-branch-head{padding:8px 6px!important;gap:4px}.mt-branch-head i{width:20px;height:22px;font-size:10px}.mt-branch-head strong{font-size:11px}}\n@media(max-width:760px){.mt-toolbar{align-items:flex-start;gap:12px}.mt-toolbar .mt-actions{width:100%}.mt-toolbar select{flex:1;max-width:100%;min-width:0}.mt-tree{padding:20px 14px}.mt-root{margin:0 0 22px 10px;width:180px}.mt-root:after{left:16px;bottom:-23px;height:22px}.mt-branches{display:flex;flex-direction:column;gap:18px;padding:0 0 0 25px;border-left:2px solid rgba(101,191,151,.25);margin-left:26px}.mt-branches:before{display:none}.mt-branch:before{left:-25px;top:20px;width:25px;height:2px}.mt-branch-head{padding:10px!important}.mt-branch-head strong{font-size:13px}.mt-branch-head i{width:25px;height:25px}.mt-branch-hint{min-height:0;margin:7px 0!important}.mt-leaves{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mt-leaf{min-width:0}.mt-leaf>span{-webkit-line-clamp:2}.mt-benefit-grid,.mt-list{grid-template-columns:1fr}.mt-section-head{gap:10px}.mt-section-head p{font-size:11px}.mt-garden h2{font-size:20px!important}}\n";







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



    // 原生嵌入 qq-bot-suite 详情页；所有管理请求经同源 host，前端不持桥令牌。



// A tree of real records grouped for browsing, not a graph of inferred causal links.



function buildMemoryGarden(records,people=[],at=Date.now()) {



  const alive=r=>!r.expired&&(!r.validUntil||r.validUntil>at);



  const eligible=records.filter(r=>r.verified===true&&['active','done'].includes(r.status)&&alive(r));



  const allowed=new Set(eligible.map(r=>r.id)),conflicted=new Set();



  for(const r of eligible)for(const link of r.relations||[])if(link.type==='contradicts'&&allowed.has(link.id)){conflicted.add(r.id);conflicted.add(link.id);}



  const known=eligible.filter(r=>!conflicted.has(r.id));



  const aliases=new Map(people.map(p=>[p.id,p.aliases?.at(-1)||p.id]));



  const members=new Map();



  for(const row of known){const id=row.subjectUserId;if(!id||id==='self')continue;if(!members.has(id))members.set(id,{id:'person:'+id,userId:id,name:aliases.get(id)||'群友 '+id,records:[]});members.get(id).records.push(row);}



  const branches=[



    {id:'people',name:'认识的人',icon:'人',color:'#78adee',hint:'认得称呼，也记得相处过的事情',items:[...members.values()]},



    {id:'preferences',name:'偏好与习惯',icon:'♥',color:'#d699b8',hint:'知道喜欢什么，怎样交流更舒服',items:known.filter(r=>['fact','style'].includes(r.kind))},



    {id:'experiences',name:'共同经历',icon:'◇',color:'#70c6b2',hint:'接着上次聊过、一起经历的事情',items:known.filter(r=>['event','experience','observation'].includes(r.kind))},



    {id:'promises',name:'约定与进展',icon:'✓',color:'#e0b568',hint:'记住约定，跟上事情的进展',items:known.filter(r=>['agreement','goal','thought'].includes(r.kind))},



    {id:'knowledge',name:'学会的东西',icon:'✦',color:'#ac9cda',hint:'留下有用的知识与方法',items:known.filter(r=>r.kind==='knowledge')}



  ];



  const pending=records.filter(r=>r.status==='unverified'&&r.kind!=='goal'&&alive(r));



  const grouped=new Map();



  for(const r of pending){const key=r.source?.messageRef?r.subjectUserId+'\0'+r.kind+'\0'+r.source.messageRef:r.id;const chunks=grouped.get(key)||[];chunks.push(r);grouped.set(key,chunks);}



  const reviewGroups=[];



  for(const [key,items] of grouped)for(let i=0;i<items.length;i+=100)reviewGroups.push({id:key+':'+i,items:items.slice(i,i+100)});



  const examples=[



    {title:'更懂你的偏好',record:known.find(r=>r.kind==='fact')},



    {title:'接得上之前的事',record:known.find(r=>r.kind==='event'&&r.status==='active')||known.find(r=>r.kind==='experience')},



    {title:'记得约定和进展',record:known.find(r=>['agreement','goal'].includes(r.kind)&&r.status==='active')}



  ].filter(x=>x.record);



  return {known,branches,pending,reviewGroups,examples,peopleCount:members.size,conflicted};



}







    function MemoryGarden({conversations=[],reviewRequest=0,onSummary=()=>{},botName='小鲸鱼',refreshRequest=0}) {



      const [overview,setOverview]=useState(null),[scope,setScope]=useState(''),[records,setRecords]=useState([]),[people,setPeople]=useState([]);



      const [loading,setLoading]=useState(false),[writing,setWriting]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');



      const [reload,setReload]=useState(0),[cap,setCap]=useState(2000),[partial,setPartial]=useState(false),[progress,setProgress]=useState(0);



      const [branch,setBranch]=useState(null),[query,setQuery]=useState(''),[visible,setVisible]=useState(12),[reviewOpen,setReviewOpen]=useState(false),[reviewLimit,setReviewLimit]=useState(3);



      const [detail,setDetail]=useState(null),[source,setSource]=useState(null),[edit,setEdit]=useState(null),[editText,setEditText]=useState(''),[forgetConfirm,setForgetConfirm]=useState(false);



      const [advanced,setAdvanced]=useState(false),[trace,setTrace]=useState(null),[undo,setUndo]=useState(null),[expandedGroups,setExpandedGroups]=useState([]);



      const [reviewSource,setReviewSource]=useState(null);



      const seq=React.useRef(0),detailSeq=React.useRef(0),scopeRef=React.useRef(scope),treeRef=React.useRef(null),detailRef=React.useRef(null),reviewRef=React.useRef(null),expandedRef=React.useRef(null);



      scopeRef.current=scope;



      const call=(action,data={},key=scope)=>apiPost('/api/socialV2/memory-admin',{action,key,...data}).then(value=>{if(value?.ok===false)throw Error(value.error||'暂时没有读取成功');return value;});



      const refreshOverview=()=>call('overview').then(value=>{setOverview(value);onSummary(value);}).catch(e=>setError(e.message));



      useEffect(()=>{let alive=true;const run=()=>call('overview').then(value=>{if(alive){setOverview(value);onSummary(value);}}).catch(e=>{if(alive)setError(e.message);});run();const timer=setInterval(run,60000);return()=>{alive=false;clearInterval(timer);};},[]);



      useEffect(()=>{if(refreshRequest){setReload(n=>n+1);refreshOverview();}},[refreshRequest]);



      const scopes=useMemo(()=>[...new Set([...(overview?.scopes||[]).map(s=>s.scope),...conversations.map(c=>c.key)])],[overview,conversations]);



      useEffect(()=>{if(!scope&&scopes.length)setScope(conversations[0]?.key||scopes[0]);},[scope,scopes]);



      const revision=overview?.scopes?.find(s=>s.scope===scope);



      const revisionKey=revision?`${revision.updatedAt}:${revision.records}:${revision.pending}`:'';



      useEffect(()=>{



        const token=++seq.current;if(!scope)return;let alive=true;



        setLoading(true);setError('');setProgress(0);



        (async()=>{



          const rows=[],byId=new Map();let members=[],total=0,offset=0;



          do{



            const value=await call('list',{limit:50,offset},scope);



            if(!alive||seq.current!==token)return;



            total=value.total;members=value.people||members;



            for(const record of value.records||[])byId.set(record.id,record);



            offset+=(value.records||[]).length;setProgress(offset);



            if(!(value.records||[]).length)break;



          }while(offset<total&&offset<cap);



          rows.push(...byId.values());setRecords(rows);setPeople(members);setPartial(offset<total);



          call('diagnostics',{},scope).then(value=>{if(alive&&seq.current===token)setTrace(value.trace);}).catch(()=>{});



        })().catch(e=>{if(alive&&seq.current===token)setError(e.message);}).finally(()=>{if(alive&&seq.current===token)setLoading(false);});



        return()=>{alive=false;};



      },[scope,reload,cap,revisionKey]);



      useEffect(()=>{setRecords([]);setPeople([]);setDetail(null);setSource(null);setBranch(null);setQuery('');setVisible(12);setReviewSource(null);setEdit(null);setUndo(null);setMessage('');setTrace(null);setForgetConfirm(false);setCap(2000);detailSeq.current++;},[scope]);



      useEffect(()=>{if(reviewRequest){setReviewOpen(true);reviewRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});}},[reviewRequest]);



      useEffect(()=>{if(detail)detailRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[detail?.record?.id]);



      const model=useMemo(()=>buildMemoryGarden(records,people),[records,people,overview]);



      const canLeaveEdit=()=>!edit||editText===((records.find(r=>r.id===edit)||detail?.record)?.content||'')||window.confirm('有未保存的更正，放弃更正并继续吗？');



      const beginEdit=r=>{if(!canLeaveEdit())return;setEdit(r.id);setEditText(r.content);};



      useEffect(()=>{if(branch)expandedRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[branch]);



      const currentBranch=model.branches.find(b=>b.id===branch?.id);



      const selectedRows=branch?.personId?model.known.filter(r=>r.subjectUserId===branch.personId):currentBranch&&currentBranch.id!=='people'?currentBranch.items:model.known;



      const found=selectedRows.filter(r=>!query.trim()||r.content.toLowerCase().includes(query.trim().toLowerCase())||(people.find(p=>p.id===r.subjectUserId)?.aliases||[]).some(name=>name.includes(query.trim())));



      const nameOf=id=>id==='self'?botName:people.find(p=>p.id===id)?.aliases?.at(-1)||'这位群友';



      const summary=r=>r.kind==='observation'?'看过的图片：'+r.content.replace(/^【存在未确认内容，不能据此断言身份或出处】/,'').replace(/^图\d+：/,''):r.content.replace(/^(明确偏好|明确约定)（原话）：/,'');



      const resetReading=()=>{setSource(null);setEdit(null);setForgetConfirm(false);};



      const open=async id=>{



        if(!canLeaveEdit())return;const token=++detailSeq.current,key=scope;resetReading();setError('');



        try{const value=await call('read',{id},key);if(token!==detailSeq.current||scopeRef.current!==key)return;if(!value.record||value.record.status==='forgotten'){setDetail(null);setMessage('这条记忆已经被忘掉了。');setReload(n=>n+1);return;}setDetail(value);}



        catch(e){if(token===detailSeq.current)setError(e.message);}



      };



      const mutate=async(action,data={},notice='已更新',undoable=false)=>{



        if(writing)return;detailSeq.current++;const key=scope;setWriting(true);setError('');



        try{



          const value=await call(action,data,key);if(scopeRef.current!==key)return;



          setMessage(notice);setUndo(undoable&&value.record?{id:value.record.id}:null);setEdit(null);setReviewSource(null);setSource(null);setDetail(null);setForgetConfirm(false);



          setReload(n=>n+1);await refreshOverview();



        }catch(e){if(scopeRef.current===key){setError(e.message);setReload(n=>n+1);}}



        finally{setWriting(false);}



      };



      const readSource=async(id,offset=0,forReview=false)=>{



        const token=++detailSeq.current,key=scope;setError('');



        try{const value=await call('evidence',{id,offset},key);if(token!==detailSeq.current||scopeRef.current!==key)return;(forReview?setReviewSource:setSource)({id,...value});}



        catch(e){if(token===detailSeq.current)setError(e.message);}



      };



      const approveGroup=items=>items.length===1?mutate('confirm',{id:items[0].id},'记住了，会在相关聊天中参考。',true):mutate('batchReview',{ids:items.map(r=>r.id),decision:'confirm'},'这一组已经记住了。');



      const chooseBranch=(b,personId)=>{if(!canLeaveEdit())return;setBranch({id:b.id,personId});setVisible(12);setQuery('');setDetail(null);resetReading();};



      const btn=(label,fn,extra={})=>h('button',{type:'button',onClick:fn,disabled:writing||loading,...extra},label);



      const sourceBlock=(value,forReview=false)=>value?h('div',{className:'mt-source'},value.forgotten?'这条记忆已经被忘掉了。':value.records?.map(item=>h('div',{key:item.record.id},



        h('small',null,item.source?.historical?'这是旧版原话，当前结论已更正':item.source?.excerptOnly?'旧记忆只保留了部分原话':'它是从这句话了解到的'),



        h('blockquote',null,item.source?.text||'这条记忆没有保留可回查的原话。'),



        item.source?h('div',{className:'mt-actions'},item.source.offset>0?btn('上一段',()=>readSource(value.id,Math.max(0,item.source.offset-2000),forReview)):null,item.source.nextOffset!==null?btn('下一段',()=>readSource(value.id,item.source.nextOffset,forReview)):null):null))):null;



      const record=detail?.record;



      return h('section',{'aria-label':'图形记忆树',className:'mt-garden'},



        h('div',{className:'mt-toolbar'},h('div',null,h('h2',null,botName+'的记忆树'),h('p',null,'记住相处中的人和事，让下一次聊天接得上。')),



          h('div',{className:'mt-actions'},h('select',{'aria-label':'选择聊天',value:scope,disabled:writing,onChange:e=>{if(!canLeaveEdit())return;if(advanced&&!window.confirm('切换聊天会收起高级管理，未保存的编辑不会保留。继续吗？'))return;setAdvanced(false);setScope(e.target.value);}},!scopes.length?h('option',{value:''},'还没有聊天记录'):null,scopes.map(key=>h('option',{key,value:key},conversations.find(c=>c.key===key)?.title||shortKey(key)))),btn('更新',()=>{setReload(n=>n+1);refreshOverview();}))),



        error?h('div',{role:'alert',className:'qq-alert'},error):null,



        message?h('div',{role:'status',className:'mt-message'},message,undo?btn('撤回这次确认',()=>mutate('revise',{id:undo.id,patch:{confirmed:false}},'已撤回，留待下次确认。')):null):null,



        loading?h('div',{role:'status',className:'mt-loading'},'正在整理这段交流的记忆'+(progress?' · 已读取 '+progress+' 条':'')):null,



        !scope&&!loading?h('div',{className:'mt-empty'},'开始聊天后，记忆会从这里慢慢长出来。'):null,



        h('div',{className:'mt-tree',ref:treeRef,'aria-label':'记忆树分类图'},



          h('div',{className:'mt-root'},h('svg',{viewBox:'0 0 36 40',width:36,height:40,'aria-hidden':true},h('path',{d:'M18 35V16M18 25L8 15M18 22L28 11',fill:'none',stroke:'currentColor',strokeWidth:2.5,strokeLinecap:'round'}),h('ellipse',{cx:9,cy:13,rx:6,ry:4,transform:'rotate(30 9 13)',fill:'currentColor'}),h('ellipse',{cx:27,cy:10,rx:6,ry:4,transform:'rotate(-35 27 10)',fill:'currentColor'}),h('ellipse',{cx:18,cy:9,rx:4,ry:7,fill:'currentColor'})),h('strong',null,botName),h('span',null,loading?'正在整理…':'在这里记住了 '+model.known.length+' 件事')),



          h('div',{className:'mt-branches'},model.branches.map(b=>h('section',{key:b.id,className:'mt-branch',style:{'--branch-color':b.color}},



            h('button',{type:'button',disabled:writing||loading,className:'mt-branch-head','aria-label':'展开'+b.name,'aria-pressed':branch?.id===b.id,onClick:()=>chooseBranch(b)},h('i',null,b.icon),h('strong',null,b.name),h('span',null,b.items.length)),



            h('p',{className:'mt-branch-hint'},b.hint),



            h('div',{className:'mt-leaves'},b.items.slice(0,2).map(item=>h('button',{key:item.id,type:'button',disabled:writing||loading,className:'mt-leaf',onClick:()=>b.id==='people'?chooseBranch(b,item.userId):open(item.id)},



              h('span',null,b.id==='people'?item.name:summary(item)),h('small',null,b.id==='people'?item.records.length+' 条相处记忆':item.status==='done'?'这件事已经结束':item.kind==='observation'&&item.uncertain?.length?'有些细节还不确定':'点开看看'))),



              !b.items.length?h('div',{className:'mt-empty-leaf'},'还在慢慢积累'):null),



            b.items.length>2?btn('查看全部 '+b.items.length+' '+(b.id==='people'?'人':'条'),()=>chooseBranch(b),{className:'mt-more'}):null)))),



        partial?h('div',{className:'mt-note'},'先展示最近读取的记忆，还有一些内容未展开。',btn('继续展开',()=>setCap(n=>n+2000))):null,



        !loading&&!model.known.length&&scope?h('div',{className:'mt-empty'},'这棵树还很小。明确的偏好、共同经历和约定，会逐渐成为以后聊天的线索。'):null,



        model.examples.length&&!branch&&!detail?h('section',{'aria-label':'记忆怎样帮助聊天',className:'mt-benefits'},h('div',{className:'mt-section-head'},h('h3',null,'这些记忆，能怎样帮到聊天？'),h('small',null,'下面展示的是已经保存的真实内容')),



          h('div',{className:'mt-benefit-grid'},model.examples.map(example=>h('button',{key:example.title,type:'button',disabled:writing||loading,onClick:()=>open(example.record.id)},h('strong',null,example.title),h('p',null,summary(example.record)),h('small',null,'查看这段记忆 →'))))):null,



        branch||query?h('section',{'aria-label':'展开的记忆',className:'mt-expanded',ref:expandedRef},h('div',{className:'mt-section-head'},h('h3',null,branch?.personId?nameOf(branch.personId)+'相关的记忆':currentBranch?.name||'找到的记忆'),btn('收起',()=>{if(!canLeaveEdit())return;setBranch(null);setQuery('');setDetail(null);treeRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});})),



          h('input',{'aria-label':'在记忆中找一找',placeholder:'输入一个人、一件事或关键词',value:query,onChange:e=>{setQuery(e.target.value);setVisible(12);}}),



          branch?.id==='people'&&!branch.personId?h('div',{className:'mt-person-grid'},currentBranch.items.filter(p=>!query.trim()||p.name.includes(query.trim())).map(p=>btn(p.name+' · '+p.records.length+' 条',()=>chooseBranch(currentBranch,p.userId)))):



          h('div',{className:'mt-list'},found.slice(0,visible).map(r=>h('button',{key:r.id,type:'button',disabled:writing||loading,onClick:()=>open(r.id)},h('span',null,summary(r)),h('small',null,nameOf(r.subjectUserId)+(r.status==='done'?' · 已结束':''))))),



          !found.length?h('div',{className:'mt-note'},'这里暂时没有找到记忆。'):null,



          found.length>visible?btn('再展开一些',()=>setVisible(n=>n+12)):null):null,



        record?h('section',{'aria-label':'这段记忆',className:'mt-detail',ref:detailRef},h('div',{className:'mt-section-head'},h('h3',null,'这段记忆'),btn('回到树上',()=>{if(!canLeaveEdit())return;setDetail(null);resetReading();treeRef.current?.scrollIntoView({behavior:'smooth',block:'start'});})),



          h('p',{className:'mt-detail-text'},record.content),h('small',null,nameOf(record.subjectUserId)+' · '+new Date(record.occurredAt).toLocaleDateString()+(record.expired?' · 已过期':record.status==='done'?' · 已结束':record.status==='unverified'?' · 还需要确认':record.status==='superseded'?' · 这是旧版记忆':'')),



          record.nextStep&&record.status==='active'?h('div',{className:'mt-next'},'下一步：'+record.nextStep):null,



          h('div',{className:'mt-actions'},btn('看看当时怎么说的',()=>readSource(record.id)),record.kind!=='goal'&&!['superseded','forgotten'].includes(record.status)?btn('改一下',()=>beginEdit(record)):null,



            record.status==='active'&&['event','agreement','goal'].includes(record.kind)?btn('这件事结束了',()=>mutate(record.kind==='goal'?'goal':'done',{id:record.id,...(record.kind==='goal'?{goalAction:'complete'}:{})},'已记下事情的结果，不再当作未完成事项。')):null,



            btn('忘掉这件事',()=>setForgetConfirm(true))),



          sourceBlock(source),



          edit===record.id?h('div',{className:'mt-edit'},h('textarea',{'aria-label':'更正这段记忆',maxLength:600,disabled:writing,value:editText,onChange:e=>setEditText(e.target.value)}),h('div',{className:'mt-actions'},btn('保存更正',()=>mutate('revise',{id:record.id,patch:{content:editText,confirmed:true}},'已经更正，之后参考新的说法。'),{disabled:writing||!editText.trim()}),btn('取消',()=>setEdit(null)))):null,



          forgetConfirm?h('div',{role:'alert',className:'mt-note'},'会一起忘掉这条记忆及其旧版本。确定吗？',h('div',{className:'mt-actions'},btn('确定忘掉',()=>mutate('forget',{id:record.id},'已经忘掉这件事。')),btn('保留',()=>setForgetConfirm(false)))):null):null,



        h('section',{'aria-label':'顺手确认',className:'mt-review',ref:reviewRef},



          h('div',{className:'mt-section-head'},h('div',null,h('h3',null,model.pending.length?'还有 '+model.pending.length+' 条理解，想听听你的意见':'暂时没有需要你确认的内容'),h('p',null,model.pending.length?'不急着处理，也不影响已经记住的内容。':'明确的本人陈述可以直接记住；拿不准的内容才会来问你。')),model.pending.length?btn(reviewOpen?'先收起来':'顺手看看',()=>setReviewOpen(v=>!v)):null),



          reviewOpen?h('div',{className:'mt-review-list'},model.reviewGroups.slice(0,reviewLimit).map(group=>{



            const expanded=group.items.length<=5||expandedGroups.includes(group.id),items=expanded?group.items:group.items.slice(0,5);



            return h('article',{key:group.id,className:'mt-review-card'},h('small',null,nameOf(group.items[0].subjectUserId)+'说的事'+(group.items.length>1?' · 同一句话整理出 '+group.items.length+' 条':'')),



              items.map(item=>h('div',{key:item.id,className:'mt-review-item'},h('p',null,item.content),edit===item.id?h('div',{className:'mt-edit'},h('textarea',{'aria-label':'更正理解',maxLength:600,disabled:writing,value:editText,onChange:e=>setEditText(e.target.value)}),h('div',{className:'mt-actions'},btn('这样记就对了',()=>mutate('revise',{id:item.id,patch:{content:editText,confirmed:true}},'已按你的说法记住。'),{disabled:writing||!editText.trim()}),btn('取消',()=>setEdit(null)))):null,



                h('div',{className:'mt-actions'},group.items.length===1?btn('记对了',()=>approveGroup(group.items),{className:'mt-positive'}):null,btn('改一下',()=>beginEdit(item)),btn('先不记',()=>mutate('archive',{id:item.id},'先放下这条，不会把它当作已确认记忆。')),btn('看原话',()=>readSource(item.id,0,true))),reviewSource?.id===item.id?sourceBlock(reviewSource,true):null)),



              !expanded?btn('展开其余 '+(group.items.length-5)+' 条再确认',()=>setExpandedGroups(v=>[...v,group.id])):group.items.length>1?btn('这一组都记对了（'+group.items.length+'条）',()=>approveGroup(group.items),{className:'mt-positive'}):null);



          }),model.reviewGroups.length>reviewLimit?btn('再看几条',()=>setReviewLimit(n=>n+3)):null):null),



        trace?.candidates?.some(r=>r.selected&&r.content&&r.status!=='invalidated')?h('details',{className:'mt-recent'},h('summary',null,'最近准备回忆起的内容'),h('small',null,new Date(trace.at).toLocaleString()),trace.candidates.filter(r=>r.selected&&r.content&&r.status!=='invalidated').slice(0,5).map(r=>h('p',{key:r.id},r.content))):null,



        h('details',{className:'mt-advanced',open:advanced,onToggle:e=>setAdvanced(e.currentTarget.open)},h('summary',null,'高级管理'),advanced?h(MemoryManager,{conversations,onSummary,initialScope:scope}):null));



    }







    function MemoryManager({conversations=[],reviewRequest=0,onSummary=()=>{},initialScope=''}) {



      const [overview,setOverview]=useState(null),[scope,setScope]=useState(initialScope),[tab,setTab]=useState('tree');



      const [kind,setKind]=useState(''),[status,setStatus]=useState(''),[person,setPerson]=useState('');



      const [q,setQ]=useState(''),[searchQ,setSearchQ]=useState(''),[includePending,setIncludePending]=useState(true);



      const [result,setResult]=useState(null),[detail,setDetail]=useState(null),[draft,setDraft]=useState({});



      const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');



      const [page,setPage]=useState(0),[reload,setReload]=useState(0),[forgetConfirm,setForgetConfirm]=useState(false);



      const [target,setTarget]=useState(''),[relation,setRelation]=useState('related'),[diagnostic,setDiagnostic]=useState(null);



      const [selected,setSelected]=useState([]),[batchConfirm,setBatchConfirm]=useState('');



      const [evidence,setEvidence]=useState(null),[editing,setEditing]=useState(false);



      const dirty=editing&&detail?.record&&['content','nextStep','subjectUserId'].some(k=>String(draft[k]||'')!==String(detail.record[k]||'')) || editing&&detail?.record&&((draft.tags||'')!==(detail.record.tags||[]).join('，')||draft.confirmed!==(detail.record.verified===true));



      const canLeave=()=>!dirty||window.confirm('有未保存的修改，放弃这些修改并继续？');



      const evidenceSeq=React.useRef(0),diagnosticSeq=React.useRef(0);



      const requestSeq=React.useRef(0),detailSeq=React.useRef(0);



      const K={fact:'人物与偏好',event:'事件',agreement:'约定',thought:'临时想法',experience:'实际经历',observation:'图片观察',goal:'自己的目标',style:'表达习惯',knowledge:'知识与方法'};



      const ST={active:'有效',done:'已完成',archived:'已归档',unverified:'待核实',superseded:'已被更正',forgotten:'已遗忘'};



      const EV={statement:'本人陈述',reported:'他人转述',inference:'推断',joke:'玩笑',legacy:'无来源旧记忆',admin:'管理员审阅',visual:'实际视觉分析',tool:'真实工具结果',state:'目标状态记录'};



      const RT={related:'相关',follows:'后续',contradicts:'冲突',goal:'目标关联',supports:'依赖来源'};



      const css={input:{...S.btn,padding:'6px 8px',boxSizing:'border-box',minWidth:0},textarea:{...S.btn,width:'100%',padding:8,minHeight:100,boxSizing:'border-box',resize:'vertical',lineHeight:1.6},label:{display:'flex',flexDirection:'column',gap:4,fontSize:12},small:{...S.tiny,...S.dim},group:{display:'flex',flexDirection:'column',gap:8}};



      const date=value=>value?new Date(value).toLocaleString():'无记录';



      const call=(action,data={})=>apiPost('/api/socialV2/memory-admin',{action,key:scope,...data}).then(value=>{if(value?.ok===false)throw new Error(value.error||'记忆操作失败');return value;});



      const refreshOverview=()=>call('overview').then(value=>{setOverview(value);onSummary(value);}).catch(e=>setError(e.message));



      useEffect(()=>{refreshOverview();const timer=setInterval(refreshOverview,30000);return()=>clearInterval(timer);},[]);



      const scopes=useMemo(()=>[...new Set([...(overview?.scopes||[]).map(s=>s.scope),...conversations.map(c=>c.key)])],[overview,conversations]);



      const scopeInfo=overview?.scopes?.find(item=>item.scope===scope);



      const scopeRevision=scopeInfo?`${scopeInfo.updatedAt||0}:${scopeInfo.records}:${scopeInfo.pending}:${JSON.stringify(scopeInfo.reviewRevision||{})}`:'';



      useEffect(()=>{if(!scope&&scopes.length)setScope(scopes[0]);},[scopes,scope]);



      useEffect(()=>{



        const seq=++requestSeq.current;if(!scope)return;



        setError('');setBusy(true);



        const selectedKind=tab==='style'?'style':tab==='self'?(kind||'experience'):kind;



        const selectedStatus=tab==='pending'?'unverified':status;



        call(tab==='affinity'?'affinity':searchQ?'search':'list',{q:searchQ,kind:selectedKind||undefined,status:selectedStatus||undefined,person:person||undefined,includeUnverified:includePending,limit:20,offset:page*20})



          .then(value=>{if(seq===requestSeq.current)setResult(value);})



          .catch(e=>{if(seq===requestSeq.current)setError(e.message);})



          .finally(()=>{if(seq===requestSeq.current)setBusy(false);});



      },[scope,tab,kind,status,person,searchQ,includePending,page,reload,scopeRevision]);



      useEffect(()=>{setSelected([]);setBatchConfirm('');},[scope,tab,kind,status,person,searchQ,includePending,page,reload,scopeRevision]);



      useEffect(()=>{setDetail(null);setEditing(false);setEvidence(null);evidenceSeq.current++;diagnosticSeq.current++;setForgetConfirm(false);detailSeq.current++;},[scope,tab,kind,status,person,searchQ,page]);



      useEffect(()=>{if(reviewRequest){if(!canLeave())return;setTab('pending');setPage(0);setSearchQ('');setStatus('');}},[reviewRequest]);



      const chooseScope=value=>{if(!canLeave())return;setScope(value);setQ('');setSearchQ('');setPage(0);setPerson('');setDiagnostic(null);setNotice('');};



      const open=async id=>{



        if(!canLeave())return;setEditing(false);



        const seq=++detailSeq.current;evidenceSeq.current++;setEvidence(null);setBusy(true);setError('');setForgetConfirm(false);



        try{const value=await call('read',{id});if(seq!==detailSeq.current)return;setDetail(value);const r=value.record;setDraft(r?{content:r.content,nextStep:r.nextStep||'',subjectUserId:r.subjectUserId||'',tags:(r.tags||[]).join('，'),confirmed:r.verified===true,reason:''}:{});}



        catch(e){if(seq===detailSeq.current)setError(e.message);}finally{if(seq===detailSeq.current)setBusy(false);}



      };



      const mutate=async(action,data={})=>{



        if(busy)return;setBusy(true);setError('');setNotice('');



        try{const value=await call(action,{id:detail?.record?.id,...data});setEditing(false);evidenceSeq.current++;setEvidence(null);setNotice(action==='forget'?'已遗忘：版本和依赖摘要已撤下':'已保存');setForgetConfirm(false);setReload(n=>n+1);await refreshOverview();if(value.record){const full=await call('read',{id:value.record.id});setDetail(full);setDraft({...draft,content:value.record.content,confirmed:value.record.verified===true});}else setDetail(null);}



        catch(e){setError(e.message);}finally{setBusy(false);}



      };



      const runSearch=()=>{if(busy||!canLeave())return;setPage(0);setSearchQ(q.trim());setReload(n=>n+1);};



      const collectRecent=async()=>{



        if(busy||!scope)return;setBusy(true);setError('');setNotice('');



        try{const value=await call('collectCandidates');const c=value.collection;setNotice(c.enabled?`已筛选近期 ${c.scanned} 条收到消息，新增 ${c.created} 条待核实候选，跳过重复 ${c.duplicates} 条。`+(value.candidateReview?.requested?'语义回顾已排队，等待正常唤醒并满足回顾间隔；不会额外叫醒。':'没有明确依据时不会凑候选。'):'聊天候选筛选已关闭，请在检索诊断中开启。');setTab('tree');setKind('');setPerson('');setStatus('unverified');setPage(0);setQ('');setSearchQ('');setReload(n=>n+1);await refreshOverview();}



        catch(e){setError(e.message);}finally{setBusy(false);}



      };



      const runDiagnostic=async(action,body={})=>{if(busy)return;setBusy(true);setError('');try{setDiagnostic(await call(action,body));await refreshOverview();}catch(e){setError(e.message);}finally{setBusy(false);}};



      const loadEvidence=async(offset=0)=>{



        if(busy||!detail?.record?.id)return;



        const seq=++evidenceSeq.current,detailVersion=detailSeq.current;



        setBusy(true);setError('');



        try{const value=await call('evidence',{id:detail.record.id,offset});if(seq===evidenceSeq.current&&detailVersion===detailSeq.current)setEvidence(value);}



        catch(e){if(seq===evidenceSeq.current)setError(e.message);}



        finally{if(seq===evidenceSeq.current)setBusy(false);}



      };



      useEffect(()=>{



        if(tab!=='diagnostics'||!scope)return;



        const seq=++diagnosticSeq.current;



        call('diagnostics').then(value=>{if(seq===diagnosticSeq.current)setDiagnostic(value);}).catch(e=>{if(seq===diagnosticSeq.current)setError(e.message);});



        return()=>{diagnosticSeq.current++;};



      },[scope,tab,reload]);



      const record=detail?.record;



      const records=result?.records||[];



      const reviewable=records.filter(item=>item.status==='unverified'&&item.kind!=='goal');



      const batchReview=async()=>{



        if(busy||!selected.length||!batchConfirm)return;setBusy(true);setError('');setNotice('');



        try{const value=await call('batchReview',{ids:selected,decision:batchConfirm});setNotice(`已批量${batchConfirm==='confirm'?'确认':'拒绝/归档'} ${value.reviewed} 条记忆`);setSelected([]);setBatchConfirm('');setDetail(null);setReload(n=>n+1);await refreshOverview();}



        catch(e){setError(e.message);setSelected([]);setBatchConfirm('');setReload(n=>n+1);}finally{setBusy(false);}



      };



      const immutable=record&&['superseded','forgotten'].includes(record.status);



      const systemGoal=record?.kind==='goal';



      const groups=Object.keys(K).map(type=>({type,items:records.filter(r=>r.kind===type)})).filter(g=>g.items.length);



      const setField=(field,value)=>setDraft(current=>({...current,[field]:value}));



      const select=(label,value,onChange,options)=>h('label',{style:{...css.label,maxWidth:'100%'}},label,h('select',{'aria-label':label,value,disabled:busy,onChange:e=>{if(canLeave())onChange(e.target.value);},style:{...css.input,maxWidth:'100%'}},options.map(([value,label])=>h('option',{key:value,value,style:{color:'#111827',backgroundColor:'#ffffff'}},label))));



      const actionButton=(label,onClick,disabled=false,extra={})=>h('button',{type:'button',style:S.btn,onClick,disabled:busy||disabled,...extra},label);



      return h('section',{'aria-label':'记忆树管理',className:'qq-memory',style:{...S.card,padding:14,gap:12}},



        h('div',{style:S.head},h('h3',{style:{fontSize:19}},'记忆中心'),h('span',{style:S.pill},'按会话保存'),overview?h('span',{style:S.dim},`${overview.totals.current ?? (overview.totals.records-overview.totals.forgotten)} 条 · ${overview.totals.pending} 条待核实`):null,h('span',{style:{marginLeft:'auto'}}),actionButton('刷新',()=>{refreshOverview();setReload(n=>n+1);})),



        h('div',{style:css.small},'按会话浏览共同经历与偏好，核对来源，让每一次记住都有依据。'),



        h('div',{'aria-label':'当前会话记忆统计',style:css.small},scopeInfo?`当前会话 · ${scopeInfo.records} 条记忆 · ${scopeInfo.pending} 条待审核`:'请选择会话查看记录。'),



        h('div',{style:{...S.row,alignItems:'end'}},



          select('会话',scope,chooseScope,[['','选择会话'],...scopes.map(key=>{const count=overview?.scopes.find(s=>s.scope===key);return [key,shortKey(key)+(count?` · 当前 ${count.records} 条 · 待核实 ${count.pending} 条`:'')];})]),



          h('label',{style:{...css.label,flex:1,minWidth:180}},'回忆线索',h('input',{'aria-label':'回忆线索',style:{...css.input,width:'100%'},placeholder:'如：玩一会儿就退回桌面',value:q,onChange:e=>setQ(e.target.value),onKeyDown:e=>{if(e.key==='Enter')runSearch();}})),



          actionButton('搜索',runSearch,!scope),searchQ?actionButton('清除搜索',()=>{setQ('');setSearchQ('');setPage(0);}):null),



        h('div',{role:'tablist','aria-label':'记忆分类',style:S.row},[['tree','全部记忆'],['pending','待审核'],['self','经历与目标'],['style','表达习惯'],['affinity','人物关系'],['diagnostics','检索诊断']].map(([value,label])=>h('button',{key:value,type:'button',role:'tab','aria-selected':tab===value,disabled:busy,style:{...S.btn,background:tab===value?'rgba(85,150,240,.16)':'transparent',borderColor:tab===value?'#6ca9ef':'rgba(128,128,128,.4)'},onClick:()=>{if(!canLeave())return;setNotice('');setError('');setTab(value);setKind('');setStatus('');setPerson('');setPage(0);setQ('');setSearchQ('');setDiagnostic(null);}},label))),



        error?h('div',{role:'alert',style:S.err},error):null,notice?h('div',{role:'status',style:S.ok},notice):null,



        tab==='affinity'?h('section',{'aria-label':'人物好感度',style:css.group},



          h('div',{style:css.small},'管理员固定 100 分，其他人 0–95 分。基础 50 分，按近30天与机器人的有效互动和明确态度计算；有效记忆可补充历史态度。普通群聊旁观不加分，同一5分钟和每日都有上限。'),



          h('div',{style:css.small},'疑似玩笑、引用、否定和含糊表达按中性处理。评分只影响交流亲疏，管理权限始终按 QQ 身份判断。'),



          (result?.people||[]).map(p=>h('div',{key:p.userId,style:{...S.card,padding:12}},



            h('div',{style:S.row},h('strong',null,(p.aliases?.at(-1)||p.userId)+' · QQ '+p.userId),p.isAdmin?h('span',{style:S.pill},'管理员'):null,h('strong',{style:{marginLeft:'auto'}},p.score+' / 100')),



            h('div',{style:css.small},p.level),



            p.fixed?h('div',{style:css.small},'固定最高，不受互动频率和负面记忆影响。'):h('div',{style:css.small},`近30天有效互动 ${p.interactions} 次 / ${p.activeDays} 天 · 频率 +${p.frequencyBonus} · 态度 ${p.attitudeBonus>=0?'+':''}${p.attitudeBonus} · 正向 ${p.positive} / 负向 ${p.negative} · 历史记忆依据 ${p.memoryEvidence} 条`))),



          !result?.people?.length?h('div',{style:S.dim},busy?'正在计算…':'当前会话尚无人物记录。'):null



        ):tab==='diagnostics'?h('div',{style:css.group},



          h('div',{style:S.row},h('span',{style:S.pill},overview?.semantic?.state==='ready'?'语义模型就绪':'语义模型：'+(overview?.semantic?.state||'读取中')),h('span',{style:S.dim},`${overview?.semantic?.indexed||0} 条向量 · ${overview?.semantic?.indexing?'正在更新索引':'索引待命'}`)),



          h('div',{style:css.small},'中文嵌入在本机 CPU 运行。只搜索选定会话；模型不可用时保留关键词搜索，不切换收费 API。'),



          overview?.semantic?.error?h('div',{style:S.err},overview.semantic.error):null,



          h('div',{style:S.row},actionButton('查看交接与召回选取',()=>runDiagnostic('diagnostics'),!scope),actionButton('更新当前会话索引',()=>runDiagnostic('reindex'),!scope),actionButton('查看检索用量',()=>runDiagnostic('metrics'),!scope),actionButton('运行回忆样例',()=>runDiagnostic('evaluate'),!scope)),



          h('div',{style:css.group},h('strong',null,'功能开关'),Object.entries({semantic:'本地语义检索',autoInject:'自动注入相关记忆',memoryCandidates:'持续筛选明确偏好与约定（待核实）',styleLearning:'提出表达习惯候选',styleReview:'低频自动表达回顾',imageMemory:'保留实际图片观察',experienceMemory:'保留真实工具经历'}).map(([key,label])=>h('label',{key,style:S.label},h('input',{type:'checkbox',checked:overview?.settings?.[key]!==false,disabled:busy,onChange:e=>mutate('settings',{settings:{[key]:e.target.checked}})}),label))),



          diagnostic?.handoff?h('section',{'aria-label':'交接与召回选取',style:css.group},



            h('strong',null,'当前有效交接'),



            diagnostic.handoff.records.length?diagnostic.handoff.records.map(n=>h('div',{key:n.id,style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},n.content+'；下一步：'+(n.nextStep||'尚未明确'))):h('div',{style:css.small},'暂无有效交接事项。'),



            h('strong',null,'最近一次记忆上下文选取'),



            h('div',{style:css.small},'记录最近一次生成的记忆上下文，不代表模型已经采用其中的事实。重启后重新积累。'),



            !diagnostic.trace?h('div',{style:css.small},'本次启动尚无选取记录，待正常交流后产生。'):diagnostic.trace.disabled?h('div',null,'自动注入已关闭'):h(React.Fragment,null,



              h('div',{style:css.small},date(diagnostic.trace.at)+` · 估算 ${diagnostic.trace.usedTokens}/${diagnostic.trace.budget} token（关系状态另计）`),



              diagnostic.trace.candidates.map(n=>h('div',{key:n.id,style:{overflowWrap:'anywhere'}},(n.status==='invalidated'?'已失效':n.selected?'入选':'未入选')+' · '+(n.content||n.id)+' · '+n.reasons.map(v=>({query:'话题匹配',prepared:'预检索',participant:'当前参与者',handoff:'交接'}[v]||v)).join('、')+(n.excluded?'；'+({budget:'预算或条数上限',conflict:'存在冲突',question:'疑问句不作事实'}[n.excluded]||n.excluded):''))))):null,



          diagnostic&&!diagnostic.handoff?h('div',{style:css.group},diagnostic.hitAt5!==undefined?h('div',null,diagnostic.hitAt5===null?'尚无回忆样例。先选中一条记忆，用一种新的问法保存样例。':`前5条命中率：${Math.round(diagnostic.hitAt5*100)}%（仅当前 ${diagnostic.cases.length} 个样例）`):null,



            h('pre',{style:{...S.mono,whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:300,overflow:'auto',fontSize:11}},JSON.stringify(diagnostic,null,2))):null,



        ):h(React.Fragment,null,



          ['tree','pending'].includes(tab)?h('details',{'aria-label':'聊天候选筛选',style:css.group},h('summary',null,'候选筛选与学习状态'),h('div',{style:S.row},actionButton('从近期聊天筛选候选',collectRecent,!scope||!/^(group|private):/.test(scope)),h('span',{style:css.small},result?.candidates?.enabled===false?'持续筛选已关闭':'新消息持续筛选 · 仅生成待核实候选')),



            h('div',{style:css.small},'新消息本地筛选明确偏好和约定；语义回顾搭载已有唤醒，每会话最多每小时一次、全局每天最多8次，不额外启动模型任务。结果一律待核实。手动筛选使用保留的近期消息（本地7天内，回顾24小时内），不保存每句闲聊、表情或玩笑。'),



            result?.candidateReview?h('div',{'aria-label':'聊天语义回顾状态',style:css.small},'语义回顾：'+(!result.candidateReview.enabled?'已关闭':result.candidateReview.requested?'已排队，等待正常唤醒':result.candidateReview.latest?({issued:'已安排，尚未提交',completed:'已完成，候选 '+result.candidateReview.latest.candidateCount+' 条',cancelled:'已取消，等待后续交流',expired:'已过期，等待后续交流'}[result.candidateReview.latest.status]||result.candidateReview.latest.status):'等待新交流满足条件')):null,



            result?.candidates?.stats?h('div',{style:css.small},`最近筛选：${date(result.candidates.stats.lastScanAt)} · 累计新增候选 ${result.candidates.stats.created} 条`):null):null,



          tab==='style'?h('div',{style:css.small},'候选需要多条真实交流作依据。确认后只作本会话的表达参考，不复制真人口头禅，也不替代人格。'):null,



          tab==='style'&&result?.review?h('details',{'aria-label':'表达回顾状态',style:css.group},h('summary',null,'表达回顾状态'),



            h('div',{style:css.small},'仅搭载已有唤醒；至少12条新收到消息和3条自己回复，每会话24小时最多一次、全局最多两次。未审核候选存在时暂缓；不额外叫醒或自动修改人格。'),



            h('div',{style:css.small},'回顾：'+(result.review.enabled?'已开启':'已关闭')+' · 最近任务 '+result.review.runs.length+' 项'),



            result.review.runs.map(run=>h('div',{key:run.id,style:css.small},date(run.issuedAt)+' · '+({issued:'已安排，尚未报告完成',completed:'已报告回顾完成',cancelled:'已取消',expired:'未完成已过期'}[run.status]||run.status)+' · 候选 '+run.candidateCount+' 条')),



            h('div',{style:css.small},'完成只表示模型提交了回顾结果；候选为零是有效结果，不代表表达质量已经提升。')):null,



          tab==='self'?h('div',{style:css.small},'这些记录来自真实工具返回、已完成的图片观察与目标状态；目标完成标记不等于外部任务已成功。'):null,



          h('div',{style:{...S.row,alignItems:'end'}},



            tab!=='style'?select('类型',kind,value=>{setKind(value);setPage(0);},tab==='self'?[['','实际经历'],['observation','图片观察'],['goal','自己的目标']]:[['','全部类型'],...Object.entries(K)]):null,



            tab!=='pending'?select('状态',status,value=>{setStatus(value);setPage(0);},[['','当前版本'],['unverified','待核实'],['active','有效'],['done','已完成'],['archived','已归档'],['superseded','历史版本']]):h('span',{style:S.pill},'待核实记录'),



            ['tree','pending'].includes(tab)?select('人物',person,value=>{setPerson(value);setPage(0);},[['','所有人物'],['self','小鲸鱼自己'],...(result?.people||[]).map(p=>[p.id,p.aliases.at(-1)+' ('+p.id+')'])]):null,



            h('label',{style:S.label},h('input',{type:'checkbox',checked:includePending,onChange:e=>setIncludePending(e.target.checked)}),'搜索包含待核实记录'),



            h('span',{style:css.small},busy?'读取中…':searchQ?`混合召回 ${records.length} 条`:`${result?.total||0} 条`)),



          h('div',{className:'qq-memory-columns',style:{display:'flex',flexWrap:'wrap',gap:18,alignItems:'flex-start'}},



            h('div',{className:'qq-memory-list',style:{flex:'1 1 300px',minWidth:0,...css.group}},



              reviewable.length?h('section',{'aria-label':'批量审核',className:'qq-batch',style:css.group},



                h('div',{style:S.row},h('label',{style:S.label},h('input',{'aria-label':'全选当前页待核实',type:'checkbox',disabled:busy||!reviewable.length,checked:reviewable.length>0&&reviewable.every(item=>selected.includes(item.id)),onChange:e=>{setSelected(e.target.checked?reviewable.map(item=>item.id):[]);setBatchConfirm('');}}),'全选当前页待核实'),h('span',{style:css.small},`已选 ${selected.length} 条`),actionButton('只看待核实',()=>{setStatus('unverified');setPage(0);}),actionButton('批量确认',()=>setBatchConfirm('confirm'),!selected.length),actionButton('批量拒绝/归档',()=>setBatchConfirm('reject'),!selected.length)),



                batchConfirm?h('div',{role:'alert',style:css.group},h('div',null,`将${batchConfirm==='confirm'?'核实并启用':'拒绝并归档'}选中的 ${selected.length} 条记录。请核对下方内容和来源。`),h('div',{style:S.row},actionButton(batchConfirm==='confirm'?'确认批量核实':'确认批量拒绝',batchReview,!selected.length),actionButton('取消批量操作',()=>setBatchConfirm('')))):null):null,



              !records.length?h('div',{style:{...S.dim,padding:'18px 4px'}},busy?'正在读取…':'当前筛选下没有记录。旧便签可勾选待核实后搜索。'):null,



              groups.map(group=>h('details',{key:group.type,open:true,style:{border:'1px solid rgba(128,128,128,.2)',borderRadius:8,padding:'6px 8px'}},



                h('summary',{style:{cursor:'pointer',fontWeight:600,padding:'3px 0'}},K[group.type]+' · '+group.items.length),



                group.items.map(item=>h('div',{key:item.id},item.status==='unverified'&&item.kind!=='goal'?h('label',{style:{...S.label,marginTop:6}},h('input',{'aria-label':'选择审核 '+item.content,type:'checkbox',disabled:busy,checked:selected.includes(item.id),onChange:e=>{setSelected(current=>e.target.checked?[...current,item.id]:current.filter(id=>id!==item.id));setBatchConfirm('');}}),'选择审核'):null,h('button',{type:'button',disabled:busy,'aria-label':'查看记忆 '+item.content,className:'qq-record','aria-pressed':record?.id===item.id,style:{...S.btn,display:'block',textAlign:'left',width:'100%',marginTop:6,padding:9,background:record?.id===item.id?'rgba(85,150,240,.12)':'transparent'},onClick:()=>open(item.id)},



                  h('div',{style:{display:'flex',gap:5,flexWrap:'wrap',marginBottom:4}},h('span',{style:{...S.pill,color:item.status==='unverified'?'#d9a441':undefined}},ST[item.status]||item.status),h('span',{style:css.small},EV[item.evidence]||item.evidence),item.subjectUserId?h('span',{style:css.small},item.subjectUserId==='self'?'小鲸鱼自己':item.subjectUserId):null),



                  h('div',{className:'qq-record-content',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:1.65}},item.content),



                  h('div',{style:{...css.small,marginTop:3}},date(item.occurredAt),item.retrieval?.semantic?` · 语义 ${item.retrieval.semantic.toFixed(2)}`:'')))))),



              !searchQ&&result?.total>20?h('div',{style:S.row},actionButton('上一页',()=>setPage(p=>Math.max(0,p-1)),page===0),h('span',{style:css.small},`第 ${page+1} 页`),actionButton('下一页',()=>setPage(p=>p+1),(page+1)*20>=result.total)):null),



            record?h('aside',{'aria-label':'记忆详情',className:'qq-memory-detail',style:{...S.card,flex:'1 1 340px',minWidth:0,maxWidth:'100%',background:'rgba(128,128,128,.035)'}},



              h('div',{style:S.head},h('strong',null,'记忆详情'),h('span',{style:S.pill},K[record.kind]),h('span',{style:S.pill},ST[record.status])),



              h('div',{style:css.small},date(record.occurredAt)),



              h('div',{className:'qq-detail-reading'},



                h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:15,lineHeight:1.85,margin:'4px 0 14px'}},record.content),



                record.nextStep?h('div',{className:'qq-next-step'},h('strong',null,'下一步'),h('div',null,record.nextStep)):null,



                h('div',{style:css.small},(record.subjectUserId==='self'?'机器人自身':record.subjectUserId?'主体 QQ '+record.subjectUserId:'主体待核实')+' · '+(EV[record.evidence]||record.evidence)),



                h('div',{style:{...S.row,marginTop:12}},actionButton(editing?'收起编辑':'编辑记忆',()=>{if(editing&&!canLeave())return;if(editing)setDraft({content:record.content,nextStep:record.nextStep||'',subjectUserId:record.subjectUserId||'',tags:(record.tags||[]).join('，'),confirmed:record.verified===true,reason:''});setEditing(v=>!v);},immutable||systemGoal),actionButton('查看来源原文',()=>loadEvidence(0)),!editing&&record.status==='unverified'&&!systemGoal?actionButton('确认这条记忆',()=>mutate('confirm',{patch:{content:record.content},reason:'管理员核实'}),immutable):null)),



              systemGoal?h('details',null,h('summary',null,'目标操作'),



                h('label',{style:css.label},'下一步',h('input',{'aria-label':'目标下一步',style:css.input,value:draft.nextStep||'',onChange:e=>setField('nextStep',e.target.value)})),



                h('div',{style:S.row},actionButton('更新目标下一步',()=>mutate('goal',{goalAction:'progress',nextStep:draft.nextStep}),immutable||!draft.nextStep?.trim()),actionButton('完成目标',()=>mutate('goal',{goalAction:'complete'}),immutable),actionButton('归档目标',()=>mutate('goal',{goalAction:'abandon'}),immutable))):null,



              h('div',{hidden:!editing,className:'qq-edit-form'},



              h('label',{style:css.label},'内容',h('textarea',{'aria-label':'记忆内容',style:css.textarea,value:draft.content||'',disabled:immutable||systemGoal,onChange:e=>setField('content',e.target.value)})),



              h('label',{style:css.label},'主体 QQ / self',h('input',{'aria-label':'主体 QQ',style:css.input,value:draft.subjectUserId||'',disabled:immutable||systemGoal,onChange:e=>setField('subjectUserId',e.target.value)})),



              h('label',{style:css.label},'下一步（已完成事项可留空）',h('input',{'aria-label':'下一步',style:css.input,value:draft.nextStep||'',disabled:immutable,onChange:e=>setField('nextStep',e.target.value)})),



              h('label',{style:css.label},'关键词',h('input',{'aria-label':'关键词',style:css.input,value:draft.tags||'',disabled:immutable||systemGoal,onChange:e=>setField('tags',e.target.value)})),



              h('label',{style:S.label},h('input',{'aria-label':'我已核实',type:'checkbox',checked:!!draft.confirmed,disabled:immutable||systemGoal,onChange:e=>setField('confirmed',e.target.checked)}),'我已核实此内容'),



              h('label',{style:css.label},'纠正原因',h('input',{'aria-label':'纠正原因',style:css.input,value:draft.reason||'',disabled:immutable,onChange:e=>setField('reason',e.target.value)})),



              h('div',{style:S.row},actionButton('保存纠正',()=>mutate('revise',{patch:{...draft,tags:(draft.tags||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean)}}),immutable||systemGoal||!draft.content?.trim()),actionButton('确认这条记忆',()=>mutate('confirm',{patch:{content:draft.content,subjectUserId:draft.subjectUserId},reason:draft.reason}),immutable||systemGoal),systemGoal?actionButton('更新下一步',()=>mutate('goal',{goalAction:'progress',nextStep:draft.nextStep}),immutable||!draft.nextStep?.trim()):null,actionButton('标记完成',()=>mutate(systemGoal?'goal':'done',systemGoal?{goalAction:'complete'}:{}),immutable),actionButton(record.kind==='style'?'拒绝/归档':'归档',()=>mutate(systemGoal?'goal':'archive',systemGoal?{goalAction:'abandon'}:{}),immutable)),



              ),



              h('details',null,h('summary',{style:{cursor:'pointer',fontWeight:600}},'来源与不确定性'),



                h('div',{style:{...css.group,marginTop:6}},h('div',{style:css.small},EV[record.evidence]||record.evidence),



                  record.source?h('div',{style:{...S.mono,overflowWrap:'anywhere',fontSize:11}},`发送者：${record.source.userId} · 引用：${record.source.messageRef}`):h('div',{style:css.small},'没有可核对的原始来源；确认前请自行核实。'),



                  record.source?.excerpt?h('blockquote',{style:{margin:0,padding:'6px 10px',borderLeft:'2px solid #7a93ae',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},record.source.excerpt,record.source.excerptMayBeTruncated?h('div',{style:css.small},'摘录可能截断，可按消息引用回查原始聊天。'):null):null,



                  record.uncertain?.length?h('div',{style:{color:'#d9a441'}},'未确认：'+record.uncertain.join('；')):null,



                  record.metadata?.visibleText?.length?h('div',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},'图中文字：'+record.metadata.visibleText.join('；')):null,



                  record.metadata?.sampleSources?.map(source=>h('div',{key:source.id,style:css.small},`${source.userId} · ${source.messageRef}：${source.excerpt}`)),



                  record.metadata?.meaning?h('div',{style:css.small},record.metadata.meaning):null)),



              evidence?h('section',{'aria-label':'来源原文回查',className:'qq-evidence',style:css.group},h('strong',null,'消息原文'),



                evidence?.forgotten?h('div',null,'此记忆已遗忘'):null,



                evidence?.records?.map(item=>h('div',{key:item.record.id,style:css.group},



                  h('div',{style:css.small},'当前版本：'+item.record.content+(item.conflicted?'（存在冲突）':'')),



                  item.source?h(React.Fragment,null,



                    h('div',{style:css.small},(item.source.historical?'旧版来源，不能当作新结论的原话；':'')+(item.source.excerptOnly?'旧记录仅有摘录':item.source.storedTruncated?'留存时已截断':'已留存来源文本')+' · '+item.source.messageRef),



                    h('blockquote',{style:{margin:0,padding:10,borderLeft:'2px solid #7a93ae',whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflow:'auto'}},item.source.text||'来源文本为空'),



                    h('div',{style:S.row},item.source.offset>0?actionButton('上一段原文',()=>loadEvidence(Math.max(0,item.source.offset-2000))):null,item.source.nextOffset!==null?actionButton('下一段原文',()=>loadEvidence(item.source.nextOffset)):null)):



                    h('div',{style:css.small},'无可回查的消息来源。')))):null,



              h('details',null,h('summary',{style:{cursor:'pointer',fontWeight:600}},'版本记录 · '+(detail.versions?.length||1)),h('div',{style:css.group},(detail.versions||[]).map(version=>h('div',{key:version.id,style:{padding:'6px 0',borderBottom:'1px solid rgba(128,128,128,.18)'}},h('div',{style:css.small},ST[version.status]+' · '+date(version.occurredAt)),h('div',{style:{overflowWrap:'anywhere'}},version.content))))),



              h('details',null,h('summary',{style:{cursor:'pointer',fontWeight:600}},'关联与前因后果'),



                h('div',{style:{...css.group,marginTop:6}},(record.relations||[]).map(link=>h('div',{key:link.id,style:S.row},actionButton(RT[link.type]+' · '+link.id.slice(0,8),()=>open(link.id)),actionButton('解除',()=>mutate('unlink',{fromId:record.id,toId:link.id}),immutable))),



                  (detail.incoming||[]).map(link=>h('div',{key:link.record.id,style:S.row},actionButton('被关联：'+RT[link.type]+' · '+link.record.content.slice(0,35),()=>open(link.record.id)))),



                  h('input',{'aria-label':'关联记忆 ID',placeholder:'要关联的当前记忆 ID',style:css.input,value:target,onChange:e=>setTarget(e.target.value)}),



                  select('关系',relation,setRelation,Object.entries(RT)),actionButton('添加关联',()=>mutate('link',{fromId:record.id,toId:target,relation}),immutable||!target.trim()),h('div',{style:css.small},'“依赖来源”表示此内容是目标记录的派生摘要；目标被纠正或遗忘时，摘要一起撤下。'))),



              h('details',null,h('summary',{style:{cursor:'pointer',fontWeight:600}},'高级：回忆样例与记录标识'),h('div',{style:{...S.mono,fontSize:10,overflowWrap:'anywhere'}},record.id+' · '+record.factKey),h('div',{style:css.group},h('div',{style:css.small},'用上方“回忆线索”输入一种新的问法，以这条记忆作期望答案。'),actionButton('保存当前问法与这条记忆',()=>mutate('case',{q:q.trim(),expectedIds:[record.id]}),!q.trim()))),



              h('details',{className:'qq-danger'},h('summary',null,'遗忘与移除'),forgetConfirm?h('div',{role:'alert',style:css.group},h('div',null,'将遗忘这条记忆、历史版本和依赖摘要，并阻止从相同来源自动重建。QQ 原始聊天和备份另行管理。'),h('div',{style:S.row},actionButton('确认遗忘',()=>mutate('forget'),false,{style:{...S.btn,color:'#e46f69'}}),actionButton('取消',()=>setForgetConfirm(false)))):actionButton('遗忘这条记忆',()=>setForgetConfirm(true),immutable,{style:{...S.btn,color:'#e46f69'}}))



            ):h('div',{style:{...S.dim,flex:'1 1 300px',padding:'20px 6px'}},'选择左侧记忆，在这里阅读内容、核对来源或进行纠正。'))



        )



      );



    }



















    // 梗百科（2026-11-01 加）：词条总数、开关、玩梗尺度滑杆、现场试查。



    function growthManagementKey(ownerQQ,conversations=[]) {



      const owner=String(ownerQQ||'').trim();



      if(/^[1-9]\d{4,19}$/.test(owner))return 'private:'+owner;



      return (Array.isArray(conversations)?conversations:[]).find(c=>/^(group|private):[1-9]\d{4,19}$/.test(c?.key))?.key||'';



    }



    function mountVoiceConsole(root,token) {
      root.innerHTML = "\n<h1>小鲸鱼 · 语音通话</h1><p>通话接通后自动收听，挂断后自动停止。控制台可以关闭。</p>\n<p><small>语音在本机识别，文字发送至已配置的对话和语音合成服务；合成音频缓存在本机。</small></p>\n<label>接收声音（输入）<select id=\"input\"></select></label><label>小鲸鱼说话（输出）<select id=\"output\"></select></label>\n<label>声音阈值 <input id=\"threshold\" type=\"range\" min=\"0.005\" max=\"0.12\" step=\"0.005\" value=\"0.025\"><span id=\"thresholdValue\">0.025</span></label>\n<p><button id=\"refresh\">刷新设备</button><button id=\"save\">保存设备设置</button><button id=\"start\">恢复监听</button><button id=\"stop\">暂停监听</button><button id=\"interrupt\">打断</button></p>\n<p id=\"status\" role=\"status\">连接通话服务中…</p><div id=\"log\" aria-live=\"polite\"></div>\n";
      
const $=id=>root.querySelector('#'+id);
let closed=false,busy=false,devicesSignature='';
async function request(url,options={}){const r=await fetch('http://127.0.0.1:59281'+url,{...options,headers:{'x-call-token':token,...options.headers}});if(!r.ok){let e=await r.json().catch(()=>({}));throw Error(e.error||'请求失败')}return r.json();}
function options(select,names,current){select.replaceChildren();for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}const match=names.find(x=>x===current)||names.find(x=>x.startsWith(current));if(match)select.value=match;}
async function refresh(){if(closed||busy)return;try{const state=await request('/audio-state');if(closed)return;$('status').textContent=state.phase||'等待 QQ 语音通话';$('log').textContent=(state.log||[]).map(x=>x.who+'：'+x.text).join('\n');const d=state.devices||{},signature=JSON.stringify([d.inputs,d.outputs,d.input,d.output,d.threshold]);if(signature!==devicesSignature&&document.activeElement!==$('input')&&document.activeElement!==$('output')&&document.activeElement!==$('threshold')){devicesSignature=signature;options($('input'),d.inputs||[],d.input||'');options($('output'),d.outputs||[],d.output||'');$('threshold').value=d.threshold??.025;$('thresholdValue').textContent=$('threshold').value;}$('start').disabled=!state.paused||state.callState!=='active';$('stop').disabled=state.paused||state.callState!=='active';$('interrupt').disabled=state.callState!=='active';$('save').disabled=state.callState==='active';}catch(e){if(!closed)$('status').textContent='通话服务连接失败：'+e.message}}
async function control(action,values={}){busy=true;try{await request('/audio-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...values})});}catch(e){$('status').textContent='操作失败：'+e.message;return;}finally{busy=false}await refresh();}
$('refresh').onclick=()=>control('devices');$('save').onclick=()=>control('configure',{input:$('input').value,output:$('output').value,threshold:Number($('threshold').value)});$('start').onclick=()=>control('start');$('stop').onclick=()=>control('stop');$('interrupt').onclick=()=>control('interrupt');$('threshold').oninput=()=>{$('thresholdValue').textContent=$('threshold').value};
const timer=setInterval(()=>{void refresh()},1000);void refresh();
return ()=>{closed=true;clearInterval(timer)};

    }
    function VoiceCallPanel() {
      const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
      const consoleRef=React.useRef(null);
      useEffect(()=>{let disposed=false;
        const refresh=async()=>{try{const r=await fetch('http://127.0.0.1:59281/panel-bootstrap',{cache:'no-store'});if(!r.ok)throw Error('读取通话服务失败');const value=await r.json();if(!value.ok||!/^http:\/\/127\.0\.0\.1:59281\/#[0-9a-f]{64}$/.test(value.url))throw Error('通话服务响应异常');if(!disposed){setData(value);setError('');}}catch(e){if(!disposed)setError('通话服务未连接，请先启动通话服务。');}finally{if(!disposed)setLoading(false);}};
        refresh();const timer=setInterval(refresh,3000);return()=>{disposed=true;clearInterval(timer)};
      },[]);
      useEffect(()=>{if(!data?.url||!consoleRef.current)return;return mountVoiceConsole(consoleRef.current,new URL(data.url).hash.slice(1));},[data?.url]);
      const labels={active:'通话已接通',ringing:'QQ 来电，正在接听',idle:'等待 QQ 语音通话',unknown:'无法确认 QQ 通话状态'};
      return h('section',{className:'qq-section',style:S.card,'aria-label':'语音通话'},
        h('p',{role:'status',style:{margin:'0 0 12px'}},loading?'正在检查通话服务…':error||labels[data?.state]||labels.unknown),
        h('style',null,".voice-console{font:16px system-ui;background:#101922;color:#e2f7f2;padding:18px;border-radius:12px}.voice-console button,.voice-console select{font:inherit;padding:10px;border-radius:8px;background:#223a43;color:inherit;border:1px solid #4bc4b1}.voice-console select{width:100%;margin:8px 0 18px}.voice-console button{cursor:pointer;margin:4px}.voice-console #status{color:#65dbc8}.voice-console #log{white-space:pre-wrap;line-height:1.8;max-height:300px;overflow:auto}.voice-console small{color:#a8bec3}"),h('div',{className:'voice-console',ref:consoleRef}),
        h('p',{style:S.tiny},'通话由后台服务处理，不需要保持插件面板打开。'));
    }

    function LearningWorkspace({conversations,ownerQQ}) {



      const [view,setView]=useState('global');



      const suppliedKey=growthManagementKey(ownerQQ,conversations);



      const [context,setContext]=useState({key:'',loading:!suppliedKey,error:'',checked:false});



      const contextSeq=React.useRef(0);



      const managementKey=suppliedKey||context.key;



      const resolveContext=async()=>{



        const seq=++contextSeq.current;setContext(c=>({...c,loading:true,error:''}));



        const results=await Promise.allSettled([



          apiGet('/api/status').then(d=>{if(!d||d.ok===false||!Object.hasOwn(d,'ownerQQ'))throw Error(d?.error||'管理员状态响应不完整');return d;}),



          apiGet('/api/socialV2/states').then(d=>{if(!d||d.ok===false||!Array.isArray(d.conversations))throw Error(d?.error||'会话列表响应不完整');return d;})



        ]);



        if(seq!==contextSeq.current)return;



        const status=results[0].status==='fulfilled'?results[0].value:null;



        const states=results[1].status==='fulfilled'?results[1].value:null;



        const key=growthManagementKey(status?.ownerQQ,states?.conversations);



        const failures=[...new Set(results.filter(r=>r.status==='rejected').map(r=>r.reason?.message||'连接失败'))];



        setContext({key,loading:false,checked:true,error:!key&&failures.length?'读取QQ管理上下文失败：'+failures.join('；'):''});



      };



      useEffect(()=>{if(!suppliedKey)resolveContext();return()=>{contextSeq.current++;};},[suppliedKey]);



      return h('div',{className:'gg-workspace'},



        h('div',{role:'tablist','aria-label':'学习范围',style:{...S.row,marginBottom:18}},[['global','全局成长'],['local','会话学习']].map(([id,label])=>h('button',{key:id,id:'learning-tab-'+id,type:'button',role:'tab','aria-selected':view===id,'aria-controls':'learning-page-'+id,style:{...S.btn,...(view===id?{borderColor:'var(--qq-accent)',color:'var(--qq-accent)',background:'rgba(76,201,176,.09)'}:{})},onClick:()=>setView(id)},label))),



        h('div',{id:'learning-page-global',role:'tabpanel','aria-labelledby':'learning-tab-global',hidden:view!=='global'},h(GlobalGrowthPanel,{managementKey,contextLoading:!managementKey&&context.loading,contextError:context.error,contextChecked:context.checked,onRetryContext:resolveContext})),



        h('div',{id:'learning-page-local',role:'tabpanel','aria-labelledby':'learning-tab-local',hidden:view!=='local'},h(LearningPanel,{conversations})));



    }







    function GlobalGrowthPanel({managementKey,contextLoading=false,contextError='',contextChecked=false,onRetryContext}) {



      const [config,setConfig]=useState(null),[masterEnabled,setMasterEnabled]=useState(false),[list,setList]=useState(null),[detail,setDetail]=useState(null);



      const [teacherDraft,setTeacherDraft]=useState(''),[dirty,setDirty]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);



      const [error,setError]=useState(''),[notice,setNotice]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(0),[forgetConfirm,setForgetConfirm]=useState(false);



      const requestSeq=React.useRef(0),detailSeq=React.useRef(0),dirtyRef=React.useRef(false);



      const types={style:'表达原则',knowledge:'知识',method:'方法'},states={active:'生效中',paused:'已暂停',superseded:'历史版本'};



      const time=x=>x?new Date(x).toLocaleString('zh-CN',{hour12:false}):'暂无记录';



      const call=(action,body={})=>apiPost('/api/self-learning',{key:managementKey,action,...body}).then(d=>{if(d?.ok===false)throw Error(d.error||'全局成长操作失败');return d;});



      const fetchList=(pageValue=page)=>call('growth_list',{status,limit:20,offset:pageValue*20});



      const load=async(resetDraft=false)=>{



        if(!managementKey)return;



        const seq=++requestSeq.current;setLoading(true);setError('');



        try{



          const [diag,rows]=await Promise.all([call('diagnostics'),fetchList()]);



          if(seq!==requestSeq.current)return;



          if(!diag.globalGrowth)throw Error('服务端尚未提供全局成长，请检查桥接版本。');



          setConfig(diag.globalGrowth);setMasterEnabled(diag.configuredEnabled===true);setList(rows);



          if(resetDraft||!dirtyRef.current){setTeacherDraft((diag.globalGrowth.teacherQQs||[]).join('\n'));setDirty(false);dirtyRef.current=false;}



        }catch(e){if(seq===requestSeq.current)setError(e.message);}



        finally{if(seq===requestSeq.current)setLoading(false);}



      };



      useEffect(()=>{setDetail(null);setForgetConfirm(false);detailSeq.current++;load();return()=>{requestSeq.current++;detailSeq.current++;};},[managementKey,status,page]);



      const saveConfig=async patch=>{



        if(busy||loading)return;setBusy(true);setError('');setNotice('');



        try{



          const value=await call('configure',{globalGrowth:patch});



          setConfig(value.settings.globalGrowth);



          if(patch.teacherQQs!==undefined){setTeacherDraft(value.settings.globalGrowth.teacherQQs.join('\n'));setDirty(false);dirtyRef.current=false;}



          setNotice(patch.teacherQQs!==undefined?'教学白名单已保存，对之后的教学立即生效。':patch.enabled?'全局成长已开启。':'全局成长已关闭，之后不再选入共享参考。');



        }catch(e){setError(e.message);}finally{setBusy(false);}



      };



      const saveTeachers=()=>{



        const ids=teacherDraft.split(/[\s,，、;；]+/u).filter(Boolean);



        if(ids.length>20||ids.some(id=>!/^[1-9]\d{4,19}$/.test(id))){setError('请输入有效的5至20位QQ号，最多20人；多个号码用换行或逗号分隔。');return;}



        saveConfig({teacherQQs:[...new Set(ids)]});



      };



      const open=async id=>{



        if(busy||loading)return;const seq=++detailSeq.current;setBusy(true);setError('');setDetail(null);setForgetConfirm(false);



        try{const value=await call('growth_read',{id});if(seq===detailSeq.current)setDetail(value);}



        catch(e){if(seq===detailSeq.current)setError(e.message);}finally{if(seq===detailSeq.current)setBusy(false);}



      };



      const mutate=async action=>{



        if(busy||loading||!detail?.entry)return;setBusy(true);setError('');setNotice('');



        const id=detail.entry.id,version=detail.entry.version;let submitted=false;



        try{



          await call(action,{id,version});submitted=true;setForgetConfirm(false);



          if(action==='growth_forget'){setDetail(null);detailSeq.current++;}else setDetail(await call('growth_read',{id}));



          const rows=await fetchList();setList(rows);



          if(!rows.entries.length&&page>0)setPage(p=>p-1);



          setNotice(action==='growth_forget'?'已遗忘此条目及其历史版本；同一教学来源不会自动重建。':action==='growth_pause'?'已暂停，之后不再选入共享参考。':'已恢复为有效的全局成长参考。');



        }catch(e){setError((submitted?'操作已提交，但刷新失败，请刷新核对状态。':'')+e.message);}



        finally{setBusy(false);}



      };



      const button=(label,onClick,disabled=false,extra={})=>h('button',{type:'button',style:S.btn,disabled:busy||loading||disabled,onClick,...extra},label);



      const entry=detail?.entry,counts=list?.counts||{},enabledCount=counts.active??0,pausedCount=counts.paused??0;



      return h('section',{className:'gg-panel','aria-label':'全局成长管理','aria-busy':busy||loading},



        h('style',null,'.gg-panel{display:flex;flex-direction:column;gap:18px;min-width:0}.gg-card{border:1px solid var(--qq-line);border-radius:14px;padding:20px;background:var(--qq-surface);min-width:0}.gg-card h3{font-size:15px;margin:0 0 12px}.gg-card p{font-size:12px;line-height:1.9;margin:9px 0;opacity:.72}.gg-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.gg-head h3{margin:0}.gg-description{max-width:720px}.gg-label{display:flex;flex-direction:column;gap:8px;font-size:12px}.gg-label textarea{resize:vertical;width:100%;min-height:105px;line-height:1.7}.gg-settings{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr);gap:24px;margin-top:18px}.gg-stats{display:flex;gap:22px;flex-wrap:wrap;font-size:12px;margin:15px 0}.gg-stats strong{font-size:23px;color:var(--qq-accent);margin-right:6px}.gg-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:18px;align-items:start}.gg-list{display:flex;flex-direction:column;gap:9px}.gg-record{width:100%;text-align:left;padding:13px!important;overflow-wrap:anywhere}.gg-record[aria-pressed=true]{border-color:var(--qq-accent)!important;background:rgba(76,201,176,.07)!important}.gg-record span{display:block;font-size:11px;opacity:.6;margin-bottom:6px}.gg-record p{font-size:13px;margin:0;opacity:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.gg-full{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.85;margin:16px 0}.gg-source{margin-top:16px;border-top:1px solid var(--qq-line);padding-top:14px;font-size:12px}.gg-source summary{cursor:pointer}.gg-source blockquote{margin:12px 0;padding:12px;border-left:2px solid var(--qq-accent);white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}.gg-note{font-size:11px!important;opacity:.58!important}.gg-example{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;margin:8px 0}.gg-danger{margin-top:20px;border-top:1px solid var(--qq-line);padding-top:14px}.gg-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;font-size:11px}.gg-empty{padding:22px 0;font-size:12px;line-height:1.9;opacity:.65}.gg-panel input,.gg-panel select,.gg-panel textarea{max-width:100%;min-width:0}.gg-panel details>summary{font-size:12px}.gg-panel .gg-id{overflow-wrap:anywhere;font-size:10px;opacity:.55}.gg-alert{padding:12px 15px;background:rgba(239,183,91,.07);border:1px solid rgba(239,183,91,.3);border-radius:10px;font-size:12px}@media(max-width:760px){.gg-settings,.gg-columns{grid-template-columns:minmax(0,1fr)}.gg-card{padding:16px}.gg-stats{gap:14px}}'),



        h('style',null,'.gg-list{max-height:560px;overflow:auto;padding-right:4px}@media(max-width:760px){.gg-list{max-height:360px}}'),



        h('div',{className:'gg-head'},h('div',null,h('h3',null,'全局成长'),h('p',{className:'gg-description',style:{fontSize:12,opacity:.65,margin:'7px 0 0'}},'在任一已接入的群或私聊里教学，成果供所有允许的QQ会话按需使用。')),button(managementKey?'刷新全局成长':'重新连接',()=>{if(!managementKey){onRetryContext?.();return;}setDetail(null);setForgetConfirm(false);detailSeq.current++;load();},contextLoading)),



        error?h('div',{role:'alert',className:'qq-alert'},error):null,



        notice?h('div',{role:'status',className:'qq-toast'},notice):null,



        !managementKey?h('div',{role:contextError?'alert':'status',className:contextError?'qq-alert':'gg-empty'},contextLoading?'正在读取QQ管理上下文…':contextError||(contextChecked?'尚未配置管理员QQ，也没有可用的QQ会话。请在聊天设置中完成配置后重新连接。':'正在读取QQ管理上下文…')):null,



        loading?h('div',{role:'status',className:'gg-empty'},'正在读取全局成长…'):null,



        config?h(React.Fragment,null,



          h('section',{className:'gg-card','aria-label':'全局成长配置'},



            h('div',{className:'gg-head'},h('h3',null,'教学与共享'),h('label',{style:S.label},h('input',{'aria-label':'全局成长开关',type:'checkbox',checked:config.enabled===true,disabled:busy||loading,onChange:e=>saveConfig({enabled:e.target.checked})}),'开启全局成长')),



            !masterEnabled?h('div',{className:'gg-alert',style:{marginTop:14}},'自主学习总开关目前关闭，全局成长暂不接收教学或注入。请在“会话学习”中开启总开关。'):null,



            h('div',{className:'gg-settings'},



              h('div',null,h('label',{className:'gg-label'},'教学QQ白名单',h('textarea',{'aria-label':'教学QQ白名单',value:teacherDraft,placeholder:'每行一个QQ号，也可用逗号分隔',disabled:busy||loading,onChange:e=>{setTeacherDraft(e.target.value);setDirty(true);dirtyRef.current=true;}})),



                h('p',{className:'gg-note'},'只核验实际发言者的QQ号；昵称、转述和合并转发不授予教学资格。'),



                !teacherDraft.trim()?h('p',{className:'gg-note'},'空名单表示没有人可以教学；已有成长条目仍然保留。'):null,



                h('div',{style:S.row},button('保存教学白名单',saveTeachers,!dirty),dirty?h('span',{style:{...S.tiny,color:'#efb75b'}},'未保存'):null,dirty?button('撤销修改',()=>{setTeacherDraft((config.teacherQQs||[]).join('\n'));setDirty(false);dirtyRef.current=false;}):null)),



              h('div',null,h('strong',{style:{fontSize:12}},'怎样教它'),h('p',null,'使用下面的明确格式会由桥接直接核验保存；也可以自然表达教学，由机器人识别后提交。'),



                h('div',{className:'gg-example'},'全局教学：表达：信息已经足够时直接承接，不必每轮追问。'),



                h('p',{className:'gg-note'},'也支持“知识”和“方法”。只共享适合全局使用的内容；原有群聊、私聊记忆不会自动搬入这里。'),



                h('p',{className:'gg-note'},'移出白名单只撤销之后的教学资格；过去的条目需要在下方单独暂停或遗忘。')))),



          h('section',{className:'gg-card','aria-label':'全局成长条目'},



            h('div',{className:'gg-head'},h('h3',null,'共享成果'),h('label',{style:S.label},'状态',h('select',{'aria-label':'全局成长状态',value:status,disabled:busy||loading,onChange:e=>{setStatus(e.target.value);setPage(0);}},h('option',{value:'all'},'全部当前条目'),h('option',{value:'active'},'生效中'),h('option',{value:'paused'},'已暂停')))),



            h('div',{className:'gg-stats'},h('span',null,h('strong',null,enabledCount),'生效中'),h('span',null,h('strong',null,pausedCount),'已暂停')),



            h('div',{className:'gg-columns'},h('div',null,



              h('div',{className:'gg-list'},(list?.entries||[]).map(r=>h('button',{key:r.id,type:'button',className:'gg-record',style:S.btn,disabled:busy||loading,'aria-label':'查看全局成长 '+r.content,'aria-pressed':entry?.id===r.id,onClick:()=>open(r.id)},h('span',null,(types[r.kind]||r.kind)+' · '+(states[r.status]||r.status)),h('p',null,r.content)))),



              !list?.entries?.length?h('div',{className:'gg-empty'},status==='all'?'还没有全局成长条目。白名单教学者提交新教学后，会在这里显示。':'这个状态下没有条目。'):null,



              (list?.total||0)>20?h('div',{className:'gg-pager'},button('上一页',()=>setPage(p=>p-1),page===0),h('span',null,'第 '+(page+1)+' 页 · 共 '+list.total+' 条'),button('下一页',()=>setPage(p=>p+1),(page+1)*20>=list.total)):null),



              entry?h('aside',{'aria-label':'全局成长详情'},h('div',{style:S.row},h('strong',null,types[entry.kind]||entry.kind),h('span',{style:S.pill},states[entry.status]||entry.status),h('span',{style:S.tiny},'版本 '+entry.version)),



                h('div',{className:'gg-full'},entry.content),entry.uncertainty?h('p',{className:'gg-note'},entry.uncertainty):null,



                h('div',{style:S.row},entry.status==='active'?button('暂停这条成长',()=>mutate('growth_pause')):entry.status==='paused'?button('恢复这条成长',()=>mutate('growth_restore')):null,button('关闭成长详情',()=>{setDetail(null);setForgetConfirm(false);detailSeq.current++;})),



                h('details',{className:'gg-source',key:entry.id},h('summary',null,'查看教学来源与操作记录'),detail.source?h(React.Fragment,null,h('p',null,detail.source.teacher_qq==='console'?'教学来源：管理端整理（非QQ消息）':'教学QQ：'+detail.source.teacher_qq),h('p',null,'来源：'+shortKey(detail.source.scope)+' · '+time(detail.source.at)),h('blockquote',null,detail.source.body)):h('p',null,'当前没有可回查的教学原文。'),



                  h('p',{className:'gg-note'},'来源原文只在管理端展示，其他会话不会随共享条目收到整段教学消息。'),



                  (detail.audit||[]).map((a,i)=>h('p',{key:i,className:'gg-note'},time(a.at)+' · '+({import:'管理端整理导入',teach:'接受教学',revise:'修订',supersede:'被新版本替代',pause:'暂停',restore:'恢复',forget:'遗忘'}[a.action]||a.action)+' · '+(a.actor==='console'?'管理端':a.actor))),h('div',{className:'gg-id'},entry.id)),



                h('div',{className:'gg-danger'},forgetConfirm?h('div',{role:'alert'},h('p',null,'将清除此条目及其历史版本和成长来源，阻止相同来源自动重建。QQ原始聊天与历史备份另行管理。'),h('div',{style:S.row},button('确认遗忘成长',()=>mutate('growth_forget'),false,{style:{...S.btn,color:'#e97f7f'}}),button('取消遗忘成长',()=>setForgetConfirm(false)))):button('遗忘这条成长',()=>setForgetConfirm(true)))):



                h('div',{className:'gg-empty'},'选择一条共享成果，查看完整内容、核对教学来源，或暂停与遗忘。')),



            h('p',{className:'gg-note'},'“生效中”表示可以被选入；每轮仍按话题、条数和预算选择，并非全部同时注入。关闭、暂停和遗忘影响之后的注入，不能抹除模型已有上下文。'))):null);



    }







    function LearningPanel({conversations}) {



      const scopes=(conversations||[]).filter(c=>/^(group|private):[1-9]\d*$/.test(c.key));



      const [key,setKey]=useState(scopes[0]?.key||''),[data,setData]=useState(null),[detail,setDetail]=useState(null);



      const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[filter,setFilter]=useState('all');



      const [topic,setTopic]=useState('');



      const labels={candidate:'候选',trial:'试用',retained:'留用',paused:'暂停',archived:'归档',rejected:'拒绝'};



      const time=x=>x?new Date(x).toLocaleString('zh-CN',{hour12:false}):'暂无';



      const call=(action,body={})=>apiPost('/api/self-learning',{key,action,...body}).then(d=>{if(d?.ok===false)throw Error(d.error||'操作失败');return d;});



      const fetchData=()=>Promise.all(['diagnostics','overview','list','catalog','sources'].map(action=>call(action,action==='list'?{limit:100}:{}))).then(([diag,overview,list,catalog,sources])=>({diag,overview,list,catalog,sources}));



      useEffect(()=>{if(!key&&scopes[0])setKey(scopes[0].key);},[conversations,key]);



      useEffect(()=>{let current=true;setData(null);setDetail(null);setError('');setNotice('');setTopic('');if(!key)return()=>{current=false;};setLoading(true);fetchData().then(d=>{if(current)setData(d);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[key]);



      const refresh=async()=>{setBusy(true);setError('');try{setData(await fetchData());if(detail)setDetail(await call('read',{id:detail.id}));}catch(e){setError(e.message);}finally{setBusy(false);}};



      const mutate=async(action,body={},message='已保存')=>{setBusy(true);setError('');setNotice('');try{await call(action,body);setData(await fetchData());if(detail)setDetail(await call('read',{id:detail.id}));setNotice(message);}catch(e){setError(e.message);}finally{setBusy(false);}};



      const open=async id=>{setBusy(true);setError('');setDetail(null);try{setDetail(await call('read',{id}));}catch(e){setError(e.message);}finally{setBusy(false);}};



      const button=(text,fn,disabled=false)=>h('button',{type:'button',style:S.btn,disabled:busy||loading||disabled,onClick:fn},text);



      const d=data?.diag,c=d?.corpusRetrieval,counts=data?.overview?.counts||{};



      const allowed=d&&!((d.disabledScopes||[]).includes(key))&&(!(d.enabledScopes||[]).length||d.enabledScopes.includes(key));



      const rows=(data?.list?.entries||[]).filter(e=>filter==='all'||e.status===filter);



      const card=(title,...children)=>h('section',{className:'sl-card'},h('h3',null,title),...children);



      return h('div',{className:'sl-panel','aria-busy':busy||loading},



        h('style',null,'.sl-panel{display:flex;flex-direction:column;gap:16px;min-width:0}.sl-card{border:1px solid var(--qq-line);background:var(--qq-surface);border-radius:14px;padding:20px;min-width:0}.sl-card h3{margin:0 0 14px;font-size:15px}.sl-card p,.sl-card small{line-height:1.85}.sl-card p{margin:10px 0;font-size:12px;opacity:.78}.sl-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.sl-toolbar label{display:flex;gap:8px;align-items:center;font-size:12px}.sl-toolbar select{max-width:100%;min-width:0}.sl-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.sl-stat{border:1px solid var(--qq-line);border-radius:10px;padding:13px;display:flex;flex-direction:column;gap:7px}.sl-stat strong{font-size:21px;color:var(--qq-accent)}.sl-stat span{font-size:11px;opacity:.65}.sl-list{display:flex;flex-direction:column;gap:8px}.sl-entry{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;text-align:left;padding:13px!important}.sl-entry span{overflow-wrap:anywhere;min-width:0}.sl-entry small{white-space:nowrap;opacity:.55}.sl-detail{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.9}.sl-source{border-top:1px solid var(--qq-line);padding-top:10px;margin-top:10px;font-size:12px;overflow-wrap:anywhere}.sl-source a{color:var(--qq-accent)}.sl-job{font-size:12px;padding:9px 0;border-top:1px solid var(--qq-line);overflow-wrap:anywhere}.sl-note{font-size:11px!important;opacity:.55!important}.sl-empty{padding:18px 0;font-size:12px;opacity:.55}@media(max-width:620px){.sl-card{padding:15px}.sl-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.sl-toolbar>label:first-child{width:100%}.sl-toolbar select{flex:1}.sl-entry{align-items:flex-start}.qq-main-nav{grid-template-columns:repeat(2,minmax(0,1fr))!important}}'),



        h('div',{className:'sl-toolbar'},h('label',null,'QQ 会话',h('select',{'aria-label':'学习会话',value:key,disabled:busy,onChange:e=>setKey(e.target.value)},scopes.map(x=>h('option',{key:x.key,value:x.key},x.title||x.name||shortKey(x.key))))),button('刷新',refresh,!key)),



        error?h('div',{role:'alert',className:'qq-alert'},error):null,



        notice?h('div',{role:'status',className:'mt-message'},notice):null,



        !key?h('div',{className:'sl-empty'},'暂时没有 QQ 会话；收到聊天后再来查看。'):null,



        loading?h('div',{role:'status',className:'sl-empty'},'正在读取学习记录…'):null,



        d?card('自主学习',



          h('div',{className:'sl-toolbar'},



            h('label',null,h('input',{type:'checkbox','aria-label':'自主学习总开关',checked:!!d.configuredEnabled,disabled:busy,onChange:e=>mutate('configure',{enabled:e.target.checked})}),'所有 QQ 会话总开关'),



            h('label',null,h('input',{type:'checkbox','aria-label':'当前会话学习开关',checked:!!allowed,disabled:busy,onChange:e=>mutate('configure',{scopeEnabled:e.target.checked})}),'当前会话允许学习'),



            h('label',null,'全局模式',h('select',{'aria-label':'学习模式',value:d.mode,disabled:busy,onChange:e=>mutate('configure',{mode:e.target.value})},h('option',{value:'record'},'只记录'),h('option',{value:'trial'},'允许试用'),h('option',{value:'auto'},'自动推进')))),



          h('p',null,d.enabled?'当前会话学习已开启。':'当前会话学习未生效。','只记录：不注入表达原则；允许试用：管理员启动试用；自动推进：后台提出有限试用并按真实反馈审核。'),



          h('div',{className:'sl-stats'},[['真实来源',d.sources],['实际回复使用',d.actualUses],['已核验反馈',d.verifiedFeedback]].map(([label,n])=>h('div',{key:label,className:'sl-stat'},h('strong',null,n??0),h('span',null,label)))),



          h('p',null,'本会话表达试用 ',d.styleTrials??0,' 条，留用 ',d.styleRetained??0,' 条；核验过的表达使用 ',d.actualStyleUses??0,' 次。'),



          h('p',{className:'sl-note'},'表达原则默认试用 ',d.trialDays,' 天；至少 ',d.retainMinUses,' 次实际发送、',d.retainMinFeedback,' 条不同回复上的明确正面反馈，且无负面证据，才可留用。使用次数表示回复带有该原则，不等于已经证明风格改善。暂停学习不会扩张或改变聊天准入。')):null,



        d?card('语料与表达检索',c?h('div',null,



          h('div',{className:'sl-stats'},[['候选扫描',c.sourceCandidates],['运行中归纳原则',c.profiles],['进程内检索命中',Number(c.semanticQueries||0)+Number(c.lexicalQueries||0)]].map(([label,n])=>h('div',{key:label,className:'sl-stat'},h('strong',null,n??0),h('span',null,label)))),



          h('p',null,'本次进程：选取尝试 ',c.contextAttempts??'—',' 次；本地向量查询 ',c.embeddingQueries??'—',' 次；词法命中 ',c.lexicalQueries??0,' 次；语义命中 ',c.semanticQueries??0,' 次。'),



          h('p',{className:'sl-note'},'计数含管理端预览，重载后归零；命中表示选入参考，不代表实际回复质量。当前语义门槛 ',c.minScore??'—','，分差 ',c.minMargin??'—','。'),



          h('p',null,'检索配置：',c.enabled?'开启':'关闭',' · 数据：',c.ready?'已加载':'未就绪',c.error?' · '+c.error:''),



          h('p',null,'全量候选已经过筛选，聊天按话意选取归纳原则；原始小说和群聊片段不直接注入。检索计数在进程重启后归零，不能当作质量评分。'),



          h('p',{className:'sl-note'},'当前仍使用 DeepSeek。权重微调尚未执行；检索学习不会修改模型权重。')):h('p',null,'服务端尚未提供语料状态，请检查后端版本。')):null,



        data?card('学习条目',



          h('div',{className:'sl-toolbar'},h('label',null,'查看',h('select',{'aria-label':'条目状态',value:filter,onChange:e=>setFilter(e.target.value)},h('option',{value:'all'},'最近 100 条'),Object.entries(labels).map(([v,n])=>h('option',{key:v,value:v},n+' · '+(counts[v]||0))))),h('small',null,'共 ',Object.values(counts).reduce((a,b)=>a+Number(b||0),0),' 条，下面最多展示最近 100 条')),



          h('div',{className:'sl-list'},rows.length?rows.map(e=>h('button',{type:'button',key:e.id,className:'sl-entry',disabled:busy,onClick:()=>open(e.id)},h('span',null,e.title||e.id),h('small',null,labels[e.status]||e.status,' · ',e.kind==='knowledge'?'知识':'表达'))):h('div',{className:'sl-empty'},'这个状态下还没有学习条目。'))):null,



        detail?card(detail.title||'条目详情',



          h('div',{className:'sl-detail'},detail.content),h('p',null,'状态：',labels[detail.status]||detail.status,' · 更新：',time(detail.updatedAt)),



          detail.verifiedUsage?h('p',null,'核验记录：实际使用 ',detail.verifiedUsage.uses,' 次；明确正面反馈 ',detail.verifiedUsage.positive,' 条；负面反馈 ',detail.verifiedUsage.negative,' 条。'):null,



          h('div',{className:'sl-toolbar'},['candidate'].includes(detail.status)?button('开始试用',()=>mutate('start_trial',{id:detail.id}),'style'!==detail.kind||!d?.enabled):null,



            ['trial','retained'].includes(detail.status)?button('暂停',()=>mutate('pause',{id:detail.id}),!d?.enabled):null,



            detail.status==='trial'?button('核验并留用',()=>mutate('retain',{id:detail.id}),!d?.enabled):null,



            ['paused','archived','rejected'].includes(detail.status)?button('恢复为候选',()=>mutate('restore',{id:detail.id}),!d?.enabled):null,



            detail.status!=='archived'?button('归档',()=>mutate('archive',{id:detail.id}),!d?.enabled):null,



            button('关闭详情',()=>setDetail(null))),



          h('p',{className:'sl-note'},'“核验并留用”由服务端检查门槛；不能手动制造好评。恢复后回到候选，不会立即注入。'),



          h('h4',null,'来源'),(detail.sources||[]).length?detail.sources.map((s,i)=>h('div',{key:i,className:'sl-source'},h('div',null,s.type,' · ',s.refId),h('small',null,time(s.fetchedAt)),s.note?h('p',null,s.note):null)):h('p',null,'暂无来源。'),



          h('h4',null,'最近核验反馈'),(detail.verifiedFeedback||[]).length?detail.verifiedFeedback.map((f,i)=>h('div',{key:i,className:'sl-source'},(f.outcome==='positive'?'明确正面':'明确负面'),' · 回复 ',f.replyId,' · ',time(f.at))):h('p',null,'暂无绑定实际回复的明确反馈。')):null,



        d?card('公开阅读',h('p',null,'全局每天最多 ',d.dailyRounds,' 轮，每轮最多 ',d.searchesPerRound,' 次只读网络操作；同会话间隔至少 ',Math.round(d.cooldownMs/3600000),' 小时。后台阅读不调用聊天模型。'),



          h('p',null,'下一主题：',data.catalog?.topics?.[d.topic]?.title||(d.topic==='source'?'会话已读资料':d.topic||'等待相关来源或计划'),' · 后台：',d.runner?.running?'检查中':'待下一次检查'),



          h('div',{className:'sl-toolbar'},h('label',null,'阅读计划',h('select',{'aria-label':'阅读主题',value:topic,disabled:busy,onChange:e=>setTopic(e.target.value)},h('option',{value:''},'选择入门主题'),Object.entries(data.catalog?.topics||{}).map(([id,x])=>h('option',{key:id,value:id},x.title)))),button('安排主题',()=>mutate('plan',{topic},'阅读计划已保存，下一次后台检查按额度执行'),!topic||!d.enabled),button('取消显式计划',()=>mutate('unplan',{},'显式阅读计划已取消'),!d.enabled)),



          h('p',{className:'sl-note'},'机器人也可沿当前会话实际读过的公开资料继续；取消显式计划后，相关活动目标仍可能提供阅读来源。'),



          h('h4',null,'全局最近任务'),(d.globalJobs||[]).length?d.globalJobs.map(j=>h('div',{key:j.id,className:'sl-job'},data.catalog?.topics?.[j.topic]?.title||j.topic,' · ',({done:'完成',failed:'失败',running:'运行中'}[j.status]||j.status),' · ',time(j.finished_at||j.started_at),j.error?h('p',null,j.error):null)):h('p',null,'还没有公开阅读任务。')):null);



    }







    function MemeWikiPanel() {



      const [data,setData]=useState(null),[q,setQ]=useState(''),[hits,setHits]=useState(null);



      const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[msg,setMsg]=useState('');



      const load=()=>apiGet('/api/meme-wiki').then(d=>{setData(d);setErr('');}).catch(e=>setErr(e.message));



      useEffect(()=>{load();},[]);



      const save=(patch)=>apiPost('/api/meme-wiki',patch).then(d=>{setData(d);setMsg('已保存');setTimeout(()=>setMsg(''),1500);}).catch(e=>setErr(e.message));



      const troll=data?.troll||{enabled:false,level:50};



      return h('details',{hidden:false,className:'qq-section'},null,



        h('section',{className:'qq-status-card',style:S.card},h('h3',null,'梗百科'),



          err?h('div',{role:'alert',className:'qq-alert'},err):null,



          msg?h('div',{role:'status',className:'mt-message'},msg):null,



          h('div',{className:'qq-status-grid'},



            h('div',null,h('span',null,'词条'),h('strong',null,data?.available?String(data.total||0)+' 条':'未加载'),h('small',null,data?.available?'离线词库':'data/memes.db 缺失')),



            h('div',null,h('span',null,'预查'),h('strong',null,data?.enabled!==false?'开启':'已关'),h('small',null,'只对问梗句式触发')),



            h('div',null,h('span',null,'玩梗尺度'),h('strong',null,(troll.enabled?'手动 ':'自动 ')+String(troll.level||50)+'/100'),h('small',null,'手动接管时按档位调整'))),



          h('div',{style:S.row},



            h('label',{style:{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px'}},



              h('input',{type:'checkbox',checked:data?.enabled!==false,disabled:busy,



                onChange:e=>{setBusy(true);save({enabled:e.target.checked}).finally(()=>setBusy(false));}}),'自动思考梗'),



            h('label',{style:{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px'}},



              h('input',{type:'checkbox',checked:troll.enabled===true,disabled:busy,



                onChange:e=>{setBusy(true);save({troll:{enabled:e.target.checked,level:troll.level}}).finally(()=>setBusy(false));}}),'手动接管玩梗尺度')),



          h('div',{style:S.row},h('input',{type:'range',min:0,max:100,step:5,value:troll.level||50,disabled:busy||!troll.enabled,



            onChange:e=>setData(d=>({...d,troll:{...troll,level:Number(e.target.value)}})),



            onMouseUp:e=>{setBusy(true);save({troll:{enabled:true,level:Number(e.currentTarget.value)}}).finally(()=>setBusy(false));}}),



            h('span',{className:'muted',style:{fontSize:'12px'}},String(troll.level||50)+'/100  '+(Number(troll.level||50)<=20?'很尊重':Number(troll.level||50)<=45?'偏低':Number(troll.level||50)<=70?'中等':'放开')),



            h('small',{className:'muted'},'≤20 黑称不接 · ≤45 损操作可以 · ≤70 跟着社区 · >70 放开')),



          h('div',{style:S.row},h('input',{placeholder:'试查一个梗，如 破防 / 栓Q',value:q,onChange:e=>setQ(e.target.value),style:{flex:1,minWidth:'160px',fontSize:'12px'}}),



            h('button',{style:S.btn,disabled:!q.trim(),onClick:()=>{setBusy(true);apiGet('/api/meme-wiki?q='+encodeURIComponent(q.trim())).then(d=>setHits(d.hits||[])).catch(e=>setErr(e.message)).finally(()=>setBusy(false));}},'查')),



          hits?h('div',{style:{marginTop:'8px'}},hits.length?hits.map((x,i)=>h('div',{key:i,style:{marginTop:'6px'}},



            h('b',null,x.title),x.tags?h('span',{className:'muted',style:{fontSize:'11px'}},' '+x.tags):null,



            h('div',{className:'muted',style:{fontSize:'12px',marginTop:'2px'}},x.summary||''))):h('span',{className:'muted'},'没查到')):null,



          h('div',{className:'muted',style:{marginTop:'9px',fontSize:'11px'}},'词库数据版权归原作者与 cnmeme.wiki，代码 MIT；离线查询，不发网络请求。')));



    }



    function AbilitiesPanel({conversations}) {



      const scopes=(conversations||[]).filter(c=>/^group:[1-9]\d*$/.test(c.key));



      const [key,setKey]=useState(scopes[0]?.key||'');



      const [data,setData]=useState(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false);



      const [err,setErr]=useState(''),[notice,setNotice]=useState(null),[lastAt,setLastAt]=useState(0);



      const [saving,setSaving]=useState(''),[drafts,setDrafts]=useState({}),[fieldErr,setFieldErr]=useState({});



      const [verify,setVerify]=useState(null);



      const [voiceText,setVoiceText]=useState('你好呀，今天也一起玩吧'),[voiceResult,setVoiceResult]=useState(null);



      const [signText,setSignText]=useState(''),[commentText,setCommentText]=useState('');



      const [likeTid,setLikeTid]=useState(''),[likeUin,setLikeUin]=useState(''),[likeAbstime,setLikeAbstime]=useState('0');



      const [presenceResult,setPresenceResult]=useState(null);



      const [activityResult,setActivityResult]=useState(null),[transferResult,setTransferResult]=useState(null);



      const [transferTarget,setTransferTarget]=useState('');



      const seq=React.useRef(0);



      const time=x=>x?new Date(x).toLocaleString('zh-CN',{hour12:false}):'暂无';



      const flash=(text,tone='ok')=>{setNotice({text,tone});setTimeout(()=>setNotice(null),7000);};







      const load=async(silent=false)=>{



        const mine=++seq.current;



        if(!silent)setLoading(true);



        setRefreshing(true);



        try{



          const value=await apiGet('/api/capabilities?key='+encodeURIComponent(key||''));



          if(mine!==seq.current)return {ok:false,error:'superseded'};



          setData(value);setLastAt(Date.now());setErr('');



          return {ok:true,data:value};



        }catch(e){



          const message=(e&&e.message)||'读取失败';



          if(mine===seq.current)setErr(message); // 保留旧数据



          return {ok:false,error:message};



        }finally{



          if(mine===seq.current){setLoading(false);setRefreshing(false);}



        }



      };



      useEffect(()=>{setData(null);setErr('');setDrafts({});setFieldErr({});setVerify(null);load();return()=>{seq.current++;};},[key]);







      const cfg=(data&&data.config)||{},mods=(data&&data.modules)||{};



      const growth=mods.growth||{},culture=mods.groupCulture||{},activity=mods.activity||{},presence=mods.presence||{},speech=mods.speech||{},recreation=mods.recreation||{},transfer=mods.transfer||{},voice=mods.voice||{};



      const effectiveDry=cfg.dryRun!==false||cfg.presence?.dryRun!==false;



      const post=async(action,body={})=>{



        const value=await apiPost('/api/capabilities',{action,key,...body});



        return value||{ok:true};



      };



      const SKIP_TEXT={



        quiet_hours:'当前静默时段，未执行（不会绕过静默）',



        daily_budget:'今日额度已用完，未执行',



        budget_exhausted:'额度已用完，未执行',



        cooldown:'还在冷却中，未执行',



        busy:'已有任务在跑，未执行',



        disabled:'模块已关闭，未执行',



        no_interest:'还没有可读的兴趣来源，未执行',



        no_sources:'没有可用的公开来源，未执行',



        no_content:'没有取到可用内容，未执行',



        duplicate_only:'找到的内容之前都读过，已跳过',



        no_public_material:'没有已允许公开的素材，无法对外使用',



        avatar_file_missing:'未配置头像文件路径，未执行',



        avatar_backup_failed:'头像备份失败，已取消更换',



        target_disabled:'该目标未开启，未执行',



        no_target:'需要填写空间互动目标 tid',



        capabilities_disabled:'八类能力总开关已关闭',



        target_already_has_content:'目标群已有相同正文，已跳过',



        not_attempted:'没有执行本地试合成',



      };



      const skipText=r=>SKIP_TEXT[r]||('未执行：'+r);



      const businessText=v=>{



        if(!v)return {text:'没有返回结果',tone:'warn'};



        if(v.skipped)return {text:skipText(v.skipped),tone:'warn'};



        if(v.unknown===true||v.status==='unknown')return {text:'结果不明：不会自动重发',tone:'warn'};



        if(v.partial_success||v.status==='partial')return {text:'部分成功：'+(v.message||'部分内容未发送，已保留已成功的部分'),tone:'warn'};



        if(v.dryRun)return {text:'演练完成：已记录并占用额度，没有真正写入协议端',tone:'drill'};



        if(v.disabled===true)return {text:'模块已关闭，未执行',tone:'warn'};



        if(v.ok===false||v.error){const reason=v.reason||v.error;return {text:'未完成：'+(SKIP_TEXT[reason]||reason||'操作失败'),tone:'warn'};}



        if(v.status==='relayed')return {text:'已发送到目标'+(v.messageId?'（回执 '+v.messageId+'）':''),tone:'ok'};



        return {text:'已完成',tone:'ok'};



      };



      const act=async(action,body,{confirmText='',result=null,success=''}={})=>{



        if(confirmText&&typeof window!=='undefined'&&!window.confirm(confirmText))return null;



        setErr('');setSaving(action);



        let value=null,transport='';



        try{value=await post(action,body);}catch(e){transport=(e&&e.message)||'请求失败';}



        const loaded=await load(true);



        if(result)result(value);



        if(transport){setErr(transport);flash('请求失败：'+transport,'warn');}



        else{



          const r=businessText(value);



          if(value&&value.ok!==false&&success&&r.tone==='ok')flash(success,'ok');



          else flash(r.text,r.tone);



          if(!loaded.ok&&value&&value.ok!==false)flash(r.text+'（但读取真实状态失败，请刷新）','warn');



        }



        setSaving('');



        return value;



      };



      const getPath=(obj,p)=>String(p).split('.').reduce((o,k)=>(o==null?o:o[k]),obj);



      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);



      const save=async(path,value,label)=>{



        setFieldErr(c=>({...c,[path]:''}));setVerify(null);setSaving('set_config:'+path);



        let posted=null;



        try{posted=await post('set_config',{path,value});}



        catch(e){setFieldErr(c=>({...c,[path]:(e&&e.message)||'写入失败'}));setSaving('');return false;}



        if(!posted||posted.ok===false){setFieldErr(c=>({...c,[path]:posted?.error||'写入失败'}));setSaving('');return false;}



        const loaded=await load(true);



        if(!loaded.ok){



          setVerify({path,value,label,kind:'unverified',message:'已提交，但读取核实失败：'+(loaded.error||'读取失败')});



          setSaving('');return false;



        }



        const actual=getPath(loaded.data?.config||{},path);



        if(!same(actual,value)){



          setVerify({path,value,label,kind:'mismatch',message:'已提交，但读回值不一致（当前 '+JSON.stringify(actual)+'）'});



          setSaving('');return false;



        }



        setDrafts(c=>{const next={...c};delete next[path];return next;});



        flash((label||'配置')+'已保存并核实','ok');setSaving('');return true;



      };



      const retryRead=async()=>{



        if(!verify)return;



        const loaded=await load(true);



        if(!loaded.ok){setVerify({...verify,message:'读取仍失败：'+(loaded.error||'未知错误')});return;}



        const actual=getPath(loaded.data?.config||{},verify.path);



        if(!same(actual,verify.value)){setVerify({...verify,kind:'mismatch',message:'读回值仍不一致（当前 '+JSON.stringify(actual)+'）'});return;}



        setDrafts(c=>{const next={...c};delete next[verify.path];return next;});



        setVerify(null);flash('读取核实成功','ok');



      };



      const savingPath=p=>saving==='set_config:'+p;



      const disabled=saving!==''||refreshing;







      const numberField=(path,label,value,{min=1,max=9999,step=1,unit='',hint=''}={})=>{



        const raw=Object.prototype.hasOwnProperty.call(drafts,path)?drafts[path]:String(value??'');



        const localErr=fieldErr[path];



        const commit=()=>{



          const n=Number(raw);



          if(raw===''||!Number.isFinite(n)){setFieldErr(c=>({...c,[path]:'请输入数字'}));return;}



          if(step>=1&&!Number.isInteger(n)){setFieldErr(c=>({...c,[path]:'需要整数'}));return;}



          if(n<min||n>max){setFieldErr(c=>({...c,[path]:`范围 ${min}–${max}${unit}`}));return;}



          void save(path,n,label);



        };



        return h('div',{className:'ab-field',key:path},



          h('label',{className:'ab-field-label'},label,unit?h('span',{className:'ab-muted'},'（'+unit+'）'):null),



          h('div',{className:'ab-inline'},



            h('input',{'data-testid':'field-'+path,'aria-label':label,type:'text',inputMode:'numeric',value:raw,disabled:savingPath(path),



              onChange:e=>setDrafts(c=>({...c,[path]:e.target.value})),onKeyDown:e=>{if(e.key==='Enter')commit();}}),



            h('button',{type:'button',className:'ab-btn',disabled:savingPath(path)||(String(value??'')===String(raw)&&!localErr),onClick:commit},savingPath(path)?'保存中…':'保存')),



          localErr?h('div',{className:'ab-err',role:'alert'},localErr):null,



          verify&&verify.path===path?h('div',{className:'ab-note ab-warn'},verify.message,h('button',{type:'button',className:'ab-btn',style:{marginLeft:8},onClick:retryRead},'重试读取')):null,



          hint?h('div',{className:'ab-muted'},hint):null);



      };



      const textField=(path,label,value,{placeholder='',hint=''}={})=>{



        const raw=Object.prototype.hasOwnProperty.call(drafts,path)?drafts[path]:String(value??'');



        return h('div',{className:'ab-field',key:path},



          h('label',{className:'ab-field-label'},label),



          h('div',{className:'ab-inline'},



            h('input',{'data-testid':'field-'+path,'aria-label':label,type:'text',placeholder,value:raw,disabled:savingPath(path),



              onChange:e=>setDrafts(c=>({...c,[path]:e.target.value})),onKeyDown:e=>{if(e.key==='Enter')void save(path,raw,label);}}),



            h('button',{type:'button',className:'ab-btn',disabled:savingPath(path)||String(value??'')===raw,onClick:()=>void save(path,raw,label)},savingPath(path)?'保存中…':'保存')),



          fieldErr[path]?h('div',{className:'ab-err',role:'alert'},fieldErr[path]):null,



          verify&&verify.path===path?h('div',{className:'ab-note ab-warn'},verify.message,h('button',{type:'button',className:'ab-btn',style:{marginLeft:8},onClick:retryRead},'重试读取')):null,



          hint?h('div',{className:'ab-muted'},hint):null);



      };



      const listField=(path,label,values,{hint='',emptyText=''})=>{



        const current=Array.isArray(values)?values:[];



        const raw=Object.prototype.hasOwnProperty.call(drafts,path)?drafts[path]:current.join('\n');



        const saveList=()=>{



          const list=String(raw).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);



          void save(path,list,label);



        };



        return h('div',{className:'ab-field',key:path},



          h('label',{className:'ab-field-label'},label),



          h('textarea',{'data-testid':'field-'+path,'aria-label':label,rows:3,value:raw,disabled:savingPath(path),



            onChange:e=>setDrafts(c=>({...c,[path]:e.target.value})),



            placeholder:'每行一项，例如\n计算机\n独立动画'}),



          h('div',{className:'ab-row'},



            h('button',{type:'button',className:'ab-btn',disabled:savingPath(path),onClick:saveList},savingPath(path)?'保存中…':'保存列表'),



            h('span',{className:'ab-muted'},'当前 '+(current.length?current.join('、'):'空列表'))),



          fieldErr[path]?h('div',{className:'ab-err',role:'alert'},fieldErr[path]):null,



          verify&&verify.path===path?h('div',{className:'ab-note ab-warn'},verify.message,h('button',{type:'button',className:'ab-btn',style:{marginLeft:8},onClick:retryRead},'重试读取')):null,



          hint?h('div',{className:'ab-muted'},hint):null,



          emptyText?h('div',{className:'ab-muted'},'空列表含义：'+emptyText):null);



      };



      const toggleRow=(label,path,checked,note,onChange)=>h('label',{className:'ab-check',key:path,title:note||''},



        h('input',{'data-testid':'toggle-'+path,'aria-label':label,type:'checkbox',checked:!!checked,disabled:savingPath(path),



          onChange:e=>onChange?onChange(e.target.checked):void save(path,e.target.checked,label)}),label);



      const chip=(text,tone)=>h('span',{className:'ab-pill ab-'+tone},text);







      if(loading&&!data)return h('div',{className:'ab-panel','data-testid':'abilities-panel','aria-busy':'true'},h('div',{className:'ab-card'},h('strong',null,'八类能力'),h('div',{className:'ab-muted'},'正在读取真实状态…')));



      if(!data)return h('div',{className:'ab-panel','data-testid':'abilities-panel'},h('div',{className:'ab-card'},



        h('strong',null,'八类能力'),



        h('div',{className:'ab-err',role:'alert'},err||'读取失败'),



        h('button',{className:'ab-btn',type:'button',onClick:()=>load()},'重试')));







      const scopesForTarget=scopes.map(c=>({key:c.key,label:c.title||c.name||shortKey(c.key)}));



      const scopeWaiting='选择群会话后显示本群内容；上面的全局设置仍然有效。';



      const tileStatus=[



        cfg.enabled===false?'总开关关闭':!key?'待选会话':growth.enabled===false?'已关闭':'已开启',



        cfg.enabled===false?'总开关关闭':!key?'待选会话':culture.enabled===false?'已关闭':culture.hasSummary?'已整理':'等待资料',



        cfg.enabled===false?'总开关关闭':activity.enabled===false?'已关闭':activity.inQuietHours?'静默中':'已开启',



        cfg.enabled===false?'总开关关闭':presence.enabled===false?'已关闭':effectiveDry?'演练中':'真实模式',



        cfg.enabled===false?'总开关关闭':speech.enabled===false?'已关闭':'已开启',



        cfg.enabled===false?'总开关关闭':recreation.enabled===false?'已关闭':'已开启',



        cfg.enabled===false?'总开关关闭':transfer.enabled===false?'已关闭':(transfer.counts?.pending||0)>0?'待确认':'已开启',



        cfg.enabled===false?'总开关关闭':!voice.enabled?'新模块关闭':voice.ready?'已启用':'待配置',



      ];



      const tones=[



        cfg.enabled===false||growth.enabled===false?'off':!key?'pend':'ok',



        cfg.enabled===false||culture.enabled===false?'off':!key?'pend':'ok',



        cfg.enabled===false||activity.enabled===false?'off':activity.inQuietHours?'warn':'ok',



        cfg.enabled===false||presence.enabled===false?'off':effectiveDry?'drill':'warn',



        cfg.enabled===false||speech.enabled===false?'off':'ok',



        cfg.enabled===false||recreation.enabled===false?'off':'ok',



        cfg.enabled===false||transfer.enabled===false?'off':(transfer.counts?.pending||0)>0?'warn':'ok',



        cfg.enabled===false||!voice.enabled?'off':voice.ready?'ok':'warn',



      ];



      const tile=(no,id,title,detail,i)=>h('a',{key:id,href:'#ab-'+id,className:'ab-tile','data-testid':'tile-'+id},



        h('div',{className:'ab-tile-top'},h('strong',null,no+' '+title),chip(tileStatus[i],tones[i])),



        h('span',null,detail));



      const card=(id,title,sub,children,open=false)=>h('details',{key:id,id:'ab-'+id,className:'ab-card',open,'data-testid':'card-'+id},



        h('summary',null,h('strong',null,title),sub?h('span',{className:'ab-muted'},'  ·  '+sub):null),...children);



      const resultBox=(value,where)=>h('div',{className:'ab-note ab-'+businessText(value).tone,'data-testid':'result-'+where},businessText(value).text);







      const growthChildren=[



        !key?h('div',{className:'ab-empty',key:'g-wait'},scopeWaiting):null,



        h('div',{className:'ab-row',key:'g-en'},toggleRow('启用成长','growth.enabled',growth.enabled!==false),chip(growth.enabled===false?'已关闭':'已开启',growth.enabled===false?'off':'ok')),



        h('div',{className:'ab-row',key:'g-auto'},toggleRow('自动试用（autoTrial）','growth.autoTrial',growth.autoTrial===true,'开启后，达到来源门槛的候选会自动进入试用；生效仍需管理员确认'),



          h('span',{className:'ab-muted'},'当前：'+(growth.autoTrial?'自动试用已开':'只提出候选，不自动试用'))),



        h('div',{className:'ab-muted',key:'g-note'},'候选必须有服务端核验的真实消息来源；生效要求真实回复的 message_id 绑定批次，不能用按钮操作冒充“人格提升”。'),



        !key?null:(growth.recent||[]).length



          ?h('div',{className:'ab-list',key:'g-list'},growth.recent.slice(0,10).map(g=>h('div',{key:g.id,className:'ab-item','data-testid':'growth-item'},



            h('span',null,(g.kind==='interest'?'兴趣':'表达')+' · '+g.content+' · '+(g.sources||[]).length+' 个来源'),



            h('span',{className:'ab-muted'},'状态：'+({proposed:'候选',trial:'试用中',active:'已生效',paused:'已暂停',revoked:'已撤销'}[g.status]||g.status)+(g.origin?' · 来源类型 '+g.origin:'')),



            h('div',{className:'ab-row'},



              g.status==='revoked'?h('button',{className:'ab-btn','data-testid':'growth-restore-'+g.id,type:'button',disabled:disabled,onClick:()=>act('growth_restore',{id:g.id},{success:'已恢复为候选，可重新开始试用'})},'恢复'):null,



              ['proposed','paused'].includes(g.status)?h('button',{className:'ab-btn','data-testid':'growth-trial-'+g.id,type:'button',disabled:disabled,onClick:()=>act('growth_start_trial',{id:g.id},{success:'已进入试用；仍需真实使用回执'})},'开始试用'):null,



              g.status==='trial'?h('button',{className:'ab-btn','data-testid':'growth-activate-'+g.id,type:'button',disabled:disabled,onClick:()=>act('growth_activate',{id:g.id},{success:'已标为生效（仅代表管理员确认）'})},'标为生效'):null,



              ['proposed','trial','active'].includes(g.status)?h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>act('growth_pause',{id:g.id},{success:'已暂停'})},'暂停'):null,



              g.status!=='revoked'?h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>act('growth_revoke',{id:g.id},{success:'已撤销',confirmText:'撤销后这条成长立即停止注入，继续？'})},'撤销'):null))))



          :h('div',{className:'ab-empty',key:'g-empty'},'还没有成长条目。后台只会在有真实来源时提出候选，不能自证。'),



        h('div',{className:'ab-grid2',key:'g-cfg'},



          numberField('growth.minSources','最少来源数',cfg.growth?.minSources,{min:1,max:20}),



          numberField('growth.minDistinctUsers','来源最少人数',cfg.growth?.minDistinctUsers,{min:1,max:20}),



          numberField('growth.capacity','容量',cfg.growth?.capacity,{min:1,max:200}),



          numberField('growth.injectMaxChars','注入上限（字符）',cfg.growth?.injectMaxChars,{min:50,max:2000})),



      ];







      const cultureChildren=[



        !key?h('div',{className:'ab-empty',key:'c-wait'},scopeWaiting):null,



        h('div',{className:'ab-row',key:'c-en'},toggleRow('启用群文化','groupCulture.enabled',culture.enabled!==false),



          h('button',{className:'ab-btn','data-testid':'culture-refresh',type:'button',disabled:disabled||culture.enabled===false||!key,onClick:()=>act('culture_refresh',{},{success:v=>v&&v.skipped?skipText(v.skipped):'已按本群真实消息重新整理摘要'})},'重新整理本群摘要')),



        h('div',{className:'ab-muted',key:'c-note'},!key?'选择群会话后才会整理本群知识。':(culture.hasSummary?('最近更新：'+time(culture.updatedAt)+'；来源为本群已收到的真实消息。'):'收到达到门槛的新消息后会自动整理；也可以手动刷新。')),



        !key?null:(culture.summary?h('div',{className:'ab-summary',key:'c-sum'},String(culture.summary).slice(0,1500)):h('div',{className:'ab-empty',key:'c-empty'},'暂无摘要（不是故障，等待真实群消息）。')),



        h('div',{className:'ab-grid2',key:'c-cfg'},



          numberField('groupCulture.refreshMinutes','自动整理间隔（分钟）',cfg.groupCulture?.refreshMinutes,{min:5,max:1440}),



          numberField('groupCulture.minNewMessages','触发整理的新消息数',cfg.groupCulture?.minNewMessages,{min:5,max:500}),



          numberField('groupCulture.injectMaxChars','注入上限（字符）',cfg.groupCulture?.injectMaxChars,{min:100,max:3000}),



          numberField('groupCulture.maxTerms','最多词汇',cfg.groupCulture?.maxTerms,{min:1,max:40})),



      ];







      const jobEvidence=job=>{



        const ev=job.evidence&&typeof job.evidence==='object'?job.evidence:null;



        const items=Array.isArray(ev?.items)?ev.items:[];



        if(!items.length)return null;



        return h('div',{className:'ab-evidence'},items.slice(0,5).map((it,i)=>h('div',{key:i,className:'ab-ev-item'},



          h('span',null,(it.title||'未标题')+' '+(it.bodyFetched?'（实际正文）':'（仅摘要）')),



          it.url?h('a',{href:it.url,target:'_blank',rel:'noreferrer'},it.url):null,



          it.body?h('div',{className:'ab-muted'},'正文摘录：'+String(it.body).slice(0,240)):null,



          !it.body&&it.summary?h('div',{className:'ab-muted'},'摘要：'+String(it.summary).slice(0,240)):null)),



          h('div',{className:'ab-muted'},'只有标注“实际正文”的是抓到的正文；搜索摘要不等于已读全文。'));



      };







      const activityChildren=[



        h('div',{className:'ab-row',key:'a-en'},toggleRow('启用活动','activity.enabled',activity.enabled!==false),



          h('button',{className:'ab-btn','data-testid':'activity-run',type:'button',disabled:disabled||activity.enabled===false,onClick:()=>act('activity_run',{},{result:setActivityResult})},'现在读一次'),



          h('span',{className:'ab-muted'},activity.inQuietHours?'静默时段：不会执行（不绕过）':(activity.busy?'已有任务在跑':'空闲'))),



        activityResult?h('div',{key:'a-res'},h('div',{className:'ab-note ab-'+businessText(activityResult).tone,'data-testid':'result-activity'},businessText(activityResult).text),



          activityResult.evidence?.items?.length?h('div',{className:'ab-muted'},'本次实际取回 '+activityResult.evidence.items.length+' 条公开内容'):null):null,



        h('div',{className:'ab-muted',key:'a-note'},'只读取公开内容；有来源 URL 时优先读已核实的地址，不拿随机搜索冒充目标推进。'),



        (activity.interests||[]).length



          ?h('div',{className:'ab-list',key:'a-int'},activity.interests.slice(0,6).map((it,i)=>h('div',{key:it.id||i,className:'ab-item'},



            h('span',null,(it.topic||it.title||'兴趣')+' · 来源：'+(it.origin||'配置')+' · '+(Array.isArray(it.urls)?it.urls.length:0)+' 个 URL'+(it.publishOk?' · 允许对外':'')),



            h('span',{className:'ab-muted'},it.query?('检索：'+it.query):''),



            Array.isArray(it.urls)&&it.urls.length?h('div',{className:'ab-muted'},it.urls.map((u,j)=>h('a',{key:j,href:u,target:'_blank',rel:'noreferrer',style:{marginRight:8}},u))):null)))



          :h('div',{className:'ab-empty',key:'a-empty'},'还没有兴趣来源；配置空列表时会沿已生效的成长兴趣阅读。'),



        (activity.jobs||[]).length?h('div',{className:'ab-list',key:'a-jobs'},activity.jobs.slice(0,6).map(j=>h('div',{key:j.id,className:'ab-item','data-testid':'activity-job'},



          h('span',null,j.kind+' · '+j.topic+' · '+({done:'完成',failed:'失败',running:'运行中',skipped:'跳过'}[j.status]||j.status)+(j.publish_ok?' · 已允许公开':'')),



          h('div',{className:'ab-row'},h('span',{className:'ab-muted'},time(j.finished_at||j.started_at)),



            j.status==='done'?h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>act('activity_mark_publish',{id:j.id,allow:!j.publish_ok},{success:'已更新发布许可'})},j.publish_ok?'取消公开许可':'允许用于对外素材'):null),



          jobEvidence(j)))):null,



        h('div',{className:'ab-muted',key:'a-sep'},'对外发布许可与“本群知识”分开：允许公开只影响签名/空间可用的素材，不代表允许跨群转发。'),



        h('div',{className:'ab-grid2',key:'a-cfg'},



          numberField('activity.dailyBudget','每日次数',cfg.activity?.dailyBudget,{min:1,max:20,hint:'0 不支持：后端会用默认次数；关闭活动请用模块开关。'}),



          numberField('activity.cooldownMinutes','冷却（分钟）',cfg.activity?.cooldownMinutes,{min:1,max:1440}),



          numberField('activity.quietHours.start','静默开始（0–23 点）',cfg.activity?.quietHours?.start,{min:0,max:23}),



          numberField('activity.quietHours.end','静默结束（0–23 点）',cfg.activity?.quietHours?.end,{min:0,max:23})),



        listField('activity.interests','兴趣列表（每行一个）',cfg.activity?.interests,{hint:'写入配置的真实兴趣；空列表时沿成长中已生效的兴趣阅读。',emptyText:'沿成长里 active 的兴趣，不额外添加。'}),



        listField('activity.publishTopics','允许对外发布的话题（每行一个）',cfg.activity?.publishTopics,{hint:'只有这里列出的话题才允许用于签名/空间等对外素材。',emptyText:'没有任何对外发布许可。'}),



      ];







      const presenceChildren=[



        h('div',{className:'ab-row',key:'p-en'},toggleRow('启用生活痕迹','presence.enabled',presence.enabled!==false),



          toggleRow('模块演练（独立配置）','presence.dryRun',cfg.presence?.dryRun!==false),



          chip(effectiveDry?'有效：演练':'有效：真实',effectiveDry?'drill':'warn')),



        h('div',{className:'ab-muted',key:'p-note'},'有效模式 = 全局演练 OR 模块演练；'+(effectiveDry?'当前任何对外动作都不会真正写入。':'当前对外动作会真实写入，请确认目标已开启。')),



        h('div',{className:'ab-row',key:'p-targets'},h('span',{className:'ab-label'},'允许目标'),



          ['avatar','signature','qzone','qzone_like','qzone_comment'].map(kind=>toggleRow({avatar:'头像',signature:'签名',qzone:'空间说说',qzone_like:'空间点赞',qzone_comment:'空间评论'}[kind],'presence.targets.'+kind,presence.targets?.[kind]===true))),



        h('div',{className:'ab-row',key:'p-probe'},



          h('button',{className:'ab-btn','data-testid':'presence-probe',type:'button',disabled:disabled,onClick:()=>act('presence_probe',{},{success:'协议探测完成（只读）'})},'探测协议（只读）'),



          h('span',{className:'ab-muted'},'协议 '+(presence.protocol?.adapter||'未探测')+' '+(presence.protocol?.version||''))),



        h('div',{className:'ab-row',key:'p-caps'},h('span',{className:'ab-muted'},'签名 '+(presence.capabilities?.signature==='supported'?'支持':presence.capabilities?.signature==='unsupported'?'不支持':'未探测')+' · 空间 '+(presence.capabilities?.qzone==='supported'?'支持':presence.capabilities?.qzone==='unsupported'?'不支持':'未探测')+' · 备份 '+(presence.backup?'有':'无'))),



        h('div',{className:'ab-grid2',key:'p-cfg'},



          textField('presence.avatarFile','头像文件（本机路径）',cfg.presence?.avatarFile,{hint:'浏览器不会上传文件；填本机图片路径，真实更换前必须先成功备份。'}),



          textField('presence.qzoneTarget','空间互动默认 tid',cfg.presence?.qzoneTarget,{hint:'点赞/评论需要说说 tid；下面也可以单独填写。'}),



          numberField('presence.dailyBudget','每日次数（全局共享）',cfg.presence?.dailyBudget,{min:1,max:10,hint:'0 不支持：后端会用默认次数；关闭请用模块开关。'}),



          numberField('presence.minIntervalHours','最小间隔（小时）',cfg.presence?.minIntervalHours,{min:0,max:168})),



        h('div',{className:'ab-muted',key:'p-presence-note'},presence.note||''),



        h('div',{className:'ab-grid2',key:'p-actions'},



          h('div',{className:'ab-field'},h('span',{className:'ab-field-label'},'签名正文（可选）'),



            h('input',{'data-testid':'sign-text','aria-label':'签名正文',value:signText,disabled:disabled,onChange:e=>setSignText(e.target.value),placeholder:'留空则使用“已允许公开”的活动材料'}),



            h('div',{className:'ab-row'},



              h('button',{className:'ab-btn','data-testid':'signature-dryrun',type:'button',disabled:disabled||cfg.enabled===false||presence.enabled===false,onClick:()=>act('presence_run',{kind:'signature',text:signText,dryRun:true},{result:setPresenceResult})},'演练签名（强制 dry-run）'),



              h('button',{className:'ab-btn',type:'button',disabled:disabled||cfg.enabled===false||presence.enabled===false||!signText.trim(),onClick:()=>act('presence_run',{kind:'signature',text:signText},{result:setPresenceResult,confirmText:(effectiveDry?'当前有效模式是演练，将只记录不写入。\n':'当前有效模式是真实：将写入 QQ 签名。\n')+'继续？'})},'按当前模式执行签名')),



            h('div',{className:'ab-muted'},'没有填写正文且没有已允许公开的素材时，后端会阻止并说明原因。')),



          h('div',{className:'ab-field'},h('span',{className:'ab-field-label'},'空间互动参数'),



            h('div',{className:'ab-row'},



              h('input',{'data-testid':'like-tid','aria-label':'空间目标 tid',value:likeTid||cfg.presence?.qzoneTarget||'',disabled:disabled,placeholder:'说说 tid',onChange:e=>setLikeTid(e.target.value),style:{flex:1,minWidth:100}}),



              h('input',{'data-testid':'like-uin','aria-label':'空间目标 QQ',value:likeUin,disabled:disabled,placeholder:'target_uin（可选）',onChange:e=>setLikeUin(e.target.value),style:{minWidth:100}}),



              h('input',{'data-testid':'like-abstime','aria-label':'说说时间戳',value:likeAbstime,disabled:disabled,placeholder:'abstime',onChange:e=>setLikeAbstime(e.target.value),style:{minWidth:80}})),



            h('input',{'data-testid':'comment-text','aria-label':'空间评论正文',value:commentText,disabled:disabled,placeholder:'评论正文（可选）',onChange:e=>setCommentText(e.target.value)}),



            h('div',{className:'ab-row'},



              h('button',{className:'ab-btn','data-testid':'qzone-like-dryrun',type:'button',disabled:disabled||presence.targets?.qzone_like!==true,onClick:()=>act('presence_run',{kind:'qzone_like',tid:likeTid||cfg.presence?.qzoneTarget,uin:likeUin,abstime:Number(likeAbstime)||0,dryRun:true},{result:setPresenceResult})},'演练点赞（强制 dry-run）'),



              h('button',{className:'ab-btn','data-testid':'qzone-comment-dryrun',type:'button',disabled:disabled||presence.targets?.qzone_comment!==true,onClick:()=>act('presence_run',{kind:'qzone_comment',tid:likeTid||cfg.presence?.qzoneTarget,uin:likeUin,abstime:Number(likeAbstime)||0,text:commentText,dryRun:true},{result:setPresenceResult})},'演练评论（强制 dry-run）')),



            h('div',{className:'ab-muted'},'tid/uin/abstime/正文会实际传给后端（真实执行会二次确认）。')),



          h('div',{className:'ab-field'},h('span',{className:'ab-field-label'},'头像 / 说说'),



            h('div',{className:'ab-row'},



              h('button',{className:'ab-btn','data-testid':'avatar-dryrun',type:'button',disabled:disabled||!cfg.presence?.avatarFile,onClick:()=>act('presence_run',{kind:'avatar',dryRun:true},{result:setPresenceResult})},'演练换头像（强制 dry-run）'),



              h('button',{className:'ab-btn',type:'button',disabled:disabled||!cfg.presence?.avatarFile,onClick:()=>act('presence_run',{kind:'avatar'},{result:setPresenceResult,confirmText:(effectiveDry?'当前是演练模式。':'演练已关闭：会真实更换头像（先备份，失败即取消）。')+'\n继续？'})},'按当前模式换头像'),



              h('button',{className:'ab-btn','data-testid':'qzone-dryrun',type:'button',disabled:disabled||presence.targets?.qzone!==true,onClick:()=>act('presence_run',{kind:'qzone',dryRun:true},{result:setPresenceResult})},'演练发说说（强制 dry-run）'),



              h('button',{className:'ab-btn',type:'button',disabled:disabled||!presence.backup,onClick:()=>act('presence_restore_avatar',{},{result:setPresenceResult,confirmText:(effectiveDry?'当前是演练模式，只记录。':'会真实还原头像。')+'\n继续？'})},'还原头像'))),



          presenceResult?resultBox(presenceResult,'presence'):null),



      ];







      const speechChildren=[



        h('div',{className:'ab-row',key:'s-en'},toggleRow('启用自然表达','speech.enabled',speech.enabled!==false)),



        h('div',{className:'ab-row',key:'s-toggles'},



          toggleRow('表情包只当语气','speech.stickerAsTone',speech.config?.stickerAsTone!==false),



          toggleRow('接图不尬夸','speech.imageMetaGuard',speech.config?.imageMetaGuard!==false),



          toggleRow('明确让看时正常看图','speech.allowWhenAsked',speech.config?.allowWhenAsked!==false)),



        numberField('speech.stickerSubType','表情 sub_type',cfg.speech?.stickerSubType,{min:0,max:10}),



        h('div',{className:'ab-row',key:'s-rec'},



          toggleRow('启用群内娱乐','recreation.enabled',recreation.enabled!==false),



          toggleRow('梗回应','recreation.meme.enabled',recreation.meme?.enabled!==false),



          toggleRow('启用复读','recreation.repeat.enabled',recreation.repeat?.enabled===true)),



        h('div',{className:'ab-muted',key:'s-note'},'复读规则：连续两人同一句 + 会话空闲 + 每小时间隔/上限 + 概率；发送前会持久 claim，投递不明不会自动重发。'),



        h('div',{className:'ab-grid2',key:'s-cfg'},



          numberField('recreation.repeat.maxPerHour','复读每小时上限',cfg.recreation?.repeat?.maxPerHour,{min:1,max:20,hint:'0 不支持：后端会用默认值；关闭复读请用上面的开关。'}),



          numberField('recreation.repeat.minIntervalSeconds','最小间隔（秒）',cfg.recreation?.repeat?.minIntervalSeconds,{min:0,max:86400}),



          numberField('recreation.repeat.windowSeconds','同文判定窗口（秒）',cfg.recreation?.repeat?.windowSeconds,{min:10,max:3600})),



      ];







      const transferChildren=[



        h('div',{className:'ab-row',key:'t-en'},toggleRow('启用内容传递','transfer.enabled',transfer.enabled!==false),



          toggleRow('需要管理员确认','transfer.requireAdminConfirm',transfer.requireAdminConfirm!==false)),



        h('div',{className:'ab-muted',key:'t-note'},'读取他人内容不等于允许跨群转发；目标必须在允许列表里，且目标群已出现相同正文时会跳过。'),



        h('div',{className:'ab-grid2',key:'t-cfg'},



          numberField('transfer.ttlHours','内容过期（小时）',cfg.transfer?.ttlHours,{min:1,max:168}),



          numberField('transfer.maxPerHour','每小时转发上限',cfg.transfer?.maxPerHour,{min:1,max:20,hint:'0 不支持：后端会用默认值；关闭请用模块开关。'}),



          numberField('transfer.maxForwardNodes','合并转发节点上限',cfg.transfer?.maxForwardNodes,{min:1,max:200}),



          numberField('transfer.maxExcerptChars','正文摘要上限（字符）',cfg.transfer?.maxExcerptChars,{min:100,max:8000})),



        listField('transfer.allowFrom','允许来源会话（每行一个）',cfg.transfer?.allowFrom,{hint:'会话 key，例如 group:123；只允许这些来源登记内容。',emptyText:'不额外限制来源本身（仍受会话与确认约束）。'}),



        listField('transfer.allowTo','允许目标会话（每行一个）',cfg.transfer?.allowTo,{hint:'会话 key，例如 group:456；空列表不会新增任何目标。',emptyText:'只允许现有白名单内的会话。'}),



        (transfer.pending||[]).length



          ?h('div',{className:'ab-list',key:'t-list'},transfer.pending.slice(0,10).map(t=>h('div',{key:t.id,className:'ab-item','data-testid':'transfer-item'},



            h('span',null,(t.kind||'内容')+' · '+({pending:'待确认',ready:'可转发',confirmed:'已确认',sending:'发送中',unknown:'结果不明（不自动重发）',relayed:'已转发',failed:'发送失败'}[t.status]||t.status)),



            h('div',{className:'ab-row'},



              t.status==='pending'?h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>act('transfer_confirm',{id:t.id},{success:'已确认，等待选择目标'})},'确认'):null,



              ['confirmed','ready'].includes(t.status)?h(React.Fragment,null,



                h('select',{'data-testid':'relay-target','aria-label':'转发目标',value:transferTarget,disabled:disabled,onChange:e=>setTransferTarget(e.target.value)},[h('option',{key:'',value:''},'选择目标群'),...scopesForTarget.map(s=>h('option',{key:s.key,value:s.key},s.label))]),



                h('button',{className:'ab-btn','data-testid':'transfer-relay',type:'button',disabled:disabled||!transferTarget,onClick:()=>act('transfer_relay',{id:t.id,target:transferTarget},{confirmText:'确认把这条内容转发到所选目标群？',result:setTransferResult})},'转发到所选目标')):null,



              t.status==='unknown'?h('span',{className:'ab-warn'},'结果不明：不提供重发，避免重复发送'):null,



              ['pending','ready','confirmed','unknown'].includes(t.status)?h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>act('transfer_reject',{id:t.id},{success:'已拒绝'})},'拒绝'):null))))



          :h('div',{className:'ab-empty',key:'t-empty'},'没有待处理的卡片/转发内容。'),



        transferResult?resultBox(transferResult,'transfer'):null,



      ];







      const voiceState=()=>{



        if(cfg.enabled===false)return ['总开关关闭','off'];



        if(!voice.enabled)return ['新模块关闭','off'];



        if(!voice.ready)return ['待配置','warn'];



        if(saving==='voice_test')return ['正在合成','drill'];



        return ['已启用','ok'];



      };



      const vs=voiceState();



      const voiceChildren=[



        h('div',{className:'ab-row',key:'v-native'},



          h('span',{className:'ab-badge'},'旧原生 DashScope 路径：'+(voice.nativePath?'已配置':'不可用')+'（保持现状）'),



          chip(vs[0],vs[1])),



        h('div',{className:'ab-row',key:'v-en'},toggleRow('启用新语音模块','voice.enabled',voice.enabled===true),h('span',{className:'ab-muted'},'新模块关闭时完全保留旧路径，不影响现有语音。')),



        h('div',{className:'ab-grid2',key:'v-cfg'},



          h('div',{className:'ab-field'},h('span',{className:'ab-field-label'},'provider'),



            h('select',{'data-testid':'voice-provider','aria-label':'语音 provider',value:cfg.voice?.provider||'dashscope',disabled:disabled,onChange:e=>void save('voice.provider',e.target.value,'语音 provider')},



              h('option',{value:'dashscope'},'dashscope（现有）'),h('option',{value:'gptsovits'},'gptsovits（本机可选）'))),



          numberField('voice.maxChars','单条上限（字符）',cfg.voice?.maxChars,{min:1,max:500}),



          numberField('voice.timeoutMs','合成超时（毫秒）',cfg.voice?.timeoutMs,{min:1000,max:120000}),



          numberField('voice.cleanupMinutes','临时文件保留（分钟）',cfg.voice?.cleanupMinutes,{min:1,max:120}),



          textField('voice.gptsovits.baseUrl','GPT-SoVITS 地址（本机）',cfg.voice?.gptsovits?.baseUrl),



          textField('voice.gptsovits.refAudioPath','参考音频路径（本机）',cfg.voice?.gptsovits?.refAudioPath),



          textField('voice.gptsovits.promptText','参考音频文本',cfg.voice?.gptsovits?.promptText),



          textField('voice.gptsovits.textLang','合成语言',cfg.voice?.gptsovits?.textLang)),



        h('div',{className:'ab-muted',key:'v-note'},'凭据不下发、不显示；这里只配置本机服务地址和参考音频路径。'),



        h('div',{className:'ab-row',key:'v-test'},



          h('input',{'data-testid':'voice-text','aria-label':'试合成文本',value:voiceText,disabled:disabled,maxLength:120,onChange:e=>setVoiceText(e.target.value),style:{flex:1,minWidth:180}}),



          h('button',{className:'ab-btn','data-testid':'voice-test',type:'button',disabled:disabled||!voiceText.trim(),onClick:()=>act('voice_test',{text:voiceText,provider:cfg.voice?.provider||'dashscope'},{result:setVoiceResult,success:'已请求本地试合成（不发 QQ）'})},saving==='voice_test'?'合成中…':'本地试合成（不发 QQ）')),



        h('div',{className:'ab-muted',key:'v-test-note'},'试合成只在本机生成音频，不会发送；共享缓存会保留，只清理本次独占副本（清理结果据实显示）。'),



        voiceResult?h('div',{className:'ab-note '+(voiceResult.ok&&voiceResult.cleaned?'ab-ok':'ab-warn'),key:'v-result','data-testid':'result-voice'},



          voiceResult.ok?('合成成功 · '+(voiceResult.provider||'')+' · '+(voiceResult.cleaned?'临时副本已清理':'临时副本未清理：'+(voiceResult.cleanupError||'未知原因'))+(voiceResult.sharedCache?' · 共享缓存保留':'')):('试合成失败：'+(voiceResult.reason==='gptsovits_unconfigured'?'GPT-SoVITS 未配置':voiceResult.reason==='dashscope_unconfigured'?'DashScope 未配置':voiceResult.reason==='too_long'?'文本超过上限':(voiceResult.reason||'未知原因')))):null,



        (voice.recent||[]).length?h('div',{className:'ab-muted',key:'v-recent'},'最近：'+voice.recent.slice(0,3).map(v=>v.provider+' '+(v.status==='ok'?'成功':v.status)).join(' · ')):null,



      ];







      const auditChildren=[



        (data.actions||[]).length



          ?h('div',{className:'ab-list',key:'au-list'},data.actions.slice(0,20).map(a=>h('div',{key:a.id,className:'ab-item'},



            h('span',null,({growth:'成长',groupCulture:'群文化',activity:'活动',presence:'生活痕迹',speech:'自然表达',recreation:'娱乐',transfer:'传递',voice:'声音',gate:'额度'}[a.module]||a.module)+' · '+a.action+' · '+({applied:'已执行',denied:'被拒绝',failed:'失败','dry-run':'演练',reserved:'已预留'}[a.result]||a.result)),



            h('span',{className:'ab-muted'},time(a.at)+(a.actor?' · '+(a.actor==='admin'?'管理员':'后台'):'')+(a.detail?' · '+a.detail:'')))))



          :h('div',{className:'ab-empty',key:'au-empty'},'还没有动作记录。'),



      ];







      return h('div',{className:'ab-panel','data-testid':'abilities-panel','aria-busy':String(disabled)},



        h('style',null,`.ab-panel{display:flex;flex-direction:column;gap:14px;min-width:0;--ab-ok:#3fae86;--ab-warn:#d99a45;--ab-off:#8a93a3;--ab-drill:#5b8fd6;--ab-pend:#9a7bd0}



.ab-card{border:1px solid var(--qq-line,#2a3140);background:var(--qq-surface,rgba(130,150,175,.045));border-radius:14px;padding:16px;min-width:0;display:flex;flex-direction:column;gap:10px;scroll-margin-top:12px}



.ab-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}.ab-head h3{margin:0;font-size:15px}.ab-head small{font-size:11px;opacity:.55}



.ab-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ab-tile{border:1px solid var(--qq-line,#2a3140);border-radius:11px;padding:11px;display:flex;flex-direction:column;gap:6px;min-width:0;text-decoration:none;color:inherit}



.ab-tile:hover{border-color:var(--qq-accent,#4cc9b0)}.ab-tile-top{display:flex;justify-content:space-between;align-items:center;gap:8px}.ab-tile strong{font-size:12px}.ab-tile span{font-size:11px;opacity:.72;overflow-wrap:anywhere}



.ab-pill{border:1px solid currentColor;border-radius:999px;padding:0 7px;font-size:10px;line-height:17px;white-space:nowrap;opacity:.9}



.ab-ok{color:var(--ab-ok)}.ab-warn{color:var(--ab-warn)}.ab-off{color:var(--ab-off)}.ab-drill{color:var(--ab-drill)}.ab-pend{color:var(--ab-pend)}



.ab-nav{display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:var(--qq-surface,rgba(20,24,31,.92));padding:6px;border-radius:10px;border:1px solid var(--qq-line,#2a3140)}



.ab-nav a{font-size:11px;text-decoration:none;color:inherit;opacity:.75;border:1px solid transparent;border-radius:8px;padding:2px 7px}.ab-nav a:hover{opacity:1;border-color:var(--qq-line,#2a3140)}



.ab-field{display:flex;flex-direction:column;gap:4px;min-width:0}.ab-field-label{font-size:11px;opacity:.68}.ab-inline{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ab-inline input{flex:1;min-width:140px}



.ab-btn{border:1px solid var(--qq-line,#2a3140);background:transparent;border-radius:8px;padding:5px 9px;font-size:11px;color:inherit;cursor:pointer}.ab-btn:disabled{opacity:.45;cursor:default}



.ab-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px}.ab-label{min-width:92px;opacity:.62;font-size:11px}.ab-check{display:flex;align-items:center;gap:6px;font-size:12px}



.ab-list{display:flex;flex-direction:column;gap:6px}.ab-item{border-top:1px solid var(--qq-line,#2a3140);padding-top:6px;font-size:11px;display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere}



.ab-muted{font-size:11px;opacity:.55}.ab-badge{font-size:11px;border:1px dashed var(--qq-line,#2a3140);border-radius:7px;padding:2px 6px;opacity:.8}.ab-note{font-size:11px;line-height:1.6;border-left:2px solid currentColor;padding-left:8px}.ab-err{font-size:11px;color:#e06c6c}.ab-empty{font-size:11px;opacity:.5;padding:4px 0}



.ab-summary{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;border:1px dashed var(--qq-line,#2a3140);border-radius:8px;padding:8px}



.ab-evidence{margin-top:6px;display:flex;flex-direction:column;gap:4px}.ab-ev-item{font-size:11px;display:flex;flex-direction:column;gap:2px;border-left:2px solid var(--qq-line,#2a3140);padding-left:6px}.ab-ev-item a{color:inherit;opacity:.75;overflow-wrap:anywhere}



textarea{width:100%;min-height:70px;border:1px solid var(--qq-line,#2a3140);background:transparent;border-radius:8px;color:inherit;padding:6px;font:inherit}



.ab-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(max-width:1080px){.ab-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.ab-grid,.ab-grid2{grid-template-columns:1fr}.ab-nav{position:static}.ab-label{min-width:0}}`),



        h('div',{className:'ab-card','aria-label':'八类能力总览'},



          h('div',{className:'ab-head'},h('h3',null,'八类能力'),h('small',null,'状态读取于 '+time(lastAt)+(refreshing?' · 刷新中…':''))),



          h('div',{className:'ab-row'},h('span',{className:'ab-label'},'会话'),h('select',{'data-testid':'scope-select','aria-label':'查看的群会话',value:key,disabled:disabled,onChange:e=>setKey(e.target.value)},[h('option',{key:'',value:''},'全局设置（不选群）'),...scopes.map(c=>h('option',{key:c.key,value:c.key},c.title||c.name||shortKey(c.key)))]),



            h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>load(true)},'手动刷新'),h('button',{className:'ab-btn',type:'button',disabled:disabled,onClick:()=>{setDrafts({});setFieldErr({});setVerify(null);load(true);}},'重置未保存输入')),



          h('div',{className:'ab-muted'},'会话选择只影响成长/群文化的查看和内容转发目标；下方模块设置是全局的，会影响所有会话。'),



          h('div',{className:'ab-row'},toggleRow('总开关','enabled',cfg.enabled!==false,'关闭后所有模块停止，不再观察或发送',v=>{if(!v&&!window.confirm('关闭八类能力总开关会停止所有模块（含群文化/成长/活动）。继续？'))return;void save('enabled',v,'总开关');}),



            toggleRow('演练模式（对外动作只记录，不真正写入）','dryRun',cfg.dryRun!==false,'关闭后对外动作会真实执行',v=>{if(!v&&!window.confirm('关闭演练会允许头像/签名/空间等对外动作真实执行。\n只有已配置目标并确认要真实生效时才关闭。继续？'))return;void save('dryRun',v,'演练模式');}),



            chip(cfg.enabled===false?'总开关关':'总开关开',cfg.enabled===false?'off':'ok'),chip(cfg.dryRun!==false?'演练模式':'真实模式',cfg.dryRun!==false?'drill':'warn')),



          err?h('div',{className:'ab-err',role:'alert'},err):null,



          notice?h('div',{className:'ab-note '+(notice.tone==='ok'?'ab-ok':notice.tone==='drill'?'ab-drill':'ab-warn'),role:'status','data-testid':'notice'},notice.text):null,



          h('div',{className:'ab-grid'},



            tile('①','growth','自己的特点',!key?'选择群会话后显示':(growth.counts?.active||0)+' 生效 · '+(growth.counts?.trial||0)+' 试用',0),



            tile('②','culture','融入具体的群',!key?'选择群会话后显示':(culture.hasSummary?'已整理 '+culture.messageCount+' 条消息':'还没有群文化摘要'),1),



            tile('③','activity','自己的活动','今日 '+((activity.budget?.used)||0)+'/'+((activity.budget?.perDay)||0)+' · 兴趣 '+((activity.interests||[]).length),2),



            tile('④','presence','对外生活痕迹','签名 '+(presence.capabilities?.signature==='supported'?'可用':presence.capabilities?.signature==='unsupported'?'不支持':'未探测'),3),



            tile('⑤','speech','说话自然',speech.enabled?'表情当语气 · 接图不尬夸':'已关闭',4),



            tile('⑥','recreation','群内娱乐','复读'+(recreation.repeat?.enabled?'开':'关')+' · 梗'+(recreation.meme?.enabled!==false?'开':'关'),5),



            tile('⑦','transfer','内容传递',(transfer.counts?.pending||0)+' 待确认 · 默认需要管理员确认',6),



            tile('⑧','voice','声音',!voice.enabled?'新模块关闭 · 旧原生路径'+(voice.nativePath?'可用':'未知'):(voice.ready?'新语音已启用 · '+voice.provider:'新语音待配置'),7)),



          h('div',{className:'ab-nav'},[['growth','成长'],['culture','群文化'],['activity','活动'],['presence','生活痕迹'],['speech','说话与娱乐'],['transfer','内容传递'],['voice','声音'],['audit','审计']].map(([id,label])=>h('a',{key:id,href:'#ab-'+id},label)))),



        card('growth','① 成长：提出 → 试用 → 生效',(growth.counts?.active||0)+' 生效 / '+(growth.counts?.trial||0)+' 试用 / '+(growth.counts?.proposed||0)+' 候选',growthChildren,true),



        card('culture','② 群文化：本群自己的说话方式',culture.hasSummary?'已整理 '+culture.messageCount+' 条':'还没有摘要',cultureChildren),



        card('activity','③ 自己的活动：有预算的公开阅读','今日 '+((activity.budget?.used)||0)+'/'+((activity.budget?.perDay)||0)+(activity.inQuietHours?' · 静默中':''),activityChildren),



        card('presence','④ 对外生活痕迹',cfg.enabled===false||presence.enabled===false?'已关闭':effectiveDry?'演练中（不写入）':'真实模式',presenceChildren),



        card('speech','⑤ 说话自然 / ⑥ 群内娱乐','低开销处理，不改写整句',speechChildren),



        card('transfer','⑦ 内容传递：来源 → 确认 → 目标','一次只转一个目标',transferChildren),



        card('voice','⑧ 声音','旧原生路径'+(voice.nativePath?'可用':'未知')+' / 新模块'+(voice.enabled?'开':'关'),voiceChildren),



        card('audit','最近动作与拒绝记录','只读审计',auditChildren));



    }







    function MinecraftProjectPanel() {
      const [data,setData]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
      const alive=React.useRef(true);
      const refresh=useCallback(async()=>{try{const res=await fetch('/qq-bot-suite/minecraft',{cache:'no-store'});const value=await res.json();if(!res.ok||!value.ok)throw Error(value.error||'读取失败');if(alive.current){setData(value);setError('')}}catch(e){if(alive.current)setError('无法读取游戏状态：'+e.message)}},[]);
      useEffect(()=>{alive.current=true;refresh();const timer=setInterval(refresh,10000);return()=>{alive.current=false;clearInterval(timer)}},[refresh]);
      const change=async(on)=>{setWorking(true);setError('');try{const res=await fetch('/qq-bot-suite/minecraft-control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on})});const result=await res.json();if(!res.ok||!result?.ok){await refresh();throw Error(result?.error||'未确认切换')}await refresh()}catch(e){setError('切换失败：'+e.message)}finally{if(alive.current)setWorking(false)}};
      const pos=p=>p?`(${p.x}, ${p.y}, ${p.z})`:'未记录';
      const st=data?.status,plan=data?.plan,home=data?.home,online=!!data?.connected,playing=st?.selfPlay;
      const row=(label,value)=>h('div',{style:{padding:'11px 0',borderBottom:'1px solid var(--qq-line)'}},h('small',{style:{opacity:.65,display:'block',marginBottom:3}},label),h('div',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},value||'暂无记录'));
      const box={...S.card,padding:'18px',minWidth:0};
      const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:14};
      const equip=st?.equipment;
      return h('section',{className:'qq-section','aria-label':'Minecraft 项目'},
        h('div',{style:{...box,marginBottom:14}},h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'start',gap:12,flexWrap:'wrap'}},
          h('div',null,h('h3',null,'Minecraft 一起玩'),h('p',{style:{opacity:.7,marginTop:5}},'查看小鲸鲸的游戏状态、计划和共同基地。')),
          h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},h('button',{type:'button',style:S.btn,onClick:refresh,disabled:working},'刷新'),
            h('button',{type:'button',style:S.btn,onClick:()=>change(playing!==true),disabled:working||!online||playing===null},working?'正在切换…':playing===true?'暂停自主游玩':'继续自主游玩'))),
          h('div',{role:'status',style:{marginTop:14}},!data?'正在读取游戏状态…':!online?((data.serviceReachable?'游戏尚未连接':'游戏服务未连接')+(data.savedManual===false?' · 自主游玩已暂停':'')):playing===true?'已连接 · 自主游玩中':playing===false?'已连接 · 自主游玩已暂停':'已连接 · 自主状态未知'),
          error?h('div',{role:'alert',style:{...S.err,marginTop:10}},error):null),
        h('div',{style:grid},
          h('div',{style:box},h('h3',null,'现在'),row('当前位置',online?pos(st.pos):'游戏未连接'),row('生命 / 饥饿',online?`${st.health??'未知'} / 20　·　${st.food??'未知'} / 20`:'等待连接'),row('世界',home?.world||st?.dimension||'未确认'),row('手持',st?.heldItem?.displayName||'空手或未知')),
          h('div',{style:box},h('h3',null,'自己的计划'),row('长期目标',plan?.longTerm),row('当前目标',plan?.goal),row('完成条件',plan?.completion),row('接下来',plan?.next),h('small',{style:{opacity:.6}},plan?.updatedAt?'上次记录：'+new Date(plan.updatedAt).toLocaleString()+' · 可能需要现场核实':'暂无已保存计划')),
          h('div',{style:box},h('h3',null,'最近进展'),row('已记录',plan?.progress),row('本轮结果',plan?.outcome)),
          h('div',{style:box},h('h3',null,'共同地点'),row('家',pos(home?.home)),row('小屋原点',pos(home?.house)),row('旧矿道入口',pos(home?.mineEntrance)),h('small',{style:{opacity:.6}},'历史位置可能改变，使用前需要现场确认。'))),
        h('div',{style:{...box,marginTop:14}},h('h3',null,'装备与背包'),
          !online?h('p',{style:{opacity:.65,marginTop:8}},'连接游戏后显示。'):h(React.Fragment,null,
            h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,margin:'12px 0'}},[['head','头'],['torso','身'],['legs','腿'],['feet','脚']].map(([k,label])=>h('span',{key:k,style:{...S.pill}},label+'：'+(equip?equip[k]?.displayName||'空':'未知')))),
            h('details',null,h('summary',null,`背包物品（${data?.inventory?.length??'未知'} 格）`),data?.inventory?.length?h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginTop:10}},data.inventory.map((v,i)=>h('span',{key:i,style:S.pill},`${v.displayName} × ${v.count}`))):h('p',{style:{opacity:.65,marginTop:8}},data?.inventory?'背包为空':'暂时无法读取背包。')))),
        home?.mineRoute?.length?h('details',{style:{...box,marginTop:14}},h('summary',null,'旧矿道路标'),h('ol',null,home.mineRoute.map((p,i)=>h('li',{key:i},pos(p)+' '+(p.note||''))))):null);
    }

    function Panel() {



      const memoryRef=React.useRef(null);



      const [section,setSection]=useState('overview'),[memorySummary,setMemorySummary]=useState(null),[reviewRequest,setReviewRequest]=useState(0),[treeRefresh,setTreeRefresh]=useState(0);



      const openMemory=(review=false)=>{setSection('memory');if(review)setReviewRequest(n=>n+1);};



      const [panel, setPanel] = useState(null);



      const [err, setErr] = useState('');



      const [busy, setBusy] = useState(false);



      const [msg, setMsg] = useState('');



      const [slang, setSlang] = useState(null);



      const [slangSelected, setSlangSelected] = useState([]);



      const [slangPage, setSlangPage] = useState(0);



      const [slangScope, setSlangScope] = useState('');



      const [slangPolicy, setSlangPolicy] = useState('natural');



      const [wl, setWl] = useState(null);



      const [levels, setLevels] = useState({});   // key -> 拖动中的本地档位



      const [saving, setSaving] = useState('');



      // ── 首次配置向导（分享版）────────────────────────────────────────────



      const [setup, setSetup] = useState(null);          // /snowluma/detect 的结果



      const [setupForm, setSetupForm] = useState({ snowDir: '', uin: '', ownerQQ: '', groups: '' });



      const [setupOut, setSetupOut] = useState('');



      const [setupBusy, setSetupBusy] = useState(false);



      // ── 提示词注入（2026-10-21 加）──────────────────────────────────────



      const [promptKey, setPromptKey] = useState('');



      const [promptData, setPromptData] = useState(null);



      const [promptBusy, setPromptBusy] = useState(false);



      // ── 总提示词（我的提示词.md）直接编辑（2026-10-21 加）────────────────



      const cpDraftRef=React.useRef(''),cpSavedRef=React.useRef(null);



      const [cp, setCp] = useState(null);          // 服务端最新读到的一份



      const [cpDraft, setCpDraft] = useState('');  // 编辑中的文本（原文，含注释）



      const [cpSaving, setCpSaving] = useState(false);



      // ── 攻击形态（2026-10-27 加）──────────────────────────────────────



      const [am, setAm] = useState(null);



      const [amDur, setAmDur] = useState(15);



      const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };







      const loadPanel = useCallback(() => {



        setBusy(true);



        fetch('/qq-bot-suite/panel', { headers: { accept: 'application/json' } })



          .then((r) => r.json())



          .then((j) => { setPanel(j); setErr(''); })



          .catch((e) => setErr(e && e.message ? e.message : '读取失败'))



          .finally(() => setBusy(false));



      }, []);







      // 拉取某会话最近一次「真实注入」的全文（桥侧抓的，令牌已遮）



      // ⚠️ 这里必须自己判 HTTP 状态、别直接 r.json()：



      //   前端 client.js 与 host lib/index.js 是**分开加载**的 ——



      //   刷新页面就能拿到新前端，但 host 那段要重启 DSH 才换。



      //   两边不同步时这个端点会 404、响应体是空的，r.json() 会抛



      //   "Unexpected end of JSON input"（2026-10-21 用户当场撞到）。



      const loadPrompt = (key) => {



        const k = String(key || '').trim();



        if (!k) { flash('先选一个会话'); return; }



        setPromptBusy(true);



        fetch('/qq-bot-suite/last-prompt?key=' + encodeURIComponent(k), { headers: { accept: 'application/json' } })



          .then(async (r) => {



            if (r.status === 404) {



              throw new Error('插件主机端还没重载（这个框的后端要重启 DSH 才生效）');



            }



            const text = await r.text();



            if (!text) throw new Error('宿主返回了空响应（HTTP ' + r.status + '）');



            try { return JSON.parse(text); } catch (e) { throw new Error('宿主返回的不是 JSON（HTTP ' + r.status + '）'); }



          })



          .then((j) => setPromptData(j))



          .catch((e) => setPromptData({ ok: false, error: (e && e.message) || '读取失败' }))



          .finally(() => setPromptBusy(false));



      };







      // 总提示词：读（原文 raw，保留注释）→ 编辑 → 写回。



      // ⚠️ 桥每轮现读该文件，所以保存后**下一轮就生效**，不用重启桥。



      // ⚠️ 保存由桥侧自动备份旧版本（最多留 5 份），这里只提示，不做备份。



      const loadCustomPrompt = useCallback(() => {



        apiGet('/api/custom-prompt')



          .then((d) => { const raw=String(d?.raw||'');if(cpSavedRef.current===null||cpDraftRef.current===cpSavedRef.current){cpDraftRef.current=raw;setCpDraft(raw);}cpSavedRef.current=raw;setCp(d); })



          .catch(() => {});



      }, []);







      const saveCustomPrompt = () => {



        if (!cp || cpSaving) return;



        const text = String(cpDraft || '');



        if (!text.trim()) { flash('内容为空，不保存'); return; }



        if (!window.confirm('保存后下一轮就生效（桥每轮现读，不用重启）。\n旧版本会自动备份，最多留 5 份。\n\n继续？')) return;



        setCpSaving(true);



        apiPost('/api/custom-prompt', { text })



          .then((d) => {



            flash('已保存 · 注入 ' + ((d && d.chars) || 0) + ' 字' + (d && d.backup ? '（旧版已备份）' : ''));



            loadCustomPrompt();



          })



          .catch((e) => flash('保存失败：' + ((e && e.message) || '未知')))



          .finally(() => setCpSaving(false));



      };







      // 攻击形态（2026-10-27 加）：群里有人骂机器人 → 只对这个人切贴吧鱼人格



      const loadAttackMode = useCallback(() => {



        apiGet('/api/attack-mode/state')



          .then((d) => { setAm(d); if (d && d.config) setAmDur(Number(d.config.durationMinutes) || 15); })



          .catch(() => {});



      }, []);



      const saveAttack = (patch) => {



        apiPost('/api/attack-mode/config', patch)



          .then((d) => { setAm(d); if (d && d.config) setAmDur(Number(d.config.durationMinutes) || 15); flash('攻击形态已保存'); })



          .catch((e) => flash('保存失败：' + ((e && e.message) || '未知')));



      };



      const clearAttack = () => {



        apiPost('/api/attack-mode/clear', {})



          .then((d) => { setAm(d); flash('已清空攻击目标'); })



          .catch((e) => flash('清空失败：' + ((e && e.message) || '未知')));



      };







      const loadSide = useCallback(() => {



        apiGet('/api/slang').then((d) => setSlang(d)).catch(() => {});



        apiGet('/api/whitelist').then((d) => setWl(d)).catch(() => {});



        loadCustomPrompt();



        loadAttackMode();



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



        const cand = ((slang && slang.entries) || []).filter(e => e.status === 'candidate');



        const ids = cand.slice(0, 8).map((e) => e.id);



        if (!ids.length) { flash('没有候选词'); return; }



        setSaving('slang');



        apiPost('/api/slang/research', { ids })



          .then(() => { flash('研究任务已提交'); loadSide(); loadPanel(); })



          .catch((e) => flash('研究失败：' + e.message))



          .finally(() => setSaving(''));



      };







      const slangReview = (decision) => {



        if (!slangSelected.length) { flash('请先选择候选词'); return; }



        setSaving('slang');



        apiPost('/api/slang/batch-' + decision, {ids:slangSelected,policy:slangPolicy})



          .then(d=>{ flash(decision === 'confirm' ? '已确认 ' + (d.confirmedCount || 0) + ' 条，跳过 ' + (d.skippedCount || 0) + ' 条' : '已拒绝 ' + (d.rejectedCount || 0) + ' 条'); setSlangSelected([]); loadSide(); })



          .catch(e=>flash('审核失败：' + e.message)).finally(()=>setSaving(''));



      };



      const assignSlangScope = () => {



        if (!slangSelected.length || !slangScope.trim()) { flash('请选择词条并填写目标范围'); return; }



        setSaving('slang'); apiPost('/api/slang/batch-confirm',{operation:'scope',ids:slangSelected,scope:slangScope.trim()})



          .then(d=>{flash('已归类 '+(d.updatedCount||0)+' 条');setSlangSelected([]);loadSide();})



          .catch(e=>flash('归类失败：'+e.message)).finally(()=>setSaving(''));



      };



      const setSlangUse = () => {



        if (!slangSelected.length) return;



        setSaving('slang');apiPost('/api/slang/batch-confirm',{operation:'policy',ids:slangSelected,policy:slangPolicy})



          .then(d=>{flash('已更新 '+(d.updatedCount||0)+' 条使用权限');setSlangSelected([]);loadSide();})



          .catch(e=>flash('设置失败：'+e.message)).finally(()=>setSaving(''));



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



      const slangSorted = ((slang && slang.entries) || []).slice().sort((a,b)=>Number(b.status==='candidate')-Number(a.status==='candidate') || String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));



      const slangPageCount = Math.max(1,Math.ceil(slangSorted.length/50));



      const slangCurrent = slangSorted.slice(Math.min(slangPage,slangPageCount-1)*50,Math.min(slangPage,slangPageCount-1)*50+50);







      const pending=memorySummary?.totals?.pending;



      const nav=[['overview','项目总览','所有能力与状态'],['minecraft','Minecraft','一起游玩与基地'],['memory','记忆树','看看它记住了什么'],['learning','学习与表达','自主学习和语料检索'],['abilities','八类能力','成长与生活痕迹'],['voicecall','语音通话','QQ 通话和设备'],['settings','聊天设置','角色和参与方式'],['memewiki','梗百科','梗和黑话词典'],['more','更多功能','用量与进阶工具']];



      return h('div',{className:'qq-workbench',style:S.wrap},



        h('style',null,DASHBOARD_CSS),



        h('header',{className:'qq-hero'},h('div',{className:'qq-brand'},h('span',{className:'qq-brand-mark'},'Q'),h('div',null,h('h2',null,'聊天小伙伴'),h('p',null,'记住重要的人和事，接着上次继续聊。'))),h('div',{className:'qq-hero-actions'},h('span',{className:'qq-connection'},h('i',{style:dot(host?.bridgePort&&br?.dshReady)}),busy?'正在更新':host?.bridgePort&&br?.dshReady?'已连接':'连接待检查'),h('button',{style:S.btn,onClick:()=>{loadPanel();loadSide();setTreeRefresh(n=>n+1);},disabled:busy},busy?'刷新中…':'刷新数据'))),



        err||panel?.error?h('div',{role:'alert',className:'qq-alert'},err||panel.error):null,



        msg?h('div',{role:'status',className:'qq-toast'},msg):null,



        h('div',{className:'qq-stats',hidden:section!=='more'},



          h('button',{className:'qq-stat qq-stat-mint',onClick:()=>openMemory()},h('span',{className:'qq-stat-label'},'长期记忆'),h('strong',null,memorySummary?.totals?.current??'—'),h('span',null,'在共同经历中逐渐积累'),h('b',null,'↗')),



          h('button',{className:'qq-stat qq-stat-amber',onClick:()=>openMemory(true)},h('span',{className:'qq-stat-label'},'等待核实'),h('strong',null,pending??'—'),h('span',null,'全部会话 · 按会话审核'),h('b',null,'↗')),



          h('button',{className:'qq-stat qq-stat-blue',onClick:()=>setSection('settings')},h('span',{className:'qq-stat-label'},'会话'),h('strong',null,convs.length),h('span',null,'分别管理参与频率与范围'),h('b',null,'↗')),



          h('button',{className:'qq-stat qq-stat-purple',onClick:()=>setSection('more')},h('span',{className:'qq-stat-label'},'累计用量费用'),h('strong',null,us&&!us.__error?money(us.cost):'—'),h('span',null,us&&!us.__error?`${us.turns||0} 个回合 · 查看明细`:'等待用量数据'),h('b',null,'↗'))),



        h('nav',{'aria-label':'工作台分区',className:'qq-main-nav'},nav.map(([key,label,hint])=>h('button',{key,type:'button','aria-current':section===key?'page':undefined,onClick:()=>setSection(key)},h('strong',null,label),h('span',null,hint)))),



        section!=='memory'?h('div',{className:'qq-section-title'},h('h3',null,nav.find(v=>v[0]===section)[1]),h('span',null,nav.find(v=>v[0]===section)[2])):null,



section==='learning'?h(LearningWorkspace,{conversations:convs,ownerQQ:br?.ownerQQ}):null,



section==='abilities'?h(AbilitiesPanel,{conversations:convs}):null,



h('div',{hidden:section!=='voicecall',style:{display:section==='voicecall'?'block':'none'}},h(VoiceCallPanel,null)),



section==='overview'?h('section',{className:'qq-section','aria-label':'项目总览',style:{...S.card,padding:20}},
  h('h3',null,'小鲸鲸项目'),h('p',{style:{opacity:.68,margin:'7px 0 18px'}},'在这里查看和管理聊天、记忆、学习、通话与一起游玩的能力。'),
  h('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12}},
    [['minecraft','Minecraft','游戏连接、目标、装备与自主游玩'],['memory','记忆树','长期记忆、待核实和会话回忆'],['learning','学习与表达','自主学习、语料与表达习惯'],['voicecall','语音通话','通话服务与设备'],['settings','聊天设置','人格、角色与会话参与'],['abilities','成长与能力','生活痕迹、能力与成长'],['memewiki','梗百科','词条、语境与黑话'],['more','服务与用量','账号连接、用量与其他工具']].map(([key,title,description])=>h('button',{key,type:'button',onClick:()=>setSection(key),style:{...S.card,textAlign:'left',cursor:'pointer',padding:16,color:'inherit'}},h('strong',{style:{display:'block',fontSize:15}},title),h('span',{style:{display:'block',opacity:.66,marginTop:6}},description)))),
  h('p',{style:{marginTop:16,opacity:.65}},host?.bridgePort&&br?.dshReady?'聊天桥与 DSH 已连接。':'聊天连接状态待检查；各页面会分别显示实际状态。')):null,

section==='minecraft'?h(MinecraftProjectPanel,null):null,

section==='memewiki'?h(MemeWikiPanel,null):null,



        h('details',{hidden:section!=='more',className:'qq-section qq-section-overview'},h('summary',null,'账号与服务状态'),



h('section',{className:'qq-status-card',style:S.card},h('h3',null,'运行状态'),



          h('div',{className:'qq-status-grid'},



            h('div',null,h('span',null,'当前账号'),h('strong',null,host?.account?host.account.nick:'尚未连接'),h('small',null,host?.account?'QQ '+host.account.qq:'检查网关连接')),



            h('div',null,h('span',null,'当前角色'),h('strong',null,br?.role||'默认角色'),h('small',null,br?.socialV2Paused?'已暂停交流':'正常交流中')),



            h('div',null,h('span',null,'交流模式'),h('strong',null,({reserved2:'自主交流',reserved:'仿真交流',chat:'安全聊天','closed-agent':'管理员助手'}[br?.mode]||br?.mode||'等待连接')),h('small',null,'参与频率按会话分别设置')),



            h('div',null,h('span',null,'服务连接'),h('strong',null,br?.dshReady&&host?.bridgePort?'运行正常':'等待就绪'),h('small',null,host?.snowPort?'QQ 网关已连接':'QQ 网关待连接')))),



        ),



h('div',{hidden:section!=='memory',className:'qq-section qq-section-memory'},



// 记忆详情 + 批量审核（原有的 MemoryManager，保留）



        h('div', { ref: memoryRef }, h(MemoryGarden, { conversations: convs,reviewRequest,onSummary:setMemorySummary,botName:br?.role||'聊天伙伴',refreshRequest:treeRefresh }))),



h('details',{hidden:section!=='settings',className:'qq-section qq-section-persona'},h('summary',null,'角色与表达'),



// ══ 总提示词（我的提示词.md）══



        // 直接在面板里改，不用再去翻文件。桥每轮现读 ⇒ 保存后**下一轮就生效，不用重启桥**。



        // 写回的是 raw 原文（注释一并保留）；保存前桥会自动备份旧版本（最多留 5 份）。



        h('div', { style: S.card },



          h('div', { style: S.head },



            h('span', { style: S.title }, '总提示词'),



            h('span', { style: Object.assign({}, S.tiny, S.dim) },



              cp ? (cp.file + ' · 注入 ' + cp.chars + ' 字 / 原文 ' + cp.rawChars + ' 字') : '读取中…'),



            cp && cpDraft !== String(cp.raw || '')



              ? h('span', { style: Object.assign({}, S.pill, { color: '#d29922' }) }, '未保存')



              : null,



            h('span', { style: { marginLeft: 'auto' } }),



            h('span', {



              style: Object.assign({}, S.tiny, { opacity: 0.85, cursor: 'pointer' }),



              onClick: () => { loadCustomPrompt(); flash('已重新读取'); },



            }, '重新读取 ↻'),



          ),



          cp



            ? h('textarea', {



                value: cpDraft,



                onChange: (e) => {cpDraftRef.current=e.target.value;setCpDraft(e.target.value);},



                spellCheck: false,



                style: { width: '100%', minHeight: 260, maxHeight: 420, padding: '9px 11px', borderRadius: 7, border: '1px solid rgba(128,128,128,.3)', background: 'rgba(128,128,128,.06)', color: 'inherit', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' },



              })



            : h('div', { style: S.dim }, '读取中…'),



          h('div', { style: S.row },



            h('button', {



              style: S.btn,



              disabled: !cp || cpSaving || cpDraft === String((cp && cp.raw) || ''),



              onClick: saveCustomPrompt,



            }, cpSaving ? '保存中…' : '保存'),



            h('span', { style: Object.assign({}, S.tiny, S.dim) }, '保存后下一轮生效，不用重启桥 · 旧版自动备份'),



          ),



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



                h('span', { style: S.pill }, '已确认 ' + ((slang.entries || []).filter(e=>e.status==='confirmed').length)),



                h('span', { style: S.pill }, '候选 ' + ((slang.entries || []).filter(e=>e.status==='candidate').length)),



                h('span', { style: S.pill }, '已拒 ' + ((slang.entries || []).filter(e=>e.status==='rejected').length)),



                h('span', { style: Object.assign({}, S.tiny, S.dim) }, '待审核联网解释只供理解；确认后才可主动使用。来源由模型提供，需人工核实。'),



              )



            : h('div', { style: S.dim }, '黑话读取中…'),



          slang ? h('div', null,



            h('div',{style:S.row},



              h('button',{style:S.btnSm,disabled:saving==='slang',onClick:()=>setSlangSelected(slangCurrent.filter(e=>e.status==='candidate').map(e=>e.id))},'全选本页候选'),



              h('button',{style:S.btnSm,disabled:saving==='slang'||!slangSelected.length,onClick:()=>slangReview('confirm')},'批量确认可使用'),



              h('button',{style:S.btnSm,disabled:saving==='slang'||!slangSelected.length,onClick:()=>slangReview('reject')},'批量拒绝')),



            h('div',{style:S.row},h('input',{value:slangScope,onChange:e=>setSlangScope(e.target.value),placeholder:'group:群号 或 internet',style:S.input}),h('button',{style:S.btnSm,disabled:saving==='slang'||!slangSelected.length,onClick:assignSlangScope},'归类选中词条')),



            h('div',{style:S.row},h('select',{'aria-label':'热梗使用权限',value:slangPolicy,onChange:e=>setSlangPolicy(e.target.value)},h('option',{value:'understand'},'只理解'),h('option',{value:'self'},'仅描述自己时使用'),h('option',{value:'natural'},'合适语境可主动使用')),h('button',{style:S.btnSm,disabled:saving==='slang'||!slangSelected.length,onClick:setSlangUse},'设置使用权限')),



            h('div',{style:S.row},h('button',{style:S.btnSm,disabled:slangPage<=0,onClick:()=>{setSlangSelected([]);setSlangPage(p=>p-1);}},'上一页'),h('span',{style:S.tiny},'第 '+(Math.min(slangPage,slangPageCount-1)+1)+' / '+slangPageCount+' 页'),h('button',{style:S.btnSm,disabled:slangPage>=slangPageCount-1,onClick:()=>{setSlangSelected([]);setSlangPage(p=>p+1);}},'下一页')),



            slangCurrent.map(e=>h('div',{key:e.id,style:{padding:'8px 0',borderTop:'1px solid rgba(128,128,128,.2)'}},



              h('label',null,h('input',{type:'checkbox',checked:slangSelected.includes(e.id),onChange:()=>setSlangSelected(v=>v.includes(e.id)?v.filter(id=>id!==e.id):v.concat(e.id))}), ' ', h('strong',null,e.content),' · ', e.scope==='internet'?'公开网络':e.scope==='legacy_global'||!e.scope?'旧词待归类':shortKey(e.scope)),



              h('div',{style:S.tiny}, (e.status==='confirmed'?'已确认':e.status==='rejected'?'已拒绝':'待审核')+' · '+({understand:'只理解',self:'仅描述自己时使用',natural:'可主动使用'}[e.status==='confirmed'?(e.usagePolicy||'natural'):'understand'])+' · '+(e.meaning || '尚无解释')),



              (e.sources||[]).length?h('div',{style:S.tiny},'来源线索（未核实）：'+e.sources.join('，')):null))



          ):null,



        )),



h('details',{hidden:section!=='settings',className:'qq-section qq-section-channels'},h('summary',null,'参与方式与聊天范围'),



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



                      onKeyUp:(e)=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))saveLevel(c,Number(e.target.value));},



                      onMouseUp: (e) => saveLevel(c, Number(e.target.value)),



                      onTouchEnd: (e) => saveLevel(c, Number(e.target.value)),



                      disabled: saving === c.key,



                    }),



                  );



                }),



              ),



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



// ══ 攻击形态（按人切换，2026-10-27 加）══



        h('div', { style: S.card },



          h('div', { style: S.head },



            h('span', { style: S.title }, '攻击形态'),



            h('span', { style: Object.assign({}, S.pill, am && am.active && am.active.length ? { color: '#d29922' } : {}) },



              am ? (am.active && am.active.length ? '目标 ' + am.active.length + ' 个' : '待命') : '读取中…'),



            h('span', { style: { marginLeft: 'auto' } }),



            h('span', {



              style: Object.assign({}, S.tiny, { opacity: 0.85, cursor: 'pointer' }),



              onClick: () => { loadAttackMode(); flash('已刷新'); },



            }, '刷新 ↻'),



          ),



          h('div', { style: S.row },



            h('button', {



              style: S.btn,



              onClick: () => saveAttack({ enabled: !(am && am.config && am.config.enabled) }),



            }, am && am.config && am.config.enabled ? '攻击形态：已开启（点此关闭）' : '攻击形态：已关闭（点此开启）'),



            h('span', { style: S.tiny }, '持续'),



            h('input', {



              type: 'number', min: 1, max: 240, value: amDur,



              onChange: (e) => setAmDur(Number(e.target.value) || 15),



              style: { width: 64, padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit', font: 'inherit' },



            }),



            h('span', { style: S.tiny }, '分钟'),



            h('button', { style: S.btn, onClick: () => saveAttack({ durationMinutes: amDur }) }, '保存'),



            h('span', { style: { width: 10 } }),



            h('button', { style: S.btn, onClick: clearAttack }, '清空目标'),



          ),



          h('div', { style: S.dim },



            am && am.active && am.active.length



              ? am.active.map((t) => h('div', { key: t.key },



                  shortKey(t.key) + ' · QQ ' + t.qq + (t.name ? '（' + t.name + '）' : '') + ' · 剩 ' + Math.round((Number(t.leftSeconds) || 0) / 60) + ' 分钟'))



              : '群里有人骂机器人时，只对这个人切「贴吧鱼」人格；其他群友保持原人格，管理员永不触发。',



          ),



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



        )),



h('details',{hidden:section!=='more',className:'qq-section qq-section-usage'},h('summary',null,'用量与上下文检查'),



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



// ══ 提示词注入（2026-10-21 加）══



        // 显示机器人这一轮**实际收到**的全文。桥侧在真正发送前抓的快照，



        // 不是 /api/debug/prompt 那个只拼半段的残缺预览；会话令牌已遮。



        h('div', { style: S.card },



          h('div', { style: S.head },



            h('span', { style: S.title }, '提示词注入'),



            h('span', { style: Object.assign({}, S.tiny, S.dim) }, '这一轮实际收到的全文'),



            h('span', { style: { marginLeft: 'auto' } }),



            h('span', {



              style: Object.assign({}, S.tiny, { opacity: promptBusy ? 0.45 : 0.85, cursor: 'pointer' }),



              onClick: () => loadPrompt(promptKey),



            }, promptBusy ? '拉取中…' : '刷新 ↻'),



          ),



          h('div', { style: S.row },



            h('select', {



              value: promptKey,



              onChange: (e) => { setPromptKey(e.target.value); setPromptData(null); },



              style: { padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', fontSize: 12, fontFamily: 'inherit', minWidth: 190 },



            },



              h('option', { value: '' }, convs.length ? '— 选一个会话 —' : '没有会话'),



              convs.map((c) => h('option', { key: c.key, value: c.key }, shortKey(c.key))),



            ),



            h('button', {



              style: S.btn,



              disabled: !promptKey || promptBusy,



              onClick: () => loadPrompt(promptKey),



            }, '拉取'),



            promptData && promptData.ok



              ? h('span', { style: Object.assign({}, S.pill, promptData.source === 'actual' ? {} : { color: '#d29922' }) },



                  promptData.source === 'actual'



                    ? '实际注入 · ' + (promptData.reason || '—')



                    : '预览（该会话还没被真实唤醒过）')



              : null,



            promptData && promptData.ok && promptData.at



              ? h('span', { style: Object.assign({}, S.tiny, S.dim) }, new Date(promptData.at).toLocaleTimeString())



              : null,



            promptData && promptData.ok



              ? h('span', { style: Object.assign({}, S.tiny, S.dim) }, promptData.length + ' 字')



              : null,



            promptData && promptData.ok



              ? h('button', {



                  style: S.btnSm,



                  onClick: () => {



                    try {



                      navigator.clipboard.writeText(promptData.text).then(() => flash('已复制')).catch(() => flash('复制失败'));



                    } catch (e) { flash('复制失败'); }



                  },



                }, '复制')



              : null,



          ),



          promptData && promptData.ok === false ? h('div', { style: S.err }, promptData.error || '读取失败') : null,



          promptData && promptData.ok



            ? h('pre', {



                style: { margin: 0, maxHeight: 380, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, lineHeight: 1.6, background: 'rgba(128,128,128,.08)', border: '1px solid rgba(128,128,128,.22)', borderRadius: 7, padding: '9px 11px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },



              }, promptData.text)



            : h('div', { style: Object.assign({}, S.tiny, S.dim) },



                '选会话 → 拉取，就能看到机器人这一轮收到的完整提示词（人格 + 记忆 + 表情策略 + 唤醒原因…）。令牌已自动遮掉。'),



        )),



h('details',{hidden:section!=='more',className:'qq-section qq-section-overview'},h('summary',null,'首次配置与活动记录'),



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



          : null),



        h('details',{className:'qq-build-info'},h('summary',null,'版本与连接信息'),h('div',null,'界面 '+UI_VERSION+' · 主机 '+(panel?.packageVersion||'读取中')+' · 仪表盘设计 1.0'),h('div',null,'所有数据通过 DSH 插件同源代理读取。'))



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
