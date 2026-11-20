import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import gateway from '../worker/index.mjs';
import {parseResult,modelRequest,MODEL} from '../ai/responses.mjs';
import {exampleInput,assessExample} from './fixtures/ai-sample.mjs';
import {accountKeys} from '../account.mjs';

const input=exampleInput();
const origin='http://localhost:8080';
const envelope=body=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(body)}]}]});
test('optional loopback Worker rejects unauthorized callers, oversized data and remote image URLs before billing',async t=>{
  const {id,bearer}=await accountKeys(randomBytes(32).toString('hex'));
  let calls=0;
  const env={OPENAI_API_KEY:'synthetic',AI_USERS:JSON.stringify([id]),ALLOWED_ORIGINS:origin,QUOTA:{idFromName:n=>n,get:()=>({fetch:async()=>{calls++;return Response.json({items:[],note:''});}})}};
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(envelope({items:[],note:''}));});
  const send=(body,overrides={})=>gateway.fetch(new Request('http://127.0.0.1/api/assist',{method:'POST',
    body:JSON.stringify(body),headers:{'content-type':'application/json',Origin:origin,Authorization:'Bearer '+bearer,...overrides}}),env);
  assert.equal((await send(input,{Authorization:''})).status,401);
  assert.equal((await send(input,{Authorization:'Bearer '+randomBytes(32).toString('hex')})).status,403);
  assert.equal((await send(input,{Origin:'https://unlisted.invalid'})).status,403);
  assert.equal((await send({...input,store:true})).status,400);
  assert.equal((await send({...input,photo:'https://example.invalid/file'})).status,400);
  assert.equal((await send({...input,text:'x'.repeat(750001)})).status,400);
  assert.equal((await send(input,{'content-type':'text/plain'})).status,415);
  assert.equal(calls,0);
  const ok=await send(input);assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
  assert.equal(calls,1);
});
test('structured requests exclude stored conversation and use server model parameters',()=>{
  const raw=envelope({items:[],note:'测试'});
  const req=modelRequest(input,{model:MODEL,maxOutput:2048,effort:'low'});
  assert.equal(req.model,MODEL);
  assert.equal(req.store,false);assert.equal(req.text.format.strict,true);
  assert.equal(req.max_output_tokens,2048);
  assert.deepEqual(req.reasoning,{effort:'low'});
  assert.ok(!('tools' in req));
  assert.throws(()=>parseResult({...raw,status:'incomplete'},input));
  assert.throws(()=>parseResult({...raw,output:[{type:'message',content:[{type:'refusal'}]}]},input));
  assert.throws(()=>parseResult({...raw,output:[]},input));
});
test('finance accepts a single dated expense with an existing category and rejects wrong direction, amount or date',()=>{
  const req={mode:'finance',text:'午饭28元',date:'2030-01-05',categories:[{id:'food',name:'餐饮',type:'expense'}]};
  const entry={type:'expense',categoryId:'food',date:req.date,amount:28,note:'午饭'};
  assert.equal(modelRequest(req).text.format.name,'transaction_candidate');
  assert.deepEqual(parseResult(envelope({entry,note:''}),req).entry,entry);
  for (const change of [{amount:0},{amount:2.345},{categoryId:'unknown'},{type:'income'},{date:'2030-02-31'},{date:'2030-01-06'}])
    assert.throws(()=>parseResult(envelope({entry:{...entry,...change},note:''}),req));
  assert.throws(()=>modelRequest({...req,transactions:[]}));
});
test('read-only example flags wrong quantities and missing SKU instead of reporting a successful deduction',()=>{
  assert.deepEqual(input.catalog,[]);
  const rows=assessExample({items:[],note:''});assert.equal(rows.length,3);assert.ok(rows.every(s=>s.includes('核对')));
});
