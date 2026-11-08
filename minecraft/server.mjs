// mc-bot 的本地 HTTP 接口：给桥 / DSH 调用
// 监听 127.0.0.1:63200，只有本机能访问
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const BRIDGE_DIR=path.resolve(process.env.QQ_BRIDGE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)),'..','bridge'));
import { Vec3 } from 'vec3';
import { surfaceMap, heightMap, scanArea, formatMap } from './mapmod.mjs';
import { buildBox, runSequence } from './buildseq.mjs';
import { createChestOperations } from './chest-operations.mjs';
import { createStationOperations } from './station-operations.mjs';
import { createFishOperations } from './fish-operations.mjs';
import { inspectHouse,planHouse } from './house-check.mjs';
import { placeAtTarget } from './place-target.mjs';
import { sleepOnBed,wakeFromBed } from './sleep-operations.mjs';
import { createForgeItemLookup } from './forge-item-lookup.mjs';
import { createFoodOperations } from './food-operations.mjs';
import { diagnoseRoute,previewBetween } from './route-diagnostics.mjs';
import { inspectVolume } from './inspect-volume.mjs';
import { surveyExposedOres } from './ore-survey.mjs';
import { equipmentView } from './equipment-view.mjs';
import { gotoResult } from './goto-result.mjs';
import { pillarStep } from './pillar-step.mjs';
import { farmOperation } from './farm-operations.mjs';
import { createVillagerOperations } from './villager-operations.mjs';
import { interactBlock } from './interact-block.mjs';
import { waterOperation } from './water-operations.mjs';
import { createCombatOperations } from './combat-operations.mjs';
import { digWithHarvestCheck } from './dig-operations.mjs';
import { queryCraftable } from './craftable-query.mjs';
import { inspectWaterArea } from './water-area.mjs';
import { createPickupOperations } from './pickup-operations.mjs';

export function createServer({ getState, getActions, getAutonomy, getCompanionPlay = () => null, forgeGameDirectory=null, log = console.log }) {
  const villagers=createVillagerOperations();
  const PORT = 63200;
  const HOST = '127.0.0.1';
  let autoRef = null;
  let watchdogRef = null;
  const chests = createChestOperations();
  const stations = createStationOperations();
  const fishing = createFishOperations();
  const food = createFoodOperations();
  const combat = createCombatOperations();
  const pickup = createPickupOperations({preview:previewBetween,toVec:(x,y,z)=>new Vec3(x,y,z)});
  const lookupForgeItems = createForgeItemLookup({gameDir:forgeGameDirectory});
  async function setPlanning(on) {
    try {
      const token=fs.readFileSync(path.join(BRIDGE_DIR,'state','console-token'),'utf8').trim();
      const r=await fetch('http://127.0.0.1:3100/api/mc/self-play?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on}),signal:AbortSignal.timeout(5000)});
      const value=await r.json(); return r.ok && value.ok===true;
    } catch { return false; }
  }
  async function getPlanningState() {
    try {
      const token=fs.readFileSync(path.join(BRIDGE_DIR,'state','console-token'),'utf8').trim();
      const r=await fetch('http://127.0.0.1:3100/api/mc/game-mode?token='+encodeURIComponent(token),{signal:AbortSignal.timeout(1500)});
      const value=await r.json();
      if(!r.ok || typeof value.gameMode!=='boolean')throw Error('桥接状态不可用');
      return {enabled:value.gameMode,source:'bridge',note:'这是持续自主规划开关；companionPlay 是独立的本地跟随/探索，不等于规划已关闭。'};
    } catch {return {enabled:null,source:'unavailable',note:'无法确认持续自主规划状态'};}
  }

  const readBody = (req) => new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });

  const send = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = url.pathname;
    const actions = getActions();
    const state = getState();

    // ── 决策记录（看模型怎么想的）──────────────────────────
    if (path === '/api/mc/decisions' || path === '/decisions') {
      const llm = autoRef && autoRef.llmRef ? autoRef.llmRef() : null;
      return send(res, 200, { ok: true, decisions: llm ? llm.history() : [] });
    }

    // ── 只读 ──────────────────────────────────────────────
    if (path === '/status' || path === '/api/mc/status') {
      if (!state.online) return send(res, 503, { ok: false, error: 'bot 未连接游戏', ...state });
      return send(res, 200, { ok: true, ...actions.status(), equipment:equipmentView(botRef), selfPlay:await getPlanningState(), companionPlay: getCompanionPlay()?.status() || null, auto: autoRef ? autoRef.status() : null, watch: watchdogRef ? watchdogRef.status() : null });
    }

    // ── 写操作（只接受 POST）──────────────────────────────
    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, error: '只接受 POST' });
    }
    const body = await readBody(req);
    const action = String(body.action || url.pathname.replace(/^\/api\/mc\//, '') || '').trim();

    if (!state.online) return send(res, 503, { ok: false, error: 'bot 未连接游戏', ...state });

    if (['follow','stop','come','goto','idle','gohome','dig','place','placeNear','build','sequence','stopAll'].includes(action)) getCompanionPlay()?.stop();

    try {
      switch (action) {
        case 'follow': {
          const who = String(body.who || state.owner || '');
          actions.follow(who);
          const follow=actions.status();
          return send(res, 200, { ok: true, action: 'follow', who, visible:follow.followVisible, distance:follow.followDistance, note:follow.followVisible?'跟随已启动，是否靠近需继续观察':'跟随请求已启用，但当前看不到目标，尚未跟上' });
        }
        case 'stop': {
          actions.stopFollow();
          const wasDigging=!!botRef.targetDigBlock;
          if(wasDigging && typeof botRef.stopDigging==='function') { try { botRef.stopDigging(); } catch {} }
          return send(res, 200, { ok: true, action: 'stop', diggingStopRequested:wasDigging, note:'已停止当前移动；若正在挖掘已请求中止，结果需重新检查。自主游戏仍可继续；结束自主游戏请使用 selfPlay(on=false) 或 stopAll。' });
        }
        case 'come': {
          const who = String(body.who || state.owner || '');
          const ok = await actions.gotoPlayer(who, 2);
          return send(res, 200, { ok, action: 'come', who });
        }
        case 'goto': {
          const { x, y, z } = body;
          if ([x, y, z].some((v) => !Number.isFinite(Number(v)))) {
            return send(res, 400, { ok: false, error: '需要 x y z 三个数字' });
          }
          const target={x:Number(x),y:Number(y),z:Number(z)};
          const range=body.count===undefined ? 0 : Math.min(3,Math.max(0,Math.floor(Number(body.count)||0)));
          const p=botRef.entity?.position;
          const before=p?{x:p.x,y:p.y,z:p.z}:null;
          const ok = await actions.gotoXYZ(target.x,target.y,target.z,range);
          const q=botRef.entity?.position;
          const after=q?{x:q.x,y:q.y,z:q.z}:null;
          return send(res, 200, gotoResult({target,range,pathfinderOk:ok,before,after}));
        }
        case 'look': {
          const who = String(body.who || state.owner || '');
          const ok = actions.lookAt(who);
          return send(res, 200, { ok, action: 'look', who });
        }
        case 'say': {
          const text = String(body.text || '').slice(0, 200);
          if (!text) return send(res, 400, { ok: false, error: 'text 不能为空' });
          log('【say】有人让我在游戏里说话：' + text.slice(0, 60));
          getBot().chat(text);
          return send(res, 200, { ok: true, action: 'say', channel: 'game' });
        }
        case 'home': {
          if (!autoRef) return send(res, 503, { ok: false, error: '自主模块没启动' });
          // 默认用主人当前站的位置当家；也可传 xyz
          const at = body.at === 'bot' ? 'bot' : 'owner';
          const h = autoRef.setHome(
            body.x !== undefined ? { x: Number(body.x), y: Number(body.y), z: Number(body.z) } : null,
            { at }
          );
          return send(res, 200, { ok: !!h, action: 'home', home: h, at });
        }
        case 'auto': {
          const companion = getCompanionPlay();
          if (companion) {
            if (body.on === false) { companion.stop(); actions.stopFollow(); }
            else { autoRef?.stop(); companion.start(); }
            const planningUpdated=await setPlanning(body.on !== false);
            return send(res, 200, { ok: true, action: 'auto', companionPlay: companion.status(), planningUpdated });
          }
          if (!autoRef) return send(res, 503, { ok: false, error: '自主模块没启动' });
          if (body.on === false) {
            autoRef.stop();
          } else {
            // "自己玩" = 停止跟随 + 开始自主探索
            actions.stopFollow();
            autoRef.start();
          }
          return send(res, 200, { ok: true, action: 'auto', auto: autoRef.status() });
        }
        case 'idle': {
          if (autoRef) autoRef.stop();
          actions.stopFollow();
          const planningStopped=await setPlanning(false);
          return send(res, 200, { ok: true, action: 'idle', planningStopped });
        }
        case 'gohome': {
          if (!autoRef) return send(res, 503, { ok: false, error: '自主模块没启动' });
          const ok = await autoRef.goHome();
          return send(res, 200, { ok, action: 'gohome' });
        }
        // ── 细粒度工具（让模型自己玩）──────────────────────────
        case 'dig': {
          const { x, y, z } = body;
          if ([x, y, z].some((v) => !Number.isFinite(Number(v)))) return send(res, 400, { ok: false, error: '需要 x y z' });
          const target = botRef.blockAt(new Vec3(Number(x), Number(y), Number(z)));
          return send(res,200,await digWithHarvestCheck(botRef,target));
        }
        case 'place': {
          const {x,y,z,item,face}=body;
          if([x,y,z].some(v=>v===undefined||v===null||!Number.isInteger(Number(v))))return send(res,400,{ok:false,error:'需要整数目标坐标 x y z'});
          const result=await placeAtTarget(botRef,new Vec3(Number(x),Number(y),Number(z)),{item,face});
          return send(res,200,result);
        }
        case 'findBlock': {
          const name = String(body.name || '').trim();
          if (!name) return send(res, 400, { ok: false, error: '需要 name' });
          const def = botRef.registry.blocksByName[name];
          if (!def) return send(res, 400, { ok: false, error: '没有这种方块: ' + name });
          const maxDist = Number(body.maxDistance) || 32;
          const found = botRef.findBlocks({ matching: def.id, maxDistance: maxDist, count: 1 });
          if (!found.length) return send(res, 200, { ok: true, found: null, searched: maxDist, note:'只搜索当前已加载范围；未找到不代表该范围以外没有。' });
          const p = found[0];
          return send(res, 200, { ok: true, found: { x: p.x, y: p.y, z: p.z }, name, note:'只返回最近匹配的一个方块，不代表周围只有一个。' });
        }
        case 'inventory': {
          const raw=botRef.inventory.items();
          const mapped=await lookupForgeItems(raw);
          const items = raw.map((i) => ({ name: i.name, displayName: i.displayName, id: i.type, metadata: i.metadata ?? 0, count: i.count, slot: i.slot, ...(i.name==='unknown'&&mapped.has(i.type)?mapped.get(i.type):{}) }));
          return send(res, 200, { ok: true, items, equipment:equipmentView(botRef), note:'items 是普通物品栏；已穿戴盔甲在 equipment 中。' });
        }
        case 'equip': {
          const name = String(body.name || '').trim();
          const dest = String(body.dest || 'hand');
          const it = botRef.inventory.items().find((i) => i.name === name);
          if (!it) return send(res, 400, { ok: false, error: '没有 ' + name });
          await botRef.equip(it, dest);
          return send(res, 200, { ok: true, action: 'equip', name, dest });
        }
        case 'attack': {
          return send(res,200,combat.attack(botRef,{name:body.name,who:body.who}));
        }
        case 'jump': {
          botRef.setControlState('jump', true);
          setTimeout(() => { try { botRef.setControlState('jump', false); } catch {} }, Number(body.ms) || 300);
          return send(res, 200, { ok: true, action: 'jump' });
        }
        case 'drop': {
          const name = String(body.name || '').trim();
          const it = botRef.inventory.items().find((i) => i.name === name);
          if (!it) return send(res, 400, { ok: false, error: '没有 ' + name });
          await botRef.toss(it, Number(body.count) || it.count);
          return send(res, 200, { ok: true, action: 'drop', name });
        }
        case 'craft': {
          const want = String(body.item || body.name || '').trim();
          if (!want) return send(res, 400, { ok: false, error: '需要 item' });
          const count = Math.max(1, Math.min(64, Number(body.count) || 1));
          const def = botRef.registry.itemsByName[want] || botRef.registry.itemsArray.find((i) => i.name.includes(want));
          if (!def) return send(res, 400, { ok: false, error: '没有这种物品: ' + want });
          const tableBlock = botRef.findBlock({ matching: [botRef.registry.blocksByName.crafting_table?.id].filter(Boolean), maxDistance: 8 });
          // 2026-11-03：1.12.2 的物品带 metadata（不同树种/羊毛色），recipesFor 的 metadata 传 null 会漏掉
          // 正确做法：遍历背包里所有同 id 的物品，用它们的 metadata 各试一遍
          let recipes = [];
          const haveMeta = new Set();
          for (const it of botRef.inventory.items()) {
            if (it.type === def.id || it.name === def.name) haveMeta.add(it.metadata ?? 0);
          }
          const metas = haveMeta.size ? [...haveMeta] : [null];
          for (const m of metas) {
            try {
              const rs = botRef.recipesFor(def.id, m, 1, tableBlock || null);
              if (rs.length) { recipes = rs; break; }
            } catch {}
          }
          if (!recipes.length) {
            // 兜底：不限 metadata 再试一次
            try { recipes = botRef.recipesFor(def.id, null, 1, tableBlock || null); } catch {}
          }
          if (!recipes.length) return send(res, 200, { ok: false, reason: '没有可用配方（缺材料或需要工作台）', item: def.name, haveMetas: [...haveMeta] });
          const before = botRef.inventory.items().filter((i) => i.name === def.name).reduce((s, i) => s + i.count, 0);
          try {
            await botRef.craft(recipes[0], count, tableBlock || null);
            const inv = botRef.inventory.items().filter((i) => i.name === def.name).reduce((s, i) => s + i.count, 0);
            return send(res, 200, { ok: true, action: 'craft', item: def.name, count, nowHas: inv });
          } catch (e) {
            // 2026-11-03：mineflayer 的 bot.craft 常在"实际已合成成功"后抛 missing ingredient
            // （背包事件还没到），所以失败时再查一次背包，有目标物品就算成功
            await new Promise((r) => setTimeout(r, 600));
            const after = botRef.inventory.items().filter((i) => i.name === def.name).reduce((s, i) => s + i.count, 0);
            if (after > before) return send(res, 200, { ok: true, action: 'craft', item: def.name, count, nowHas: after, note: '操作报错，但目标物品数量增加' });
            return send(res, 500, { ok: false, error: '合成失败: ' + e.message, nowHas: after });
          }
        }
        case 'craftable': {
          return send(res,200,queryCraftable(botRef,{name:body.name}));
        }
        case 'useBlock': {
          if(body.text==='water-fill'||body.text==='water-pour'){
            const position={x:Number(body.x),y:Number(body.y),z:Number(body.z)};
            if([body.x,body.y,body.z].some(v=>v===undefined||v===null)||!Object.values(position).every(Number.isInteger))return send(res,400,{ok:false,error:'水桶操作需要整数坐标'});
            return send(res,200,await waterOperation(botRef,{operation:String(body.text).slice(6),position,makePos:(x,y,z)=>new Vec3(x,y,z)}));
          }
          if(body.text==='restore-block'){
            if([body.x,body.y,body.z].some(v=>v===undefined||v===null||!Number.isInteger(Number(v)))||!body.item||!Number.isInteger(Number(body.count))||Number(body.count)<1||Number(body.count)>16)return send(res,400,{ok:false,error:'恢复需要坐标、方块名和 count=原 metadata 加1'});
            return send(res,200,await placeAtTarget(botRef,new Vec3(Number(body.x),Number(body.y),Number(body.z)),{item:String(body.item),metadata:Number(body.count)-1}));
          }
          if(body.text==='villager-list'||body.text==='villager-trade')return send(res,200,await villagers.run(botRef,{operation:body.text==='villager-list'?'list':'trade',who:body.who,index:body.count===undefined?undefined:Number(body.count),expected:body.item}));
          if(body.text==='pillar-step')return send(res,200,await pillarStep(botRef,{item:body.item,makePos:(x,y,z)=>new Vec3(x,y,z)}));
          if(/^farm-(inspect|till|plant|harvest)$/.test(String(body.text||''))){
            const position={x:Number(body.x),y:Number(body.y),z:Number(body.z)};
            if([body.x,body.y,body.z].some(v=>v===undefined||v===null)||!Object.values(position).every(Number.isInteger))return send(res,400,{ok:false,error:'农耕操作需要整数耕地坐标'});
            return send(res,200,await farmOperation(botRef,{operation:String(body.text).slice(5),position,item:body.item,makePos:(x,y,z)=>new Vec3(x,y,z)}));
          }
          if(body.text==='eat')return send(res,200,await food.eat(botRef,String(body.name||'').trim()));
          if(body.text==='collect'){
            getCompanionPlay()?.stop();
            return send(res,200,await pickup.collect(botRef,actions,{name:body.name,x:body.x===undefined?undefined:Number(body.x),y:body.y===undefined?undefined:Number(body.y),z:body.z===undefined?undefined:Number(body.z)}));
          }
          const { x: ux, y: uy, z: uz } = body;
          if ([ux, uy, uz].some((v) => !Number.isFinite(Number(v)))) return send(res, 400, { ok: false, error: '需要 x y z' });
          const blk = botRef.blockAt(new Vec3(Number(ux), Number(uy), Number(uz)));
          if (!blk) return send(res, 400, { ok: false, error: '位置无效' });
          if(body.text==='wake') return send(res,200,await wakeFromBed(botRef));
          if(body.text==='sleep' || /(^|_)bed$/.test(blk.name)) return send(res,200,await sleepOnBed(botRef,blk));
          if (['chest','trapped_chest'].includes(blk.name)) {
            try {
              if(stations.isBusy())throw Error('另一容器操作尚未结束');
              const result=await chests.run(botRef,blk,{take:body.name ? String(body.name).trim() : undefined,put:body.item ? String(body.item).trim() : undefined,count:body.count === undefined ? 1 : Number(body.count)});
              return send(res,200,{...result,position:{x:blk.position.x,y:blk.position.y,z:blk.position.z}});
            } catch(e) { return send(res,200,{ok:false,error:String(e.message||e)}); }
          }
          if (['furnace','lit_furnace','enchanting_table'].includes(blk.name)) {
            try {
              if(chests.isBusy())throw Error('另一容器操作尚未结束');
              const operation=String(body.text || (blk.name==='enchanting_table'?'enchant-options':'furnace-inspect'));
              const result=await stations.run(botRef,blk,{operation,name:body.name?String(body.name).trim():undefined,count:body.count===undefined?1:Number(body.count)});
              return send(res,200,{...result,position:{x:blk.position.x,y:blk.position.y,z:blk.position.z}});
            } catch(e) { return send(res,200,{ok:false,error:String(e.message||e)}); }
          }
          if (body.text === 'fish') {
            try { const result=await fishing.run(botRef,blk);return send(res,200,result); }
            catch(e) { return send(res,200,{ok:false,error:String(e.message||e)}); }
          }
          return send(res,200,await interactBlock(botRef,blk));
        }
        case 'findBlockAll': {
          const nm = String(body.name || '').trim();
          const maxD = Number(body.maxDistance) || 16;
          const cnt = Math.min(8, Number(body.count) || 4);
          const d2 = botRef.registry.blocksByName[nm];
          if (!d2) return send(res, 400, { ok: false, error: '没有这种方块: ' + nm });
          const ps = botRef.findBlocks({ matching: d2.id, maxDistance: maxD, count: cnt });
          return send(res, 200, { ok: true, blocks: ps.map((p) => ({ x: p.x, y: p.y, z: p.z })) });
        }
        // 2026-11-03：给模型用的简化放置——不用算坐标，直接"在我脚下/面前放一块"
        case 'placeNear': {
          const mode=String(body.where||'feet').toLowerCase();
          const me=botRef.entity.position.floored();
          let target;
          if(mode==='front')target=me.offset(Math.round(-Math.sin(botRef.entity.yaw)*2),0,Math.round(-Math.cos(botRef.entity.yaw)*2));
          else if(mode==='up')target=me.offset(0,2,0);
          else if(mode==='feet')target=me.offset(0,-1,0);
          else return send(res,400,{ok:false,error:'where 仅支持 front、feet 或 up'});
          return send(res,200,{...await placeAtTarget(botRef,target,{item:body.item}),where:mode});
        }
        // ── 地图 / 高度 / 扫描（抄 whale_craft）──────────────────
        case 'map': {
          const m = surfaceMap(botRef, { radius: Number(body.radius) || 24, step: Number(body.step) || 2, startY: body.startY === undefined ? null : Number(body.startY) });
          if (!m) return send(res, 503, { ok: false, error: '拿不到位置' });
          return send(res, 200, { ok: true, action: 'map', center: m.center, radius: m.radius, text: formatMap(m, '地表图') });
        }
        case 'height': {
          const hm = heightMap(botRef, { radius: Number(body.radius) || 20, step: Number(body.step) || 2 });
          if (!hm) return send(res, 503, { ok: false, error: '拿不到位置' });
          const L = ['【高度图】每格的 Y 值（深浅=高低）', '北↑南↓西←东→', ''].concat(hm.lines);
          return send(res, 200, { ok: true, action: 'height', min: hm.min, max: hm.max, text: L.join('\n') });
        }
        case 'scan': {
          if(body.text==='ores') return send(res,200,surveyExposedOres(botRef,{radius:body.radius,limit:body.count,makePos:(x,y,z)=>new Vec3(x,y,z)}));
          if(body.text==='blocks') {
            const c={x:Number(body.x),y:Number(body.y),z:Number(body.z)};
            if([body.x,body.y,body.z].some(v=>v===undefined)||!Object.values(c).every(Number.isInteger))return send(res,400,{ok:false,error:'方块检查需要整数 x/y/z'});
            const result=inspectVolume(botRef,c,{radius:body.radius??2,height:body.height??5,makePos:(x,y,z)=>new Vec3(x,y,z)});
            return send(res,result.ok?200:400,result);
          }
          if(body.text==='water-area') {
            if([body.x,body.y,body.z].some(v=>v===undefined||!Number.isInteger(Number(v))))return send(res,400,{ok:false,error:'水域检查需要整数 x/y/z'});
            return send(res,200,inspectWaterArea(botRef,new Vec3(Number(body.x),Number(body.y),Number(body.z)),body.radius));
          }
          if(body.text==='route') {
            if([body.x,body.y,body.z].some(v=>v===undefined||!Number.isInteger(Number(v))))return send(res,400,{ok:false,error:'路线预览需要整数 x/y/z'});
            return send(res,200,diagnoseRoute(botRef,new Vec3(Number(body.x),Number(body.y),Number(body.z)),{range:body.count}));
          }
          if(body.text==='house-plan') {
            if([body.x,body.y,body.z].some(v=>v===undefined||!Number.isInteger(Number(v))))return send(res,400,{ok:false,error:'房屋蓝图需要整数 x/y/z'});
            try { return send(res,200,{ok:true,...planHouse(botRef,new Vec3(Number(body.x),Number(body.y),Number(body.z)),{width:Number(body.width),depth:Number(body.depth),height:Number(body.height),material:String(body.item||'planks')})}); }
            catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
          }
          if(body.text==='house') {
            if([body.x,body.y,body.z].some(v=>v===undefined||!Number.isInteger(Number(v))))return send(res,400,{ok:false,error:'房屋检查需要整数 x/y/z'});
            try { const result=inspectHouse(botRef,new Vec3(Number(body.x),Number(body.y),Number(body.z)),{width:Number(body.width),depth:Number(body.depth),height:Number(body.height)});return send(res,200,{ok:true,action:'houseCheck',...result}); }
            catch(e){return send(res,400,{ok:false,error:String(e.message||e)});}
          }
          const sc = scanArea(botRef, { radius: Number(body.radius) || 16, height: Number(body.height) || 8 });
          if (!sc) return send(res, 503, { ok: false, error: '拿不到位置' });
          return send(res, 200, { ok: true, action: 'scan', center: sc.center, top: sc.top });
        }
        // ── 建造 / 连串（抄 whale_craft）──────────────────────────
        case 'build': {
          const { x: bx, y: by, z: bz, width, height: bh, depth, item: bitem, hollow } = body;
          if ([bx, by, bz].some((v) => !Number.isFinite(Number(v)))) return send(res, 400, { ok: false, error: '需要 x y z' });
          try {
            const r = await buildBox(botRef, { x: Number(bx), y: Number(by), z: Number(bz), width: Number(width) || 3, height: Number(bh) || 3, depth: Number(depth) || 3, item: bitem, hollow: hollow !== false, log });
            return send(res, 200, { ok: r.complete, action: 'build', ...r });
          } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
        }
        case 'sequence': {
          const steps = Array.isArray(body.steps) ? body.steps : [];
          if (!steps.length) return send(res, 400, { ok: false, error: '需要 steps 数组' });
          try {
            const r = await runSequence(botRef, steps, { log, stations, budgetMs: Number(body.budgetMs) || 300000, stopOnError: body.stopOnError !== false });
            return send(res, 200, { ok: r.done===steps.length && r.results.every(step=>step.ok), action: 'sequence', ...r });
          } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
        }
        // ── 看门狗控制 ─────────────────────────────────────
        case 'watch': {
          if (!watchdogRef) return send(res, 503, { ok: false, error: '看门狗没启动' });
          const op = String(body.op || 'status').toLowerCase();
          if (op === 'arm') { watchdogRef.arm(); return send(res, 200, { ok: true, op, status: watchdogRef.status() }); }
          if (op === 'disarm') { watchdogRef.disarm(String(body.why || '手动')); return send(res, 200, { ok: true, op, status: watchdogRef.status() }); }
          if (op === 'config') {
            const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
            const merged = { ...watchdogRef.config, ...patch };
            if (patch.wakeOn) merged.wakeOn = { ...watchdogRef.config.wakeOn, ...patch.wakeOn };
            watchdogRef.setConfig(merged);
            return send(res, 200, { ok: true, op, config: watchdogRef.config });
          }
          return send(res, 200, { ok: true, op: 'status', status: watchdogRef.status() });
        }
        // 游戏公屏说话（2026-11-04：之前只有 say 是发 QQ，游戏里没声音）
        case 'chat': {
          const msg = String(body.message || body.text || '').slice(0, 240);
          if (!msg) return send(res, 400, { ok: false, error: '需要 message' });
          try { botRef.chat(msg); return send(res, 200, { ok: true, action: 'chat', said: msg }); }
          catch (e) { return send(res, 500, { ok: false, error: e.message }); }
        }
        // 开关"她自己玩"（2026-11-04：qq_mc 的 enum 里有，server 之前没实现）
        case 'selfPlay': {
          const on = body.on !== false;
          try {
            const fs2 = await import('node:fs');
            const tok = fs2.readFileSync(path.join(BRIDGE_DIR,'state','console-token'), 'utf8').trim();
            const r = await fetch('http://127.0.0.1:3100/api/mc/self-play?token=' + encodeURIComponent(tok), {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ on }), signal: AbortSignal.timeout(15000),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j.ok === false) return send(res, 502, { ok:false, error:j.error || `桥接失败 HTTP ${r.status}` });
            const companion = getCompanionPlay();
            if (on) { autoRef?.stop(); companion?.start(); } else { companion?.stop(); actions.stopFollow(); }
            return send(res, 200, { ok: true, action: 'selfPlay', on, companionPlay:companion?.status() || null, bridge: j });
          } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
        }
        case 'stopAll': {
          if (autoRef) autoRef.stop();
          actions.stopFollow();
          try { botRef.pathfinder.setGoal(null); } catch {}
          try { botRef.clearControlStates(); } catch {}
          const planningStopped=await setPlanning(false);
          return send(res, 200, { ok: true, action: 'stopAll', planningStopped });
        }

        default:
          return send(res, 400, { ok: false, error: `未知动作 ${action}`, allowed: ['follow', 'stop', 'come', 'goto', 'look', 'say', 'home', 'auto', 'idle', 'gohome', 'dig', 'place', 'placeNear', 'findBlock', 'findBlockAll', 'inventory', 'equip', 'attack', 'jump', 'drop', 'stopAll', 'craft', 'craftable', 'useBlock', 'map', 'height', 'scan', 'build', 'sequence'] });
      }
    } catch (e) {
      log('接口执行失败:', e.message);
      return send(res, 500, { ok: false, error: e.message });
    }
  });

  let botRef = null;
  const getBot = () => botRef;
  const setBot = (b) => { botRef = b; };

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, HOST, () => {
        log(`HTTP 接口已启动 http://${HOST}:${PORT}`);
        resolve(PORT);
      });
    }),
    close: () => new Promise((r) => server.close(() => r())),
    setBot,
    getBot,
    setAutonomy: (a) => { autoRef = a; },
    setWatchdog: (w) => { watchdogRef = w; },
    port: PORT,
  };
}
