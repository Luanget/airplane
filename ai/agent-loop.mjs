import {hash,stable} from '../health/sync-source.mjs';

const effortLevels=['low','medium','high'];
const repeatedLimit=3, stalledLimit=5, turnLimit=48;
const userMessage=content=>({role:'user',content});
const inputText=text=>({type:'input_text',text});
export const toolResult=(call,output)=>({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)});
const validCall=call=>typeof call.call_id==='string'&&call.call_id.length>0&&typeof call.name==='string';
const changed=result=>result?.status==='saved'||result?.status==='undone';

export function createAgentRun({id,model,date,clock,text,attachments=[],history=[],summary=null,allowRead=true}){
 const context=[...(summary?[userMessage([inputText('较早对话摘要：'+summary)])]:[]),
  ...history.map(({role,text})=>({role,content:text}))];
 return {id,model,date,clock,allowRead,effort:attachments.length?'medium':'low',phase:'model',index:0,
  messages:[text],attachments,
  input:[...context,userMessage([inputText(text||'请查看本轮附件。'),...attachments.map(row=>row.input)])],
  receipts:[],turns:0,stalled:0,steering:[]};
}

export function nativeRequest(run,instructions,tools,{replyOnly=false}={}){
 const steering=run.allowRead?'按本机工具的回执重新核对已完成事项。':'本轮关闭本机账本访问。';
 return {model:run.model,store:false,include:['reasoning.encrypted_content'],
  reasoning:{effort:run.effort},instructions:instructions+'\n当前本地日期 '+run.date+'。'+steering,
  input:run.input,tools,parallel_tool_calls:false,tool_choice:replyOnly?'none':'auto'};
}

function answerOf(output){
 return output.flatMap(item=>item.type==='message'?item.content:[])
  .map(part=>part.type==='output_text'?part.text:part.type==='refusal'?part.refusal:'').join('\n').trim();
}

function parseCall(call){
 const args=JSON.parse(call.arguments);
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('工具参数需要 JSON 对象');
 return args;
}

function sameWrite(prior,args,tool){
 return prior?.write&&prior.tool===tool&&prior.signature===hash(stable(args))&&changed(prior.result);
}

export async function runAgent(run,{request,dispatch,save,additions=()=>[],onStep=()=>{},signal,replyOnly=false,withLock=true}){
 const operation=async()=>{
  const raise=()=>{run.effort=effortLevels[Math.min(effortLevels.indexOf(run.effort)+1,2)];};
  const admit=async()=>{
   const queued=await additions();
   if(!queued.length)return false;
   for(const item of queued){
    run.messages.push(item.text);
    run.attachments.push(...item.attachments);
    run.input.push(userMessage([inputText(item.text||'本轮补充附件'),...item.attachments.map(row=>row.input)]));
   }
   run.stalled=0;
   await save(run);
   return true;
  };
  for(;;){
   signal?.throwIfAborted();
   if(run.phase==='done')return run;
   if(run.phase==='model'){
    await admit();
    if(run.turns>=turnLimit)throw Error('本轮已达到运行保护上限，已保留回执，可续跑。');
    if(run.stalled>=stalledLimit)throw Error('工具连续未取得新结果，已保留回执，可补充信息或续跑。');
    const response=await request(run,{replyOnly});
    if(response?.status!=='completed'||!Array.isArray(response.output))throw Error('模型响应未完成，可继续本轮。');
    const output=response.output;
    const calls=output.filter(item=>item.type==='function_call');
    if(!calls.every(validCall)||new Set(calls.map(call=>call.call_id)).size!==calls.length)throw Error('模型工具调用编号异常。');
    run.turns++;
    run.input.push(...output);
    if(replyOnly&&calls.length)throw Error('仅重试回复时收到了工具调用。');
    if(!calls.length){
     if(await admit())continue;
     const final=answerOf(output);
     if(!final)throw Error('模型没有给出可以显示的回复。');
     run.reply=final;run.phase='done';
     await save(run);
     return run;
    }
    run.calls=calls;run.index=0;run.phase='tools';
    await save(run);
   }
   while(run.index<run.calls.length){
    signal?.throwIfAborted();
    const call=run.calls[run.index];
    const hadSteering=run.steering.length>0||(await additions({peek:true})).length>0;
    let result,signature,write=dispatch.isWrite(call.name);
    try{
     const args=parseCall(call);
     signature=hash(stable(args));
     const copies=run.receipts.filter(row=>row.tool===call.name&&row.signature===signature);
     const previous=copies.find(row=>sameWrite(row,args,call.name));
     if(previous)result={...previous.result,replayed:true};
     else if(hadSteering&&write)result={status:'superseded',reason:'收到本轮补充，请根据最新指令重新判断这项写入。'};
     else if(copies.length>=repeatedLimit)result={status:'blocked',reason:'相同参数的调用已多次执行，请更换参数或说明未解决事项。'};
     else {
      onStep(call.name);
      result=await dispatch(call.name,args,{run,operationId:run.id+':'+hash(call.name+'\n'+stable(args)),signal});
     }
    }catch(error){
     if(signal?.aborted)throw error;
     result={status:'error',reason:String(error.message??error)};
    }
    if(!result)result={status:'error',reason:'工具没有返回结果'};
    const progressed=!result.replayed&&['ok','saved','undone'].includes(result.status)&&
     !run.receipts.some(row=>row.tool===call.name&&row.signature===signature&&stable(row.result)===stable(result));
    run.stalled=progressed?0:run.stalled+1;
    if(['blocked','error','conflict'].includes(result.status))raise();
    run.receipts.push({callId:call.call_id,tool:call.name,signature,write,result});
    run.input.push(toolResult(call,result));
    run.index++;
    await save(run);
   }
   delete run.calls;run.phase='model';
   await save(run);
  }
 };
 if(withLock&&globalThis.navigator?.locks)return navigator.locks.request('airplane-agent:'+run.id,{ifAvailable:true},lock=>{
  if(!lock)throw Error('这条消息正在另一个页面中处理');
  return operation();
 });
 return operation();
}
