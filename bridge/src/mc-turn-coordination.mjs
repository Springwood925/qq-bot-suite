export function ownerHasPriority({now=Date.now(),priorityUntil=0,queueRunning=false,queueLength=0,pendingTimer=false,contextBusy=null,execution=null,lastReplyAt=0}={}) {
 if(now<priorityUntil||queueRunning||queueLength>0||pendingTimer||contextBusy===true)return true;
 // An unknown DSH context with an unfinished execution is not safe to overlap.
 if(contextBusy===null&&execution&&!(Number(lastReplyAt)>Number(execution.createdAt)))return true;
 return false;
}
