export function readManualMode(record) {
 return {manual:typeof record?.manual==='boolean'?record.manual:null,manualAt:Number.isFinite(record?.manualAt)?record.manualAt:0};
}
export function writeManualMode(on,write,now=Date.now()) {
 if(typeof on!=='boolean')throw Error('自玩状态必须为布尔值');
 const record={manual:on,manualAt:now};
 write(record); // Persist before changing in-memory state.
 return record;
}
