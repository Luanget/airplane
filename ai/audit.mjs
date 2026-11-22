const credentials=/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/gi;
const hiddenFields=new Set(['encrypted_content','authorization','apiKey','api_key','bearer','image_url','file_data']);
export function auditSafe(value){
 if(typeof value==='string')return value.replace(credentials,'[凭证已省略]').replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi,'[附件内容在本机单独保存]');
 if(Array.isArray(value))return value.map(auditSafe);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!hiddenFields.has(key))
  .map(([key,item])=>[key,auditSafe(item)]));
 return value;
}

export function inputAudit(run,body){
 const files=new Map(run.attachments.map(row=>[row.input.image_url??row.input.file_data,row.id??row.key]));
 const messages=body.input.filter(item=>item.role&&item.type!=='reasoning').map(({role,content})=>({role,
  content:typeof content==='string'?auditSafe(content):content?.flatMap(part=>{
   if(['input_image','input_file'].includes(part.type))return [{attachmentId:files.get(part.image_url??part.file_data)??'附件',type:part.type}];
   return part.type==='input_text'||part.type==='output_text'?[auditSafe(part.text)]:[];
  })??[]}));
 return {model:body.model,effort:body.reasoning?.effort,modelPolicy:run.modelPolicy,instructions:auditSafe(body.instructions),messages,
  toolResults:body.input.filter(row=>row.type==='function_call_output').map(row=>row.call_id),
  attachments:[...new Set(messages.flatMap(row=>Array.isArray(row.content)?row.content.map(part=>part?.attachmentId).filter(Boolean):[]))]};
}

export function executionDetails(journal,taskId,label='执行详情'){
 const make=(tag,text,css)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(css)node.className=css;return node;};
 const details=make('details',null,'chat-source execution-details');
 const summary=make('summary',label),body=make('div',null,'execution-detail-body');details.append(summary,body);
 const showJson=(heading,value)=>{
  const item=make('details',null,'execution-json'),pre=make('pre');
  item.append(make('summary',heading),pre);
  item.ontoggle=()=>{if(item.open&&!pre.textContent)pre.textContent=JSON.stringify(value,null,2);};
  return item;
 };
 const names={saved:'已保存',ok:'已完成',review:'待确认',conflict:'需核对',blocked:'受阻',pending:'可重试',error:'失败',
  done:'已完成',partial:'部分完成',skipped:'已跳过',undone:'已撤销',running:'执行中',superseded:'已被补充替代'};
 details.ontoggle=async()=>{
  if(!details.open)return;
  try{
   const task=await journal.readTask(taskId);
   if(!task){body.replaceChildren(make('p','本机没有这次执行详情。'));return;}
   const status=names[task.status]??task.status;
   const models=[...new Set((task.inputs??[]).map(row=>row.model+' · '+row.effort))].join(' / ');
   body.replaceChildren(make('p',[status,models,task.attempts>1?task.attempts+' 次执行':''].filter(Boolean).join(' · '),'execution-summary'));
   const decisions=[...new Set((task.inputs??[]).map(row=>row.modelPolicy?.reason).filter(Boolean))];
   if(decisions.length)body.append(make('p',decisions.join(' → ')));
   if(task.failure)body.append(make('p','失败原因：'+task.failure));
   if(task.context)body.append(showJson('发送的习惯与可用 Skills',task.context));
   const marked=new Map((task.media??[]).map(row=>[row.id,row]));
   for(const input of task.inputs??[])for(const id of input.attachments??[])marked.set(id,
    {...marked.get(id),id,attempted:true,sent:input.accepted||marked.get(id)?.sent});
   if(marked.size){
    const files=make('ul',null,'execution-files');
    for(const file of marked.values()){
     const archive=file.groupId?await journal.readRun(file.groupId).catch(()=>null):null;
     const availability=file.groupId?(archive?'本机可用':'本机已不可用'):(file.state==='unavailable'?'本机已不可用':'');
     files.append(make('li',[(file.name??file.id),(file.sent?'已发给模型':file.attempted?'发送未确认':'未发送'),availability].filter(Boolean).join(' · ')));
    }
    body.append(files);
   }
   const list=make('ol',null,'execution-steps');
   for(const step of task.steps??[]){
    const item=make('li');
    item.append(make('strong',(step.tool??step.kind)+' · '+(names[step.status]??step.status)));
    if(step.reason)item.append(make('p',step.reason));
    if(step.receipt?.revision)item.append(make('p','账本版本 '+step.receipt.revision));
    item.append(showJson('参数、依据和回执',{parameters:step.parameters,result:step.result,receipt:step.receipt,reason:step.reason}));list.append(item);
   }
   if(list.children.length)body.append(list);
   if(task.inputs?.length)body.append(showJson('模型收到的文字、附件引用及调用上下文',task.inputs));
  }catch(error){body.replaceChildren(make('p','读取失败：'+error.message));}
 };
 return details;
}
