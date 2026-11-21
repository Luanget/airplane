import {PROFILE_ID,compareProfileVersion,preferenceTopic} from './health-profile.mjs';
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
  const previous=id===PROFILE_ID?null:rows.find(row=>row.id===id)??null;
  if(action==='add'?id!==null:!previous)throw Error('找不到指定的记忆条目');
  const updated=action==='delete'?null:{...previous,...changes,
   id:previous?.id??crypto.randomUUID(),enabled:changes.enabled??previous?.enabled??true,
   priority:Number(changes.priority??previous?.priority??50),origin:'manual',updatedAt:new Date().toISOString()};
  if(updated){
   updated.text=String(updated.text??'').trim();
   updated.name=String(updated.name??'').trim()||updated.text.slice(0,24);
   if(!updated.text)throw Error('请填写记忆内容');
   if(!Number.isInteger(updated.priority)||updated.priority<0||updated.priority>100)throw Error('优先级请输入 0 至 100 的整数');
   updated.topic=previous?.topic??preferenceTopic(updated.name+' '+updated.text);
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
   if(!/平时|通常|常常|总是|以后|习惯|长期|喜欢|偏好|默认|记住|一直|不再|优先|每[天周月]|归为/.test(evidence)||
    /如果|假如|假设|例如|比如|举例|这次|仅今天|光这次|[？?]/.test(evidence))continue;
   if(/sk-[\w-]{12,}|\b(?:api[ -]?key|password|bearer)\b|密码|密钥|验证码|身份证/i.test([name,text,evidence].join(' ')))continue;
   const title=normalize(name).trim(),content=normalize(text).trim();
   if(rows.some(row=>normalize(row.text).trim()===content))continue;
   const topic=preferenceTopic([name,text,evidence].join(' '));
   const related=rows.filter(row=>row.id!==PROFILE_ID&&(normalize(row.name).trim()===title||topic&&row.topic===topic));
   if(related.length>1||related[0]?.enabled===false)continue;
   const row=related[0];
   const fields={text:text.trim(),topic:topic??row?.topic??null,updatedAt:new Date().toISOString(),origin:'conversation',priority:Math.max(45,row?.priority??0)};
   if(row)Object.assign(row,fields);
   else rows.push({id:crypto.randomUUID(),name:name.trim(),enabled:true,...fields});
   saved.push(row?.name??name.trim());
  }
  if(saved.length){
   if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已在另一页面更新。');
   store.setItem(MEMORY_KEY,JSON.stringify(rows));
  }
  return [...new Set(saved)];
 }
 function importProfile(profile){
  const {raw,rows}=read();
  const previous=rows.find(row=>row.id===PROFILE_ID);
  if(previous?.version&&compareProfileVersion(profile.version,previous.version)<0)throw Error('所选规则版本已过期');
  const existing=new Map(rows.map(row=>[row.id,row]));
  const added=profile.entries.filter(row=>!existing.has(row.id)||existing.get(row.id).origin==='health-profile')
   .map(row=>({...row,enabled:existing.get(row.id)?.enabled??true}));
  const ids=new Set(added.map(row=>row.id));
  const next=rows.filter(row=>row.id!==PROFILE_ID&&!ids.has(row.id)&&row.origin!=='health-profile').map(row=>
   row.origin!=='manual'&&row.origin!=='conversation'&&(/^l-(data|record|stock|progress|meals)$/.test(row.id)||
   row.id==='legacy-preference'&&/主账|TDEE|封账|核心规则|历史规则/i.test(row.text))?
   {...row,enabled:false,archivedProfile:true}:row);
  next.push(...added,{id:PROFILE_ID,name:'健康规则版本',text:'现行核心规则及来源',enabled:false,
    version:profile.version,ruleIds:profile.ruleIds});
  return ()=>{if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已变化，请重新预览');store.setItem(MEMORY_KEY,JSON.stringify(next));};
 }
 return {
  list:()=>read().rows.filter(row=>row.id!==PROFILE_ID),profile:()=>read().rows.find(row=>row.id===PROFILE_ID)??null,
  prepare,rememberFromTurn,importProfile,
  relevant(text){
   const terms=keywords(text);
   const ranked=read().rows.filter(row=>row.enabled&&!row.archivedProfile).map(({name,text,priority,updatedAt,topic})=>{
    const title=keywords(name),body=keywords(text);
    const score=[...terms].reduce((n,term)=>n+(title.has(term)?2:body.has(term)?1:0),0);
    return {name,text,score,priority,updatedAt,topic};
   }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||(b.priority??0)-(a.priority??0)||String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')));
   let chars=0;const topics=new Set();
   return ranked.flatMap(({name,text,topic})=>{
    if(topic&&topics.has(topic))return [];
    if(topic)topics.add(topic);
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
  form.elements.priority.value=row?.priority??50;
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
   item.append(name,text);
   if(row.updatedAt){const when=document.createElement('small');when.textContent='优先级 '+(row.priority??50)+' · '+row.updatedAt.slice(0,10);item.append(when);}
   edit.type=remove.type='button';edit.className=remove.className='text-button';
   edit.textContent='编辑';edit.setAttribute('aria-label','编辑 '+row.name);
   remove.textContent='删除';remove.setAttribute('aria-label','删除 '+row.name);
   edit.onclick=()=>editor(row,item);
   remove.onclick=()=>{
    try{library.prepare(row.id,{},'delete').commit();update();onChange();status.textContent='已删除记忆。';}
    catch(err){status.textContent=err.message;}
   };
   actions.className='chat-actions';actions.append(edit,remove);item.append(actions);list.append(item);
  }
 }
 create.onclick=()=>editor(null,create);cancel.onclick=close;
 form.onsubmit=event=>{
  event.preventDefault();
  try{
   library.prepare(editing?.id??null,{name:form.elements.name.value,text:form.elements.text.value,
    enabled:form.elements.enabled.checked,priority:form.elements.priority.value},editing?'update':'add').commit();
   update();onChange();status.textContent='已保存记忆。';
  }catch(err){status.textContent=err.message;}
 };
 update();
 return update;
}
