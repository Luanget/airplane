import {markdownStream,renderMarkdown} from './markdown.mjs';
import {localClock,localDate} from '../calendar.mjs';
import {makeMedicalAttachment} from '../health/medical.mjs';
import {jpeg} from '../health/assistant.mjs';
import {hash,stable} from '../health/sync-source.mjs';
import {createAgentRun,nativeRequest,runAgent} from './agent-loop.mjs';
import {agentInstructions,createAgentTools} from './agent-tools.mjs';
import {advanceModelPolicy,planNativeModel} from './models.mjs';
import {requestResponses} from './client.mjs';
import {modelRates} from './usage.mjs';
import {identifyAttachments} from './conversation-evidence.mjs';
import {auditSafe,executionDetails,inputAudit} from './audit.mjs';
import {failureKind} from './task-log.mjs';
import {currentSources} from './evidence.mjs';

const draftKey='airplane-agent-composer-v1';
const hasSavedChanges=run=>run.receipts?.some(row=>['saved','undone'].includes(row.result.status));
const labelFor=(text,count)=>[text,count?'（附 '+count+' 个文件）':''].filter(Boolean).join(' ');

async function attachmentInputs(imageFiles,reportFiles){
 const attachments=[];
 for(const file of [...imageFiles,...reportFiles]){
  const original=reportFiles.includes(file)?await makeMedicalAttachment(file):null;
  const data=original?.type==='application/pdf'?'data:application/pdf;base64,'+original.data:await jpeg(file);
  const bytes=new TextEncoder().encode(data);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(attachments.some(row=>row.key===digest))continue;
  const input=original?.type==='application/pdf'?{type:'input_file',filename:'selected-report.pdf',file_data:data}:
   {type:'input_image',image_url:data,detail:'auto'};
  attachments.push({key:digest,input,name:file.name,...(original?{original}:{})});
 }
 return attachments;
}

export function mountAgentChat({book,journal,workspace,composer,review,stop,retry,replyRetry,steerLabel,transcript,thread,context,trace,
 status,onUser,onFinal,onError,onQueue,onKey,resetPhoto,keepThreadScroll,messageNode}){
 const steer=steerLabel.querySelector('input'),tools=createAgentTools(workspace,{book,journal,authorized:run=>run.allowRead});
 let current=null,submitting=false,restoring=false,restoredAttachments=[],attachmentRevision=0;
 const active=ticket=>book.current?.id===ticket.threadId;
 const ticketFor=()=>({threadId:book.current.id,id:book.current.pending.id,operationId:book.current.pending.id});
 const persistDraft=()=>{try{workspace.finance.setItem(draftKey,composer.elements.text.value);}catch{}};
 composer.elements.text.addEventListener('input',persistDraft);
 async function captureDraftAttachments(){
  const revision=++attachmentRevision;
  try{
   const attachments=await attachmentInputs([...composer.elements.image.files],[...composer.elements.medicalFiles.files]);
   if(revision!==attachmentRevision)return;
   restoredAttachments=attachments;
   await journal.saveRun({id:'draft:composer',attachments});
  }catch(error){onError(error);}
 }
 for(const field of [composer.elements.image,composer.elements.medicalFiles])field.addEventListener('change',()=>void captureDraftAttachments());
 composer.elements.allowRead.addEventListener('change',()=>{
  if(current&&!composer.elements.allowRead.checked){current.run.allowRead=false;void journal.saveRun(current.run);}
 });
 async function clearDraftAttachments(){
  attachmentRevision++;restoredAttachments=[];
  await journal.removeRun('draft:composer');
 }
 async function applyDraft(){
  composer.elements.text.value=workspace.finance.getItem(draftKey)??'';
  const revision=attachmentRevision;
  const draft=await journal.readRun('draft:composer').catch(()=>null);
  if(revision!==attachmentRevision)return;
  restoredAttachments=draft?.attachments??[];
  const attachment=composer.querySelector('[data-attachment]');
  if(restoredAttachments.length&&attachment&&!attachment.textContent){
   attachment.textContent='已恢复 '+restoredAttachments.length+' 个附件';
   const remove=composer.querySelector('[data-remove-photo]');
   if(remove)remove.hidden=false;
  }
 }
 function showQueue(){
  onQueue(book.current?.agentQueue??[]);
 }
 const writeStatus=(id,value,error)=>trace(id,{type:'status',status:value,failure:failureKind(error)});
 const removeReview=()=>{review.hidden=true;review.replaceChildren();review.onsubmit=null;};
 function openLog(row,message){
  const summary=document.createElement('details'),title=document.createElement('summary'),body=document.createElement('pre');
  title.textContent=message;
  body.textContent=JSON.stringify(row.result.detail??row.result.reason,null,2);
  summary.append(title,body);return summary;
 }
 function unresolved(run){
  return run.receipts.filter((row,index)=>row.result.status==='review'&&
   !run.receipts.slice(index+1).some(later=>later.tool===row.tool&&later.signature===row.signature)&&!run.skippedReview?.includes(row.callId));
 }
 function bindReview(run,ticket){
  const rows=unresolved(run);
  if(!rows.length||!active(ticket))return false;
  removeReview();
  book.checkpoint(ticket,run.reply);
  review.hidden=false;
  const output=document.createElement('div');renderMarkdown(output,run.reply);review.append(output);
  for(const row of rows){
   const confirmation=document.createElement('button'),skip=document.createElement('button'),actions=document.createElement('div');
   confirmation.type=skip.type='button';confirmation.className='primary-button';skip.className='text-button';
   confirmation.textContent='确认此项';skip.textContent='跳过此项';actions.className='chat-actions';
   actions.append(confirmation,skip);
   review.append(openLog(row,row.result.reason??'待确认的操作'),actions);
   confirmation.onclick=async()=>{
    disableReview(true);
    try{
     const original=run.input.find(item=>item.type==='function_call'&&item.call_id===row.callId);
     const params=JSON.parse(original.arguments);
     const op=run.id+':'+hash(original.name+'\n'+stable(params));
     const result=await tools(original.name,params,{run,operationId:op,confirmed:true});
     row.result=result;run.phase='model';run.stalled=0;
     run.input.push({role:'user',content:'客户端确认了 '+original.name+'，本机真实回执：'+JSON.stringify(result)+'。请更新答复。'});
     await journal.saveRun(run);
     await trace(run.id,{type:'confirm'});
     removeReview();await processRun(run,ticket);
    }catch(error){onError(error);disableReview(false);}
   };
   skip.onclick=async()=>{
    disableReview(true);
    try{
     (run.skippedReview??=[]).push(row.callId);
     row.result={...row.result,status:'skipped',reason:'用户跳过了该项待确认操作，未写入账本。'};
     run.input.push({role:'user',content:'客户端跳过了待确认操作 '+row.tool+'（'+row.callId+'），该项未写入。'});
     const last=!unresolved(run).length;
     if(last){run.phase='model';run.replyOnly=true;run.stalled=0;run.turns=0;}
     await journal.saveRun(run);
     if(last){removeReview();await processRun(run,ticket,{replyOnly:true});}
     else bindReview(run,ticket);
    }catch(error){onError(error);disableReview(false);}
   };
  }
  return true;
 }
 function disableReview(value){
  for(const button of review.querySelectorAll('button'))button.disabled=value;
 }
 async function finish(run,ticket,preview=transcript.querySelector('[data-pending-reply]')){
  const notes=run.receipts.map(({tool,result})=>({
   tool,status:result.status,reason:result.reason,receipt:result.receipt??null,
   ...(result.habit?{habitId:result.habit.id}:{}),...(result.data?.usedHabitIds?{usedHabitIds:result.data.usedHabitIds}:{}),
   ...(result.status==='conflict'&&result.details?.violations?{violations:result.details.violations}:{})
  }));
  const source=notes.length?{label:'本轮工具记录 · '+notes.length+' 步',text:JSON.stringify(notes,null,2)}:null;
  const undo=run.receipts.flatMap(({result})=>result.replayed?[]:(result.undo?[result.undo]:result.undos??[]))
   .map(token=>({...token,label:token.kind==='meal_plan'?'计划改动':token.kind==='stock_receipt'?'入库':'操作'}));
  const privateMedical=run.attachments.some(row=>row.original)||run.receipts.some(row=>row.tool.includes('medical'));
  const uploaded=run.attachments.filter(row=>!row.reused);
  const media=run.attachmentGroup??(uploaded.length&&!uploaded[0].id?{id:'media:'+run.id,count:uploaded.length}:null);
  if(media&&!media.files)await journal.saveRun({id:media.id,attachments:uploaded});
  if(book.finish(ticket,run.reply,source,null,{agentUndo:undo,native:true,privateMedical,media,taskId:run.id})){
   const failed=run.receipts.flatMap(row=>row.result.substeps??[row.result]).some(row=>['conflict','error','blocked','pending'].includes(row.status));
   await writeStatus(run.id,failed?'partial':'done');
   try{tools.notePeriodRecap(run);}catch{/* Bookkeeping does not affect a saved response. */}
   await journal.removeRun(run.id);
   if(active(ticket))keepThreadScroll(()=>{
    removeReview();retry.hidden=true;replyRetry.hidden=true;onFinal(run.reply,source,undo,media,run.id,preview);status('');
   });
  }
 }
 async function processRun(run,ticket,{replyOnly=false}={}){
  if(current)return;
  if(run.phase==='done'){
   if(!bindReview(run,ticket))await finish(run,ticket);
   void next();
   return;
  }
  const controller=new AbortController(),state={ticket,run,controller,steers:[],reported:new Set()};
  current=state;
  keepThreadScroll(()=>{steerLabel.hidden=false;stop.hidden=false;retry.hidden=true;replyRetry.hidden=true;});
  await trace(run.id,{type:'start',route:'responses-tools',threadId:ticket.threadId});
  let partial=book.current?.pending?.partial??'',writtenAt=0;
  const previous=transcript.querySelector('[data-pending-reply]');
  const live=previous??messageNode('assistant','');
  const runningDetails=executionDetails(journal,run.id,'本次执行详情');
  keepThreadScroll(()=>{
   live.classList.add('agent-live','streaming-reply');
   live.setAttribute('aria-live','off');
   delete live.dataset.pendingReply;
   live.hidden=!partial;
   if(!previous)transcript.insertBefore(live,transcript.querySelector('[data-queued-job]'));
   if(active(ticket))live.after(runningDetails);
  });
  const stream=markdownStream(live.querySelector('.chat-bubble'),thread,reply=>{live.hidden=!reply;});
  const updatePartial=reply=>{
   if(!active(ticket))return;
   partial=reply;stream.update(reply);
   if(Date.now()-writtenAt>600){writtenAt=Date.now();try{book.checkpoint(ticket,reply);}catch{}}
  };
  try{
   await runAgent(run,{dispatch:tools,replyOnly:replyOnly||run.replyOnly===true,signal:controller.signal,
    save:async value=>{
     await journal.saveRun(value);
     for(const row of value.receipts){
      const marker=row.callId+':'+row.result.status;
      if(state.reported.has(marker))continue;
      state.reported.add(marker);
      const call=value.input.find(item=>item.type==='function_call'&&item.call_id===row.callId);
      let parameters=null;
      try{parameters=auditSafe(JSON.parse(call?.arguments));}catch{}
      await trace(value.id,{type:'step',step:{id:row.callId,kind:row.tool,tool:row.tool,dependsOn:[],
       status:row.result.status,reason:row.result.reason,receipt:auditSafe(row.result.receipt??null),parameters,
       result:auditSafe(row.result),undos:row.result.undo?[row.result.undo]:row.result.undos??[],
       ...(row.result.habit?{memory:[row.result.habit.id]}:{}),
       ...(row.result.data?.usedHabitIds?{usedHabits:row.result.data.usedHabitIds}:{}),
       ...(row.tool==='load_skill'&&row.result.status==='ok'?{skill:row.result.data.id}:{})}});
      if(row.tool==='read_conversation_evidence'&&row.result.data?.attachments)
       await trace(value.id,{type:'media',files:row.result.data.attachments});
     }
    },
    additions:async({peek}={})=>{
     if(peek)return run.steering??[];
     const queued=[...(run.steering??[])];
     run.steering=[];
     return queued;
    },
    onStep:name=>{if(active(ticket))status(tools.isWrite(name)?'正在执行并核对本机账本…':'正在查询与计算…');},
    request:async(value,options)=>{
     if(active(ticket)){
      status('正在思考…');
     }
     const available=value.allowRead?tools.definitions:[];
     const facts=value.allowRead?tools.context(value):null;
     if(facts&&value.periodHint===undefined)value.periodHint=await tools.periodHint(value).catch(()=>null);
     if(facts&&value.periodHint)facts.previousCycle=value.periodHint;
     if(facts)await trace(value.id,{type:'context',...auditSafe(facts)});
     const prompt=agentInstructions+(facts?tools.instructions():'')+(facts?'\n当前启用的稳定习惯和工作流程：'+JSON.stringify(facts)+
      '\n本对话用户消息 ID（附短索引）：'+JSON.stringify(currentSources(value).map(({id,text,current})=>({id,current:!!current,text:text.slice(0,90)})))+
      '\n已附在本任务的附件 ID：'+value.attachments.map(row=>row.id??row.key).join('、'):'');
     if(advanceModelPolicy(value))await journal.saveRun(value);
     if(value.attachmentGroup)await trace(value.id,{type:'media',files:value.attachmentGroup.files.map(file=>({...file,groupId:value.attachmentGroup.id}))});
     const send=async(body,recovery)=>{
      const audit=inputAudit(value,body);
      let accepted=false;
      try{
       const result=await requestResponses(body,{signal:controller.signal,rates:modelRates(workspace.finance),onReply:updatePartial,
        onTool:()=>updatePartial(''),onMetric:request=>trace(value.id,{type:'request',request})});
       accepted=true;return result;
      }finally{await trace(value.id,{type:'input',input:{...audit,accepted,...(recovery?{recovery}:{})}});}
     };
     const body=nativeRequest(value,prompt,available,options);
     try{return await send(body);}
     catch(error){
      if(!error.invalidReplay||!body.input.some(item=>['reasoning','function_call','function_call_output'].includes(item.type)))throw error;
      controller.signal.throwIfAborted();
      value.replayFrom=value.input.length;
      await journal.saveRun(value);
      if(active(ticket))status('正在从已核对的执行回执继续…');
      return send(nativeRequest(value,prompt,available,options),'responses_replay_checkpoint');
     }
    }});
   stream.cancel();
   if(!keepThreadScroll(()=>bindReview(run,ticket)))await finish(run,ticket,live);
  }catch(error){
   if(partial)try{book.checkpoint(ticket,partial);}catch{}
   await writeStatus(run.id,'pending',error);
   if(active(ticket)){
    keepThreadScroll(()=>{
     if(partial){
      renderMarkdown(live.querySelector('.chat-bubble'),partial);
      live.hidden=false;live.dataset.pendingReply='';live.classList.remove('agent-live','streaming-reply');live.removeAttribute('aria-live');
     }
     retry.textContent='继续未完成任务';retry.hidden=false;
     replyRetry.hidden=run.phase!=='model'||!hasSavedChanges(run);
     onError(error);
     if(error.status===400&&hasSavedChanges(run))status(error.message+' 本轮已有保存或撤销回执，可在执行详情核对。');
    });
    if(error.status===401||error.message.includes('导入自己的密钥'))onKey?.();
   }
  }finally{
   stream.cancel();current=null;
   keepThreadScroll(()=>{
    if(live.classList.contains('agent-live'))live.remove();
    runningDetails.remove();stop.hidden=true;steerLabel.hidden=true;steer.checked=false;showQueue();
   });
   if(!book.current?.pending)void next();
  }
 }

 async function next(){
  if(current||restoring||book.current?.pending)return;
  const entry=book.current?.agentQueue?.[0];
  if(!entry)return;
  const ticket=book.startAgent(entry.id);
  if(!ticket)return;
  keepThreadScroll(()=>{showQueue();onUser(entry.label);});
  try{
   const seed=await journal.readRun(entry.id);
   if(!seed)throw Error('找不到该任务的本机附件或恢复点');
   const {turns,sources,summary}=context();
   const history=turns.at(-1)?.role==='user'?turns.slice(0,-1):turns;
   const run=createAgentRun({...seed,threadId:ticket.threadId,history,summary,sources:sources?.filter(row=>row.id!==seed.messageId)});
   await journal.saveRun(run);
   await processRun(run,ticket);
  }catch(error){onError(error);retry.hidden=false;}
 }
 async function submit(){
  if(submitting)return;
  const text=composer.elements.text.value.trim(),images=[...composer.elements.image.files],reports=[...composer.elements.medicalFiles.files];
  if(!text&&!images.length&&!reports.length&&!restoredAttachments.length){status('请输入消息或选取附件');return;}
  submitting=true;
  try{
   const attachments=images.length||reports.length?await attachmentInputs(images,reports):restoredAttachments;
   const label=labelFor(text,attachments.length);
   if(steer.checked&&current&&active(current.ticket)){
    const messageId=crypto.randomUUID(),{files,group}=identifyAttachments(attachments,'media:'+messageId);
    if(group)await journal.saveRun({id:group.id,attachments:files});
    current.run.steering.push({text,attachments:files,messageId});
    await journal.saveRun(current.run);
    book.addAgentSteer(current.ticket,label,{id:messageId,date:current.run.date,attachmentGroup:group});
    onUser(label);status('已收到本轮补充');
   }else{
    const id=crypto.randomUUID();
    const {files,group}=identifyAttachments(attachments,'media:'+id),date=localDate();
    if(group)await journal.saveRun({id:group.id,attachments:files});
    await journal.saveRun({id,messageId:id,...planNativeModel(workspace.finance,{text,attachments:files}),text,date,clock:localClock(),attachments:files,attachmentGroup:group,
     allowRead:composer.elements.allowRead.checked});
    book.enqueueAgent({id,label,messageId:id,date,attachmentGroup:group});
    showQueue();
   }
   composer.elements.text.value='';persistDraft();resetPhoto();await clearDraftAttachments();
   void next();
  }catch(error){onError(error);}
  finally{submitting=false;}
 }
 async function restore({resume=false,replyOnly=false}={}){
  if(restoring||current)return;
  if(!resume)await applyDraft();
  showQueue();
  if(!book.current?.pending?.request?.native){void next();return;}
  restoring=true;
  const ticket=ticketFor();
  try{
   const run=await journal.readRun(ticket.id);
   if(!run)throw Error('本次任务缺少本机恢复点');
   run.threadId??=ticket.threadId;
   if(run.phase&&!run.userSources){
    const {sources}=context();
    run.userSources=[...(sources??[]).filter(row=>row.id!==ticket.id),
     ...(run.messages??[]).map((text,index)=>({id:index?ticket.id+':steer:'+index:ticket.id,text,date:run.date,current:true}))];
   }
   retry.textContent='继续未完成任务';
   if(run.phase==='done'){
    if(!bindReview(run,ticket))await finish(run,ticket);
    return;
   }
   if(resume){
    run.stalled=0;run.turns=0;
    if(!run.phase){
     const {turns,sources,summary}=context();
     const history=turns.at(-1)?.role==='user'?turns.slice(0,-1):turns;
     const staged=createAgentRun({...run,threadId:ticket.threadId,history,summary,sources:sources?.filter(row=>row.id!==run.messageId)});
     await journal.saveRun(staged);
     await processRun(staged,ticket);
    }else await processRun(run,ticket,{replyOnly});
   }else{
    retry.hidden=false;
    replyRetry.hidden=run.phase!=='model'||!hasSavedChanges(run);
   }
  }catch(error){onError(error);}
  finally{restoring=false;if(!book.current?.pending)void next();}
 }
 replyRetry.onclick=()=>void restore({resume:true,replyOnly:true});
 return {submit,restore,clearDraftAttachments,stop:()=>current?.controller.abort(),undo:tools.undo,get running(){return !!current;}};
}
