import {migratedPreferences} from './skills.mjs';

export const MEMORY_KEY='airplane-ai-memory-v1';
const AUTO_MEMORY_KEY='airplane-ai-auto-memory-v1';
export const automaticMemoryEnabled=store=>store.getItem(AUTO_MEMORY_KEY)!=='off';
export function setAutomaticMemory(store,enabled){
 if(enabled)store.removeItem(AUTO_MEMORY_KEY);
 else store.setItem(AUTO_MEMORY_KEY,'off');
}
export const validMemory=value=>Array.isArray(value)&&value.every(row=>
 row&&typeof row.id==='string'&&typeof row.name==='string'&&typeof row.text==='string'&&typeof row.enabled==='boolean');

function normalize(text){
 return String(text??'').normalize('NFKC').toLowerCase();
}
function keywords(text){
 const words=normalize(text).match(/[a-z][a-z0-9]+|[\u3400-\u9fff]+/g)??[];
 return new Set(words.flatMap(word=>/^[a-z]/.test(word)?[word]:
  Array.from({length:Math.max(0,word.length-1)},(_,i)=>word.slice(i,i+2))));
}

export function memoryLibrary(store,legacyKey){
 function read(){
  const raw=store.getItem(MEMORY_KEY);
  if(raw!==null){
   const rows=JSON.parse(raw);
   if(!validMemory(rows))throw Error('本机记忆数据格式无效');
   return {raw,rows};
  }
  const rows=migratedPreferences(store,legacyKey);
  const migrated=JSON.stringify(rows);
  store.setItem(MEMORY_KEY,migrated);
  return {raw:migrated,rows};
 }
 function prepare(id,changes,action){
  const {raw,rows}=read();
  const previous=rows.find(row=>row.id===id)??null;
  if(action==='add'?id!==null:!previous)throw Error('找不到指定的记忆条目');
  const updated=action==='delete'?null:{...previous,...changes,
   id:previous?.id??crypto.randomUUID(),enabled:changes.enabled??previous?.enabled??true};
  if(updated){
   updated.text=String(updated.text??'').trim();
   updated.name=String(updated.name??'').trim()||updated.text.slice(0,24);
   if(!updated.text)throw Error('请填写记忆内容');
   if(rows.some(row=>row.id!==id&&normalize(row.text)===normalize(updated.text)))throw Error('已经记住这条内容');
  }
  const next=action==='add'?[...rows,updated]:rows.flatMap(row=>row.id!==id?[row]:updated?[updated]:[]);
  return {previous,updated,commit(){
   if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已更新，请重新打开或查询。');
   store.setItem(MEMORY_KEY,JSON.stringify(next));
  }};
 }
 function rememberFromTurn(updates,source){
  if(!automaticMemoryEnabled(store)||!updates?.length||
   /(?:(?:不要|别|不用)(?:把[^。！\n]{0,24})?(?:记|存|保存)|忘掉|忘记|不要保留)/.test(source))return [];
  const {raw,rows}=read();
  const saved=[];
  for(const update of updates){
   const {name,text,evidence}=update;
   if(typeof name!=='string'||typeof text!=='string'||typeof evidence!=='string'||
    !name.trim()||!text.trim()||!evidence.trim()||!source.includes(evidence))continue;
   if(/sk-[\w-]{12,}|\b(?:api[ -]?key|password|bearer)\b|密码|密钥|验证码|身份证/i.test([name,text,evidence].join(' ')))continue;
   const title=normalize(name).trim(),content=normalize(text).trim();
   if(rows.some(row=>normalize(row.text).trim()===content))continue;
   const related=rows.filter(row=>normalize(row.name).trim()===title);
   if(related.length>1||related[0]?.enabled===false)continue;
   const row=related[0];
   if(row)row.text=text.trim();
   else rows.push({id:crypto.randomUUID(),name:name.trim(),text:text.trim(),enabled:true});
   saved.push(row?.name??name.trim());
  }
  if(saved.length){
   if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已在另一页面更新。');
   store.setItem(MEMORY_KEY,JSON.stringify(rows));
  }
  return [...new Set(saved)];
 }
 return {
  list:()=>read().rows,prepare,rememberFromTurn,
  relevant(text){
   const terms=keywords(text);
   const ranked=read().rows.filter(row=>row.enabled).map(({name,text})=>{
    const title=keywords(name),body=keywords(text);
    const score=[...terms].reduce((n,term)=>n+(title.has(term)?2:body.has(term)?1:0),0);
    return {name,text,score};
   }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score);
   let chars=0;
   return ranked.flatMap(({name,text})=>{
    const remaining=1800-chars;
    if(remaining<=name.length)return [];
    const snippet=text.slice(0,remaining-name.length);
    chars+=snippet.length+name.length;
    return [{name,text:snippet}];
   });
  }
 };
}

export function mountMemorySettings(panel,library,onChange){
 const list=panel.querySelector('[data-memory-list]'),form=panel.querySelector('form');
 const create=panel.querySelector('[data-add-memory]'),cancel=panel.querySelector('[data-cancel-memory]');
 const status=panel.querySelector('output');
 let editing=null;
 function close(){
  form.hidden=true;editing=null;panel.querySelector('.assistant-panel-body').append(form);
 }
 function editor(row,anchor){
  close();editing=row;
  form.elements.name.value=row?.name??'';
  form.elements.text.value=row?.text??'';
  form.elements.enabled.checked=row?.enabled??true;
  status.textContent='';anchor.after(form);form.hidden=false;form.elements.text.focus();
 }
 function update(){
  close();
  const rows=library.list();
  list.replaceChildren();
  if(!rows.length){
   const empty=document.createElement('p');empty.textContent='长期偏好会显示在这里，也可以手动添加。';list.append(empty);
  }
  for(const row of rows){
   const item=document.createElement('div'),name=document.createElement('strong');
   const edit=document.createElement('button'),remove=document.createElement('button');
   const text=document.createElement('p'),actions=document.createElement('div');
   item.className='assistant-memory-item';name.textContent=row.name+(row.enabled?'':' · 已停用');text.textContent=row.text;
   edit.type=remove.type='button';edit.className=remove.className='text-button';
   edit.textContent='编辑';edit.setAttribute('aria-label','编辑 '+row.name);
   remove.textContent='删除';remove.setAttribute('aria-label','删除 '+row.name);
   edit.onclick=()=>editor(row,item);
   remove.onclick=()=>{
    try{library.prepare(row.id,{},'delete').commit();update();onChange();status.textContent='已删除记忆。';}
    catch(err){status.textContent=err.message;}
   };
   actions.className='chat-actions';actions.append(edit,remove);item.append(name,text,actions);list.append(item);
  }
 }
 create.onclick=()=>editor(null,create);cancel.onclick=close;
 form.onsubmit=event=>{
  event.preventDefault();
  try{
   library.prepare(editing?.id??null,{name:form.elements.name.value,text:form.elements.text.value,
    enabled:form.elements.enabled.checked},editing?'update':'add').commit();
   update();onChange();status.textContent='已保存记忆。';
  }catch(err){status.textContent=err.message;}
 };
 update();
 return update;
}
