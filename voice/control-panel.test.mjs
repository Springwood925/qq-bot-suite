import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('面板只查询并控制后台，不申请麦克风',async()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 const ids=['input','output','threshold','thresholdValue','refresh','save','start','stop','interrupt','status','log'];
 const elems=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:false,append(x){if(!this.value)this.value=x.value},replaceChildren(){this.value=''}}]));
 let calls=[];const context={document:{getElementById:id=>elems[id],createElement:()=>({}),activeElement:null},location:{hash:'#test-token',pathname:'/'},history:{replaceState(){}},sessionStorage:{getItem(){return null},setItem(){}},fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url==='/audio-state'?{phase:'等待 QQ 语音通话',callState:'idle',paused:false,devices:{inputs:['in'],outputs:['out'],input:'in',output:'out',threshold:.025},log:[]}:{ok:true}}},setInterval:()=>1,clearInterval(){},Number,JSON,Error,console};
 vm.runInNewContext(script,context);await new Promise(r=>setImmediate(r));
 assert.equal(elems.status.textContent,'等待 QQ 语音通话');assert.equal(elems.input.value,'in');assert.equal(elems.output.value,'out');
 await elems.refresh.onclick();assert.ok(calls.some(x=>x.url==='/audio-control'&&JSON.parse(x.opts.body).action==='devices'));
 assert.ok(!script.includes('getUserMedia'));
});
