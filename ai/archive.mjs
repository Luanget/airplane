import {auditSafe} from './audit.mjs';
import {attachmentGroups} from './conversation-evidence.mjs';
import {MEMORY_KEY} from './memory.mjs';
import {THREADS_KEY,threadBook} from './threads.mjs';
import {taskJournal} from './task-log.mjs';

export const AI_ARCHIVE='airplane-ai-audit-v1';
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=300;
const validGroup=group=>!group||validId(group.id)&&group.id.startsWith('media:')&&Number.isSafeInteger(group.count)&&
 group.count>0&&group.count<=200&&(!group.files||Array.isArray(group.files)&&group.files.length===group.count&&
  group.files.every((file,index)=>file.id===group.id+':'+(index+1)));
const recordedMessage=({pending,agentUndo,healthActionId,...row})=>auditSafe(row);
const readArray=(store,key)=>{try{const rows=JSON.parse(store.getItem(key));return Array.isArray(rows)?rows:[];}catch{return [];}};

export async function exportAiArchive(account,{threadId=null,attachments=true,medicalAttachments=true}={}){
 const journal=taskJournal(account),store=account.finance;
 const threads=threadBook(store).list().filter(thread=>!threadId||thread.id===threadId);
 const ids=new Set(threads.map(row=>row.id));
 const tasks=(await journal.list()).filter(task=>ids.has(task.threadId));
 const media=[];
 if(attachments)for(const group of threads.flatMap(attachmentGroups)){
  const row=await journal.readRun(group.id);
  if(row?.attachments?.length&&(medicalAttachments||!row.attachments.some(file=>file.original)))media.push({id:group.id,attachments:row.attachments.map(({id,key,input,original})=>
   ({id,key,input:{...input,...(input.filename?{filename:auditSafe(input.filename)}:{})},...(original?{original:{...original,name:auditSafe(original.name)}}:{})}))});
 }
 return {format:AI_ARCHIVE,version:1,threads:threads.map(row=>({id:row.id,title:auditSafe(row.title),updatedAt:row.updatedAt,
  messages:row.messages.map(recordedMessage)})),media,tasks:auditSafe(tasks),habits:auditSafe(readArray(store,MEMORY_KEY))};
}

export function validateAiArchive(archive){
 if(archive?.format!==AI_ARCHIVE||archive.version!==1||!['threads','tasks','media','habits'].every(key=>Array.isArray(archive[key])))
  throw Error('无法识别 AI 对话备份。');
 const ids=new Set();
 for(const thread of archive.threads){
  if(!validId(thread?.id)||ids.has(thread.id)||typeof thread.title!=='string'||!Array.isArray(thread.messages)||
   !thread.messages.every(row=>['user','assistant'].includes(row?.role)&&typeof row.text==='string'&&
    validGroup(row.media)&&validGroup(row.attachmentGroup)))throw Error('对话备份的消息或附件目录格式无效。');
  ids.add(thread.id);
 }
 if(!archive.tasks.every(task=>validId(task?.id)&&ids.has(task.threadId)&&Array.isArray(task.requests)&&Array.isArray(task.steps))||
  !archive.habits.every(row=>validId(row?.id)&&typeof row.name==='string'&&typeof row.text==='string'))throw Error('执行日志或长期习惯格式无效。');
 const referenced=new Set(archive.threads.flatMap(attachmentGroups).map(row=>row.id));
 const mediaIds=new Set();
 for(const row of archive.media){
  if(!validId(row?.id)||!row.id.startsWith('media:')||!referenced.has(row.id)||mediaIds.has(row.id)||!Array.isArray(row.attachments)||!row.attachments.every(file=>{
   const input=file?.input;
   return /^[a-f0-9]{64}$/i.test(file?.key??'')&&
    (input?.type==='input_image'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(input.image_url??'')||
     input?.type==='input_file'&&/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/i.test(input.file_data??''));
  }))throw Error('备份中的附件引用或文件格式无效。');
  mediaIds.add(row.id);
 }
 return archive;
}

export async function restoreAiArchive(account,input){
 const archive=validateAiArchive(input),journal=taskJournal(account),store=account.finance;
 for(const row of archive.media)for(const file of row.attachments){
  const bytes=new TextEncoder().encode(file.input.image_url??file.input.file_data);
  const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(key!==file.key)throw Error('附件 '+(file.id??row.id)+' 未通过完整性校验。');
 }
 const original=store.getItem(THREADS_KEY);
 const current=threadBook(store).list(),threadIds=new Set(current.map(row=>row.id));
 const added=archive.threads.filter(row=>!threadIds.has(row.id)).map(row=>({id:row.id,title:auditSafe(row.title),
  updatedAt:row.updatedAt,messages:row.messages.map(recordedMessage)}));
 for(const row of archive.media){if(!await journal.readRun(row.id))await journal.saveRun(row);}
 for(const task of archive.tasks)await journal.importTask(auditSafe(task));
 if(store.getItem(THREADS_KEY)!==original)throw Error('对话在导入期间已更改，请重新导入。');
 const active=JSON.parse(original??'null')?.active??null;
 if(added.length)store.setItem(THREADS_KEY,JSON.stringify({active:active??added[0].id,threads:[...current,...added]}));
 const habits=readArray(store,MEMORY_KEY),known=new Set(habits.flatMap(row=>[row.id,row.topic]).filter(Boolean));
 const newHabits=archive.habits.filter(row=>!known.has(row.id)&&(!row.topic||!known.has(row.topic)));
 if(newHabits.length)store.setItem(MEMORY_KEY,JSON.stringify([...habits,...auditSafe(newHabits)]));
 return {added:added.length,attachments:archive.media.length};
}
