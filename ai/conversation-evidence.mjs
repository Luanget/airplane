import {currentSources} from './evidence.mjs';

export function identifyAttachments(attachments,groupId){
 const files=attachments.map((row,index)=>({...row,id:groupId+':'+(index+1)}));
 return {files,group:files.length?{id:groupId,count:files.length,files:files.map(({id,input,name})=>
  ({id,type:input.type,name:name||input.filename||'照片'}))}:null};
}

export function attachmentGroups(thread){
 const groups=new Map();
 let user=null;
 for(const [index,message] of (thread?.messages??[]).entries()){
  if(message.role==='user')user={messageId:message.id??thread.id+':message:'+index,taskId:message.taskId??null};
  const group=message.attachmentGroup??message.media;
  if(group&&!groups.has(group.id)){
   const files=group.files??Array.from({length:group.count},(_,i)=>({id:group.id+':'+(i+1),name:'附件 '+(i+1),type:null}));
   groups.set(group.id,{...group,...user,files});
  }
 }
 return [...groups.values()];
}

export async function conversationEvidence(book,journal,run,{attachmentIds=[],limit=8}={}){
 const thread=book?.list().find(row=>row.id===run.threadId);
 const sources=currentSources(run);
 const messages=thread?thread.messages.flatMap((row,index)=>row.role==='user'&&!row.privateMedical?
  [{id:row.id??thread.id+':message:'+index,text:row.text,date:row.date??null}]:[]):sources;
 // Search/read is scoped to the active conversation and adds only user-authored evidence.
 const turns=messages.slice(-limit);
 if(run.userSources)for(const turn of turns)if(!sources.some(row=>row.id===turn.id))sources.push(turn);
 const listed=new Map(run.attachments.map(row=>[row.id,{id:row.id,source:'current',state:'attached',index:run.attachments.indexOf(row)+1}]));
 const groups=attachmentGroups(thread).filter(group=>group.files.some(file=>attachmentIds.includes(file.id))||
  group.messageId&&turns.some(row=>row.id===group.messageId));
 for(const group of groups){
  let stored;
  try{stored=await journal?.readRun(group.id);}catch{/* Keep the known attachment reference and report it as unavailable. */}
  for(const [index,file] of group.files.entries()){
   if(listed.has(file.id))continue;
   const item=stored?.attachments?.[index];
   let state=item?'local':'unavailable';
   if(item&&attachmentIds.includes(file.id)){
    run.attachments.push({...item,id:file.id,reused:true});
    (run.mediaDelivery??=[]).push(file.id);state='attached';
   }
   listed.set(file.id,{...file,groupId:group.id,messageId:group.messageId,taskId:group.taskId,source:'history',state,
    ...(state==='attached'?{index:run.attachments.length}:{})});
  }
 }
 for(const id of attachmentIds)if(!listed.has(id))listed.set(id,{id,state:'unavailable',reason:'这张附件已删除或不在本对话中。'});
 return {messages:turns,attachments:[...listed.values()]};
}
