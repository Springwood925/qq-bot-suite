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
    // 原生嵌入 qq-bot-suite 详情页；所有管理请求经同源 host，前端不持桥令牌。
    function MemoryManager({conversations=[]}) {
      const [overview,setOverview]=useState(null),[scope,setScope]=useState(''),[tab,setTab]=useState('tree');
      const [kind,setKind]=useState(''),[status,setStatus]=useState(''),[person,setPerson]=useState('');
      const [q,setQ]=useState(''),[searchQ,setSearchQ]=useState(''),[includePending,setIncludePending]=useState(true);
      const [result,setResult]=useState(null),[detail,setDetail]=useState(null),[draft,setDraft]=useState({});
      const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
      const [page,setPage]=useState(0),[reload,setReload]=useState(0),[forgetConfirm,setForgetConfirm]=useState(false);
      const [target,setTarget]=useState(''),[relation,setRelation]=useState('related'),[diagnostic,setDiagnostic]=useState(null);
      const requestSeq=React.useRef(0),detailSeq=React.useRef(0);
      const K={fact:'人物与偏好',event:'事件',agreement:'约定',thought:'临时想法',experience:'实际经历',observation:'图片观察',goal:'自己的目标',style:'表达习惯',knowledge:'知识与方法'};
      const ST={active:'有效',done:'已完成',archived:'已归档',unverified:'待核实',superseded:'已被更正',forgotten:'已遗忘'};
      const EV={statement:'本人陈述',reported:'他人转述',inference:'推断',joke:'玩笑',legacy:'无来源旧记忆',admin:'管理员审阅',visual:'实际视觉分析',tool:'真实工具结果',state:'目标状态记录'};
      const RT={related:'相关',follows:'后续',contradicts:'冲突',goal:'目标关联',supports:'依赖来源'};
      const css={input:{...S.btn,padding:'6px 8px',boxSizing:'border-box',minWidth:0},textarea:{...S.btn,width:'100%',padding:8,minHeight:100,boxSizing:'border-box',resize:'vertical',lineHeight:1.6},label:{display:'flex',flexDirection:'column',gap:4,fontSize:12},small:{...S.tiny,...S.dim},group:{display:'flex',flexDirection:'column',gap:8}};
      const date=value=>value?new Date(value).toLocaleString():'无记录';
      const call=(action,data={})=>apiPost('/api/socialV2/memory-admin',{action,key:scope,...data}).then(value=>{if(value?.ok===false)throw new Error(value.error||'记忆操作失败');return value;});
      const refreshOverview=()=>call('overview').then(setOverview).catch(e=>setError(e.message));
      useEffect(()=>{refreshOverview();const timer=setInterval(refreshOverview,30000);return()=>clearInterval(timer);},[]);
      const scopes=useMemo(()=>[...new Set([...(overview?.scopes||[]).map(s=>s.scope),...conversations.map(c=>c.key)])],[overview,conversations]);
      useEffect(()=>{if(!scope&&scopes.length)setScope(scopes[0]);},[scopes,scope]);
      useEffect(()=>{
        const seq=++requestSeq.current;if(!scope)return;
        setError('');setBusy(true);
        const selectedKind=tab==='style'?'style':tab==='self'?(kind||'experience'):kind;
        call(searchQ?'search':'list',{q:searchQ,kind:selectedKind||undefined,status:status||undefined,person:person||undefined,includeUnverified:includePending,limit:20,offset:page*20})
          .then(value=>{if(seq===requestSeq.current)setResult(value);})
          .catch(e=>{if(seq===requestSeq.current)setError(e.message);})
          .finally(()=>{if(seq===requestSeq.current)setBusy(false);});
      },[scope,tab,kind,status,person,searchQ,includePending,page,reload]);
      useEffect(()=>{setDetail(null);setForgetConfirm(false);detailSeq.current++;},[scope,tab,kind,status,person,searchQ,page]);
      const chooseScope=value=>{setScope(value);setQ('');setSearchQ('');setPage(0);setPerson('');setDiagnostic(null);setNotice('');};
      const open=async id=>{
        const seq=++detailSeq.current;setBusy(true);setError('');setForgetConfirm(false);
        try{const value=await call('read',{id});if(seq!==detailSeq.current)return;setDetail(value);const r=value.record;setDraft(r?{content:r.content,nextStep:r.nextStep||'',subjectUserId:r.subjectUserId||'',tags:(r.tags||[]).join('，'),confirmed:r.verified===true,reason:''}:{});}
        catch(e){if(seq===detailSeq.current)setError(e.message);}finally{if(seq===detailSeq.current)setBusy(false);}
      };
      const mutate=async(action,data={})=>{
        if(busy)return;setBusy(true);setError('');setNotice('');
        try{const value=await call(action,{id:detail?.record?.id,...data});setNotice(action==='forget'?'已遗忘：版本和依赖摘要已撤下':'已保存');setForgetConfirm(false);setReload(n=>n+1);await refreshOverview();if(value.record){const full=await call('read',{id:value.record.id});setDetail(full);setDraft({...draft,content:value.record.content,confirmed:value.record.verified===true});}else setDetail(null);}
        catch(e){setError(e.message);}finally{setBusy(false);}
      };
      const runSearch=()=>{if(busy)return;setPage(0);setSearchQ(q.trim());setReload(n=>n+1);};
      const runDiagnostic=async(action,body={})=>{if(busy)return;setBusy(true);setError('');try{setDiagnostic(await call(action,body));await refreshOverview();}catch(e){setError(e.message);}finally{setBusy(false);}};
      const record=detail?.record;
      const records=result?.records||[];
      const immutable=record&&['superseded','forgotten'].includes(record.status);
      const systemGoal=record?.kind==='goal';
      const groups=Object.keys(K).map(type=>({type,items:records.filter(r=>r.kind===type)})).filter(g=>g.items.length);
      const setField=(field,value)=>setDraft(current=>({...current,[field]:value}));
      const select=(label,value,onChange,options)=>h('label',{style:css.label},label,h('select',{'aria-label':label,value,disabled:busy,onChange:e=>onChange(e.target.value),style:css.input},options.map(([value,label])=>h('option',{key:value,value},label))));
      const actionButton=(label,onClick,disabled=false,extra={})=>h('button',{type:'button',style:S.btn,onClick,disabled:busy||disabled,...extra},label);
      return h('section',{'aria-label':'记忆树管理',style:{...S.card,padding:14,gap:12}},
        h('div',{style:S.head},h('strong',{style:{fontSize:15}},'记忆树'),h('span',{style:S.pill},'本地存储'),overview?h('span',{style:S.dim},`${overview.totals.current ?? (overview.totals.records-overview.totals.forgotten)} 条 · ${overview.totals.pending} 条待核实`):null,h('span',{style:{marginLeft:'auto'}}),actionButton('刷新',()=>{refreshOverview();setReload(n=>n+1);})),
        h('div',{style:css.small},'在这里核对它记住了什么、从哪里得知，以及怎样被纠正。不同群与私聊各自保存。'),
        h('div',{style:{...S.row,alignItems:'end'}},
          select('会话',scope,chooseScope,[['','选择会话'],...scopes.map(key=>{const count=overview?.scopes.find(s=>s.scope===key);return [key,shortKey(key)+(count?` · ${count.records} 条`:'')];})]),
          h('label',{style:{...css.label,flex:1,minWidth:180}},'回忆线索',h('input',{'aria-label':'回忆线索',style:{...css.input,width:'100%'},placeholder:'如：玩一会儿就退回桌面',value:q,onChange:e=>setQ(e.target.value),onKeyDown:e=>{if(e.key==='Enter')runSearch();}})),
          actionButton('搜索',runSearch,!scope),searchQ?actionButton('清除搜索',()=>{setQ('');setSearchQ('');setPage(0);}):null),
        h('div',{role:'tablist','aria-label':'记忆分类',style:S.row},[['tree','记忆树'],['self','自己的经历'],['style','表达习惯'],['diagnostics','检索诊断']].map(([value,label])=>h('button',{key:value,type:'button',role:'tab','aria-selected':tab===value,disabled:busy,style:{...S.btn,background:tab===value?'rgba(85,150,240,.16)':'transparent',borderColor:tab===value?'#6ca9ef':'rgba(128,128,128,.4)'},onClick:()=>{setTab(value);setKind('');setStatus('');setPerson('');setPage(0);setQ('');setSearchQ('');setDiagnostic(null);}},label))),
        error?h('div',{role:'alert',style:S.err},error):null,notice?h('div',{role:'status',style:S.ok},notice):null,
        tab==='diagnostics'?h('div',{style:css.group},
          h('div',{style:S.row},h('span',{style:S.pill},overview?.semantic?.state==='ready'?'语义模型就绪':'语义模型：'+(overview?.semantic?.state||'读取中')),h('span',{style:S.dim},`${overview?.semantic?.indexed||0} 条向量 · ${overview?.semantic?.indexing?'正在更新索引':'索引待命'}`)),
          h('div',{style:css.small},'中文嵌入在本机 CPU 运行。只搜索选定会话；模型不可用时保留关键词搜索，不切换收费 API。'),
          overview?.semantic?.error?h('div',{style:S.err},overview.semantic.error):null,
          h('div',{style:S.row},actionButton('更新当前会话索引',()=>runDiagnostic('reindex'),!scope),actionButton('查看检索用量',()=>runDiagnostic('metrics'),!scope),actionButton('运行回忆样例',()=>runDiagnostic('evaluate'),!scope)),
          h('div',{style:css.group},h('strong',null,'功能开关'),Object.entries({semantic:'本地语义检索',autoInject:'自动注入相关记忆',styleLearning:'提出表达习惯候选',imageMemory:'保留实际图片观察',experienceMemory:'保留真实工具经历'}).map(([key,label])=>h('label',{key,style:S.label},h('input',{type:'checkbox',checked:overview?.settings?.[key]!==false,disabled:busy,onChange:e=>mutate('settings',{settings:{[key]:e.target.checked}})}),label))),
          diagnostic?h('div',{style:css.group},diagnostic.hitAt5!==undefined?h('div',null,diagnostic.hitAt5===null?'尚无回忆样例。先选中一条记忆，用一种新的问法保存样例。':`前5条命中率：${Math.round(diagnostic.hitAt5*100)}%（仅当前 ${diagnostic.cases.length} 个样例）`):null,
            h('pre',{style:{...S.mono,whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:300,overflow:'auto',fontSize:11}},JSON.stringify(diagnostic,null,2))):null,
        ):h(React.Fragment,null,
          tab==='style'?h('div',{style:css.small},'候选需要多条真实交流作依据。确认后只作本会话的表达参考，不复制真人口头禅，也不替代人格。'):null,
          tab==='self'?h('div',{style:css.small},'这些记录来自真实工具返回、已完成的图片观察与目标状态；目标完成标记不等于外部任务已成功。'):null,
          h('div',{style:{...S.row,alignItems:'end'}},
            tab!=='style'?select('类型',kind,value=>{setKind(value);setPage(0);},tab==='self'?[['','实际经历'],['observation','图片观察'],['goal','自己的目标']]:[['','全部类型'],...Object.entries(K)]):null,
            select('状态',status,value=>{setStatus(value);setPage(0);},[['','当前版本'],['unverified','待核实'],['active','有效'],['done','已完成'],['archived','已归档'],['superseded','历史版本']]),
            tab==='tree'?select('人物',person,value=>{setPerson(value);setPage(0);},[['','所有人物'],['self','小鲸鱼自己'],...(result?.people||[]).map(p=>[p.id,p.aliases.at(-1)+' ('+p.id+')'])]):null,
            h('label',{style:S.label},h('input',{type:'checkbox',checked:includePending,onChange:e=>setIncludePending(e.target.checked)}),'搜索包含待核实记录'),
            h('span',{style:css.small},busy?'读取中…':searchQ?`混合召回 ${records.length} 条`:`${result?.total||0} 条`)),
          h('div',{style:{display:'flex',flexWrap:'wrap',gap:12,alignItems:'flex-start'}},
            h('div',{style:{flex:'1 1 270px',minWidth:0,...css.group}},
              !records.length?h('div',{style:{...S.dim,padding:'18px 4px'}},busy?'正在读取…':'当前筛选下没有记录。旧便签可勾选待核实后搜索。'):null,
              groups.map(group=>h('details',{key:group.type,open:true,style:{border:'1px solid rgba(128,128,128,.2)',borderRadius:8,padding:'6px 8px'}},
                h('summary',{style:{cursor:'pointer',fontWeight:600,padding:'3px 0'}},K[group.type]+' · '+group.items.length),
                group.items.map(item=>h('button',{type:'button',key:item.id,disabled:busy,'aria-label':'查看记忆 '+item.content,style:{...S.btn,display:'block',textAlign:'left',width:'100%',marginTop:6,padding:9,background:record?.id===item.id?'rgba(85,150,240,.12)':'transparent'},onClick:()=>open(item.id)},
                  h('div',{style:{display:'flex',gap:5,flexWrap:'wrap',marginBottom:4}},h('span',{style:{...S.pill,color:item.status==='unverified'?'#d9a441':undefined}},ST[item.status]||item.status),h('span',{style:css.small},EV[item.evidence]||item.evidence),item.subjectUserId?h('span',{style:css.small},item.subjectUserId==='self'?'小鲸鱼自己':item.subjectUserId):null),
                  h('div',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',lineHeight:1.6}},item.content),
                  h('div',{style:{...css.small,marginTop:3}},date(item.occurredAt),item.retrieval?.semantic?` · 语义 ${item.retrieval.semantic.toFixed(2)}`:''))))),
              !searchQ&&result?.total>20?h('div',{style:S.row},actionButton('上一页',()=>setPage(p=>Math.max(0,p-1)),page===0),h('span',{style:css.small},`第 ${page+1} 页`),actionButton('下一页',()=>setPage(p=>p+1),(page+1)*20>=result.total)):null),
            record?h('aside',{'aria-label':'记忆详情',style:{...S.card,flex:'1 1 340px',minWidth:0,maxWidth:'100%',background:'rgba(128,128,128,.035)'}},
              h('div',{style:S.head},h('strong',null,'记忆详情'),h('span',{style:S.pill},K[record.kind]),h('span',{style:S.pill},ST[record.status])),
              h('div',{style:{...S.mono,...S.dim,overflowWrap:'anywhere',fontSize:10}},record.id),
              h('div',{style:css.small},`事项：${record.factKey} · ${date(record.occurredAt)}`),
              h('label',{style:css.label},'内容',h('textarea',{'aria-label':'记忆内容',style:css.textarea,value:draft.content||'',disabled:immutable||systemGoal,onChange:e=>setField('content',e.target.value)})),
              h('label',{style:css.label},'主体 QQ / self',h('input',{'aria-label':'主体 QQ',style:css.input,value:draft.subjectUserId||'',disabled:immutable||systemGoal,onChange:e=>setField('subjectUserId',e.target.value)})),
              h('label',{style:css.label},'下一步（已完成事项可留空）',h('input',{'aria-label':'下一步',style:css.input,value:draft.nextStep||'',disabled:immutable,onChange:e=>setField('nextStep',e.target.value)})),
              h('label',{style:css.label},'关键词',h('input',{'aria-label':'关键词',style:css.input,value:draft.tags||'',disabled:immutable||systemGoal,onChange:e=>setField('tags',e.target.value)})),
              h('label',{style:S.label},h('input',{'aria-label':'我已核实',type:'checkbox',checked:!!draft.confirmed,disabled:immutable||systemGoal,onChange:e=>setField('confirmed',e.target.checked)}),'我已核实此内容'),
              h('label',{style:css.label},'纠正原因',h('input',{'aria-label':'纠正原因',style:css.input,value:draft.reason||'',disabled:immutable,onChange:e=>setField('reason',e.target.value)})),
              h('div',{style:S.row},actionButton('保存纠正',()=>mutate('revise',{patch:{...draft,tags:(draft.tags||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean)}}),immutable||systemGoal||!draft.content?.trim()),actionButton('确认这条记忆',()=>mutate('confirm',{patch:{content:draft.content,subjectUserId:draft.subjectUserId},reason:draft.reason}),immutable||systemGoal),systemGoal?actionButton('更新下一步',()=>mutate('goal',{goalAction:'progress',nextStep:draft.nextStep}),immutable||!draft.nextStep?.trim()):null,actionButton('标记完成',()=>mutate(systemGoal?'goal':'done',systemGoal?{goalAction:'complete'}:{}),immutable),actionButton(record.kind==='style'?'拒绝/归档':'归档',()=>mutate(systemGoal?'goal':'archive',systemGoal?{goalAction:'abandon'}:{}),immutable)),
              h('details',{open:true},h('summary',{style:{cursor:'pointer',fontWeight:600}},'来源与不确定性'),
                h('div',{style:{...css.group,marginTop:6}},h('div',{style:css.small},EV[record.evidence]||record.evidence),
                  record.source?h('div',{style:{...S.mono,overflowWrap:'anywhere',fontSize:11}},`发送者：${record.source.userId} · 引用：${record.source.messageRef}`):h('div',{style:css.small},'没有可核对的原始来源；确认前请自行核实。'),
                  record.source?.excerpt?h('blockquote',{style:{margin:0,padding:'6px 10px',borderLeft:'2px solid #7a93ae',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},record.source.excerpt,record.source.excerptMayBeTruncated?h('div',{style:css.small},'摘录可能截断，可按消息引用回查原始聊天。'):null):null,
                  record.uncertain?.length?h('div',{style:{color:'#d9a441'}},'未确认：'+record.uncertain.join('；')):null,
                  record.metadata?.visibleText?.length?h('div',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},'图中文字：'+record.metadata.visibleText.join('；')):null,
                  record.metadata?.sampleSources?.map(source=>h('div',{key:source.id,style:css.small},`${source.userId} · ${source.messageRef}：${source.excerpt}`)),
                  record.metadata?.meaning?h('div',{style:css.small},record.metadata.meaning):null)),
              h('details',null,h('summary',{style:{cursor:'pointer',fontWeight:600}},'版本记录 · '+(detail.versions?.length||1)),h('div',{style:css.group},(detail.versions||[]).map(version=>h('div',{key:version.id,style:{padding:'6px 0',borderBottom:'1px solid rgba(128,128,128,.18)'}},h('div',{style:css.small},ST[version.status]+' · '+date(version.occurredAt)),h('div',{style:{overflowWrap:'anywhere'}},version.content))))),
              h('details',{open:true},h('summary',{style:{cursor:'pointer',fontWeight:600}},'关联与前因后果'),
                h('div',{style:{...css.group,marginTop:6}},(record.relations||[]).map(link=>h('div',{key:link.id,style:S.row},actionButton(RT[link.type]+' · '+link.id.slice(0,8),()=>open(link.id)),actionButton('解除',()=>mutate('unlink',{fromId:record.id,toId:link.id}),immutable))),
                  (detail.incoming||[]).map(link=>h('div',{key:link.record.id,style:S.row},actionButton('被关联：'+RT[link.type]+' · '+link.record.content.slice(0,35),()=>open(link.record.id)))),
                  h('input',{'aria-label':'关联记忆 ID',placeholder:'要关联的当前记忆 ID',style:css.input,value:target,onChange:e=>setTarget(e.target.value)}),
                  select('关系',relation,setRelation,Object.entries(RT)),actionButton('添加关联',()=>mutate('link',{fromId:record.id,toId:target,relation}),immutable||!target.trim()),h('div',{style:css.small},'“依赖来源”表示此内容是目标记录的派生摘要；目标被纠正或遗忘时，摘要一起撤下。'))),
              h('details',null,h('summary',{style:{cursor:'pointer',fontWeight:600}},'保存为回忆检验样例'),h('div',{style:css.group},h('div',{style:css.small},'用上方“回忆线索”输入一种新的问法，以这条记忆作期望答案。'),actionButton('保存当前问法与这条记忆',()=>mutate('case',{q:q.trim(),expectedIds:[record.id]}),!q.trim()))),
              h('div',{style:{borderTop:'1px solid rgba(128,128,128,.25)',paddingTop:10}},forgetConfirm?h('div',{role:'alert',style:css.group},h('div',null,'将遗忘这条记忆、历史版本和依赖摘要，并阻止从相同来源自动重建。QQ 原始聊天和备份另行管理。'),h('div',{style:S.row},actionButton('确认遗忘',()=>mutate('forget'),false,{style:{...S.btn,color:'#e46f69'}}),actionButton('取消',()=>setForgetConfirm(false)))):actionButton('遗忘这条记忆',()=>setForgetConfirm(true),immutable,{style:{...S.btn,color:'#e46f69'}}))
            ):h('div',{style:{...S.dim,flex:'1 1 300px',padding:'20px 6px'}},'选择一条记忆，展开来源、版本和关联。'))
        )
      );
    }




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
      // ── 提示词注入（2026-10-21 加）──────────────────────────────────────
      const [promptKey, setPromptKey] = useState('');
      const [promptData, setPromptData] = useState(null);
      const [promptBusy, setPromptBusy] = useState(false);
      // ── 总提示词（我的提示词.md）直接编辑（2026-10-21 加）────────────────
      const [cp, setCp] = useState(null);          // 服务端最新读到的一份
      const [cpDraft, setCpDraft] = useState('');  // 编辑中的文本（原文，含注释）
      const [cpSaving, setCpSaving] = useState(false);

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
          .then((d) => { setCp(d); setCpDraft(String((d && d.raw) || '')); })
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

      const loadSide = useCallback(() => {
        apiGet('/api/slang').then((d) => setSlang(d)).catch(() => {});
        apiGet('/api/whitelist').then((d) => setWl(d)).catch(() => {});
        loadCustomPrompt();
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

        h(MemoryManager,{conversations:convs}),

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
                onChange: (e) => setCpDraft(e.target.value),
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
