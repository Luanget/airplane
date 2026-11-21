import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAgentRun,nativeRequest,runAgent} from '../ai/agent-loop.mjs';

const init=()=>createAgentRun({id:'test',model:'gpt-6-luna',date:'2035-04-22',clock:'12:10',text:'合成任务'});
const out=(...items)=>({status:'completed',output:items});
const tool=(id,args={amount:2})=>({type:'function_call',id:'fc_'+id,name:'write',call_id:id,arguments:JSON.stringify(args)});
const reasoning={type:'reasoning',id:'sealed-r',summary:[],encrypted_content:'opaque'};
const answer=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});

test('manual continuation preserves full output and keeps success through answer-only retry',async()=>{
 const run=init(),snapshots=[],ids=[];
 const dispatch=Object.assign(async(name,args,{operationId})=>{
  ids.push(operationId);return {status:'saved',verified:args.amount};
 },{isWrite:()=>true});
 let turns=0;
 await assert.rejects(runAgent(run,{dispatch,save:state=>snapshots.push(structuredClone(state)),request(state){
  turns++;
  if(turns===1)return out(reasoning,answer('我在核对'),tool('first'));
  assert.deepEqual(state.input.at(-1),{type:'function_call_output',call_id:'first',output:'{"status":"saved","verified":2}'});
  assert.ok(nativeRequest(state,'instructions',[]).input.some(item=>item.encrypted_content==='opaque'));
  throw Error('connection interrupted');
 }}),/connection interrupted/);
 const final=await runAgent(snapshots.at(-1),{dispatch,save:()=>{},replyOnly:true,
  request(state,options){
   assert.equal(nativeRequest(state,'instructions',[],options).tool_choice,'none');
   return out(answer('合成记录已保存。'));
  }});
 assert.equal(ids.length,1);
 assert.equal(final.reply,'合成记录已保存。');
});

test('read and write turns can exceed eight, with stable duplicates suppressing writes',async()=>{
 const run=init();
 let requests=0,writes=0;
 const dispatch=Object.assign(async(name,args)=>{writes++;return {status:'saved',verified:args.amount};},{isWrite:()=>true});
 await runAgent(run,{dispatch,save:()=>{},request(){
  if(++requests<13)return out(tool('c'+requests,{amount:requests===12?1:requests}));
  return out(answer('结束'));
 }});
 assert.equal(writes,11);
 assert.equal(run.receipts.at(-1).result.replayed,true);
});

test('queued steering invalidates a stale pending write before admitting new input',async()=>{
 const run=init(),steering=[];
 let requests=0,writes=0;
 const dispatch=Object.assign(async()=>{writes++;return {status:'saved'};},{isWrite:()=>true});
 await runAgent(run,{dispatch,save:()=>{},additions:({peek}={})=>peek?steering:[...steering.splice(0)],request(){
  if(++requests===1){steering.push({text:'本轮改为不保存',attachments:[]});return out(tool('stale'));}
  assert.match(JSON.stringify(run.input.at(-1)),/本轮改为不保存/);
  return out(answer('按补充处理'));
 }});
 assert.equal(writes,0);
 assert.equal(run.receipts[0].result.status,'superseded');
});
