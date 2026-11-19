// Local Cloudflare runtime. All outbound traffic is replaced by a synthetic
// Responses endpoint. The SQLite object, HTTP dispatch and bindings are real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {accountKeys} from '../account.mjs';
import {newState} from '../health/core.mjs';
import {requestData} from '../health/candidates.mjs';

const a=await accountKeys(randomBytes(32).toString('hex'));
const b=await accountKeys(randomBytes(32).toString('hex'));
const origin='http://localhost:8080';
let calls=0;
const mf=new Miniflare(convertV4MiniflareOptions({
  compatibilityDate:'2026-05-01',
  modules:['worker/index.mjs','worker/responses.mjs','health/contract.mjs'].map(path=>({type:'ESModule',path,contents:readFileSync(path,'utf8')})),
  bindings:{ALLOWED_ORIGINS:origin,AI_USERS:JSON.stringify([a.id,b.id]),OPENAI_API_KEY:'synthetic',
    USER_RPM:'3',USER_MONTHLY_CALLS:'5',MONTHLY_BUDGET_CENTS:'40',TOTAL_BUDGET_CENTS:'40'},
  durableObjects:{QUOTA:{className:'Quota',useSQLite:true}},
  outboundService:async req=>{
    assert.equal(req.url,'https://api.openai.com/v1/responses');
    assert.equal(req.headers.get('authorization'),'Bearer synthetic');
    calls++;
    await new Promise(ok=>setTimeout(ok,100));
    return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:20},
      output:[{type:'message',content:[{type:'output_text',text:'{"note":"合成结果","items":[]}'}]}]});
  }
}));
try {
  const send=bearer=>mf.dispatchFetch('https://example.invalid/api/assist',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+bearer},
    body:JSON.stringify(requestData(newState(),'entry','测试',null,'2030-01-01',false))});
  assert.equal((await send('invalid')).status,401);
  assert.equal(calls,0);
  const both=await Promise.all([send(a.bearer),send(b.bearer)]);
  assert.deepEqual(both.map(r=>r.status).sort(),[200,429]);
  assert.equal(calls,1);
  assert.equal((await send(b.bearer)).status,200);
  console.log('PASS real Worker + SQLite Durable Object, concurrent shared budget, upstream usage settlement');
} finally { await mf.dispose(); }
