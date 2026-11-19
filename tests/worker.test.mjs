import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import gateway from '../worker/index.mjs';
import {parseResult,modelRequest,callModel,MODEL} from '../ai/responses.mjs';
import {exampleInput,assessExample} from '../ai/example.mjs';
import {accountKeys} from '../account.mjs';

const input=exampleInput();
const origin='http://localhost:8080';
const envelope=body=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(body)}]}]});
test('optional loopback Worker rejects unauthorized callers, oversized data and remote image URLs before billing',async t=>{
  const {id,bearer}=await accountKeys(randomBytes(32).toString('hex'));
  let calls=0;
  const env={OPENAI_API_KEY:'synthetic',AI_USERS:JSON.stringify([id]),ALLOWED_ORIGINS:origin};
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
test('BYOK sends the selected key only to Responses, uses the economy model and reports provider errors',async t=>{
  const raw=envelope({items:[],note:'测试'});
  const stub=t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization,'Bearer fixture-only');
    const data=JSON.parse(init.body);assert.equal(data.model,MODEL);
    assert.equal(data.store,false);assert.equal(data.text.format.strict,true);
    assert.ok(!('tools' in data));assert.equal(init.redirect,'manual');
    return Response.json(raw);
  });
  assert.deepEqual(await callModel('fixture-only',input),{items:[],note:'测试'});
  stub.mock.mockImplementation(async()=>new Response(null,{status:401}));
  await assert.rejects(callModel('fixture-only',input),/Key/);
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
  assert.deepEqual(input.catalog.map(s=>s.qty),[null,null,null]);
  const rows=assessExample({items:[],note:''});assert.equal(rows.length,3);assert.ok(rows.every(s=>s.includes('核对')));
});
