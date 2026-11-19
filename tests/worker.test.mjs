import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import gateway,{Quota} from '../worker/index.mjs';
import {parseResult,modelRequest,reserveCost} from '../worker/responses.mjs';
import {accountKeys} from '../account.mjs';
import {newState} from '../health/core.mjs';
import {requestData} from '../health/candidates.mjs';

const input=requestData(newState(),'entry','测试',null,'2030-01-01',false);
const origin='http://localhost:8080';
const date=new Date('2030-01-01T00:00:00Z');
function quota(env={}) {
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(query,...args){
    const stmt=db.prepare(query); const rows=stmt.all(...args);return {toArray:()=>rows};
  }},transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}
    catch(err){db.exec('ROLLBACK');throw err;}}};
  return new Quota({storage},{USER_RPM:'2',USER_MONTHLY_CALLS:'3',MONTHLY_BUDGET_CENTS:'200',TOTAL_BUDGET_CENTS:'300',...env});
}
test('only allowlisted bearer and origin can reach the gateway with a bounded valid body',async()=>{
  const {id,bearer}=await accountKeys(randomBytes(32).toString('hex'));
  let calls=0;
  const env={OPENAI_API_KEY:'synthetic-only',AI_USERS:JSON.stringify([id]),ALLOWED_ORIGINS:origin,QUOTA:{
    idFromName:v=>v,get:()=>({async fetch(_url,opts){calls++;
      assert.equal(JSON.parse(opts.body).id,id);return Response.json({ok:true});}})}};
  const send=(body,overrides={})=>gateway.fetch(new Request('https://service.invalid/api/assist',{method:'POST',
    body:JSON.stringify(body),headers:{'content-type':'application/json',Origin:origin,Authorization:'Bearer '+bearer,...overrides}}),env);
  assert.equal((await send(input,{Authorization:''})).status,401);
  assert.equal((await send(input,{Authorization:'Bearer '+randomBytes(32).toString('hex')})).status,403);
  assert.equal((await send(input,{Origin:'https://unlisted.invalid'})).status,403);
  assert.equal((await send({...input,store:true})).status,400);
  assert.equal((await send({...input,photo:'https://example.invalid/file'})).status,400);
  assert.equal((await send({...input,text:'x'.repeat(750001)})).status,400);
  assert.equal((await send(input,{'content-type':'text/plain'})).status,415);
  assert.equal(calls,0);
  const ok=await send(input);assert.equal(ok.status,200); assert.equal(ok.headers.get('cache-control'),'no-store');
  assert.equal(calls,1);
});
test('atomic admission enforces rate, per-user month and shared lifetime limit across months',()=>{
  const q=quota();
  assert.ok(q.reserve('a',date));assert.ok(q.reserve('a',date));assert.equal(q.reserve('a',date),null);
  const later=new Date(date.getTime()+60000);
  assert.ok(q.reserve('a',later));assert.equal(q.reserve('a',later),null);
  assert.ok(q.reserve('b',later));
  const shared=quota({TOTAL_BUDGET_CENTS:'40'});
  assert.ok(shared.reserve('a',date));
  assert.equal(shared.reserve('b',new Date('2030-02-01')),null);
  const monthly=quota({MONTHLY_BUDGET_CENTS:'40'});
  assert.ok(monthly.reserve('a',date));assert.equal(monthly.reserve('b',date),null);
  assert.ok(monthly.reserve('b',new Date('2030-02-01')));
  assert.throws(()=>quota({USER_RPM:'bad'}).reserve('a',date));
});
test('completed response settles actual usage, malformed/refused output never returns a candidate',async t=>{
  const q=quota({OPENAI_API_KEY:'synthetic-only'});
  const raw={status:'completed',usage:{input_tokens:100,output_tokens:20},
    output:[{type:'message',content:[{type:'output_text',text:'{"items":[],"note":"测试"}'}]}]};
  const stub=t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const data=JSON.parse(init.body);assert.equal(data.store,false);assert.equal(data.text.format.strict,true);
    assert.ok(!('tools' in data));assert.equal(init.redirect,'manual');
    return Response.json(raw);
  });
  const req=()=>new Request('https://internal.invalid',{method:'POST',body:JSON.stringify({id:'a',input})});
  assert.equal((await q.fetch(req())).status,200);assert.equal(q.get('total'),165);
  stub.mock.mockImplementation(async()=>{throw Error('sensitive upstream detail');});
  const failed=await q.fetch(req());assert.equal(failed.status,502);
  assert.ok(!(await failed.text()).includes('sensitive'));assert.equal(q.get('total'),reserveCost+165);
  assert.throws(()=>parseResult({...raw,status:'incomplete'},input));
  assert.throws(()=>parseResult({...raw,output:[{type:'message',content:[{type:'refusal'}]}]},input));
  assert.throws(()=>parseResult({...raw,output:[]},input));
  const body=modelRequest({...input,mode:'photo',photo:'data:image/jpeg;base64,example'});
  assert.equal(body.input[0].content[1].type,'input_image');
});
