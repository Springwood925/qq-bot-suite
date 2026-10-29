import fs from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'qq-wake-mcp-'));
fs.mkdirSync(path.join(fixture,'src'));fs.mkdirSync(path.join(fixture,'state'));
for(const name of ['mcp-snowluma-safe.js','sensitive.js'])fs.copyFileSync(path.join(root,'src',name),path.join(fixture,'src',name));
fs.writeFileSync(path.join(fixture,'package.json'),'{"type":"module"}');
fs.writeFileSync(path.join(fixture,'state/mode.json'),'{"mode":"reserved2"}');
const loader=path.join(fixture,'deps.mjs');
fs.writeFileSync(loader,`import {registerHooks} from 'node:module';const parentURL=${JSON.stringify(pathToFileURL(path.join(root,'package.json')).href)};registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&!s.startsWith('.')&&!s.startsWith('/')&&!s.includes(':'))return next(s,{...c,parentURL});throw e}}});`);
let received;
const stub=http.createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;
 res.setHeader('content-type','application/json');
 if(req.url==='/api/socialV2/wait'){res.statusCode=500;res.end(JSON.stringify({ok:false,error:'fixture socket timeout'}));}
 else if(req.url==='/api/socialV2/mark-read'){received=JSON.parse(text);res.end(JSON.stringify({ok:true,markedCount:1}));}
 else {res.statusCode=404;res.end('{}');}
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');
const transport=new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(loader).href,path.join(fixture,'src/mcp-snowluma-safe.js')],stderr:'pipe'});
const client=new Client({name:'offline-wake-regression',version:'1'});
try{
 const cfg={consolePort:stub.address().port,consoleToken:'test-console-token-123'};
 cfg.socialV2={...cfg.socialV2,tools:{allowlist:['qq_mark_read','qq_wait_for_messages']}};
 fs.writeFileSync(path.join(fixture,'config.json'),JSON.stringify(cfg));await client.connect(transport);
 const wait=await client.callTool({name:'qq_wait_for_messages',arguments:{key:'private:123',token:'test',timeoutMs:100}});
 const payload=JSON.parse(wait.content[0].text);assert.equal(wait.isError,true);assert.equal(payload.resultUnknown,true);assert.equal(payload.timeout,false);
 const mark=await client.callTool({name:'qq_mark_read',arguments:{key:'private:123',token:'test',batchId:'batch-test'}});
 assert.equal(mark.isError,undefined);assert.equal(received.batchId,'batch-test');
 console.log('MCP wait disconnect remains unknown; optional read receipt is forwarded.');
}finally{
 await client.close();stub.closeAllConnections();await new Promise(r=>stub.close(r));
 assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(fixture).startsWith('qq-wake-mcp-'));
 fs.rmSync(fixture,{recursive:true,force:true});
}
