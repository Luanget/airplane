import {PROFILE_ID,compareProfileVersion,preferenceTopic} from './health-profile.mjs';
import {migratedPreferences,migratedSkillIds} from './skills.mjs';

export const MEMORY_KEY='airplane-ai-memory-v1';
const AUTO_MEMORY_KEY='airplane-ai-auto-memory-v1';
export const automaticMemoryEnabled=store=>store.getItem(AUTO_MEMORY_KEY)!=='off';
export function setAutomaticMemory(store,enabled){
 if(enabled)store.removeItem(AUTO_MEMORY_KEY);
 else store.setItem(AUTO_MEMORY_KEY,'off');
}
const kinds=new Set(['rule','habit','fact','plan']);
const liveFacts=/余额|账面金额|剩余库存|目前库存|当前库存|现有库存|库存(?:还剩|是|有)|已花|体检(?:指标|结果)|检验(?:指标|结果)|实测血糖|(?:还剩|当前|目前).{0,8}\d+(?:\.\d+)?\s*(?:g|克|毫升|盒|瓶|包|元)/i;
export function memoryKind(row){
 if(row.id===PROFILE_ID||row.origin==='core-rule'||row.kind==='rule')return 'rule';
 if(row.kind==='fact'||row.kind==='plan')return row.kind;
 const value=row.name+' '+row.text;
 if(liveFacts.test(value)||/(?:今天|昨天|前天|上周|这次|刚才).{0,16}(?:吃了|喝了|买了|实付|量了|摔了)/.test(value))
  return 'fact';
 if(/今天计划|明天计划|这次计划|待办|临时计划|今晚打算/.test(value))return 'plan';
 return 'habit';
}
export const validMemory=value=>Array.isArray(value)&&value.every(row=>
 row&&typeof row.id==='string'&&typeof row.name==='string'&&typeof row.text==='string'&&typeof row.enabled==='boolean'&&(row.kind===undefined||kinds.has(row.kind)));

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
   updated.kind=changes.kind??previous?.kind??memoryKind(updated);
   if(!['habit','fact','plan'].includes(updated.kind))throw Error('强制规则由程序维护。');
   if(updated.kind==='habit')updated.kind=memoryKind(updated);
   if(!Number.isInteger(updated.priority)||updated.priority<0||updated.priority>100)throw Error('优先级请输入 0 至 100 的整数');
   updated.topic=changes.topic??preferenceTopic(updated.name+' '+updated.text)??previous?.topic;
   if(previous&&updated.text!==previous.text&&!Object.hasOwn(changes,'constraint'))updated.constraint=null;
   if(rows.some(row=>row.id!==id&&normalize(row.text)===normalize(updated.text)))throw Error('已经记住这条内容');
  }
  if(previous&&updated&&(updated.text!==previous.text||updated.enabled!==previous.enabled||updated.kind!==previous.kind)){
   updated.history=[...(previous.history??[]),historyEntry(previous)];
  }
  const next=action==='add'?[...rows,updated]:rows.flatMap(row=>row.id!==id?[row]:updated?[updated]:[]);
  return {previous,updated,commit(){
   if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已更新，请重新打开或查询。');
   store.setItem(MEMORY_KEY,JSON.stringify(next));
  }};
 }
 function rememberFromTurn(updates,source){
  if(/(?:不要|别|不用|别再|不必)记(?:忆|住|这条|下来)/.test(source))return [];
  const saved=[];
  for(const update of updates??[]){
   if(typeof update.evidence!=='string'||!update.evidence.trim())continue;
   try{
    const before=read().raw,record=learnHabit(update,source);
    if(store.getItem(MEMORY_KEY)!==before)saved.push(record.name);
   }catch{/* Ineligible or protected suggestion. */}
  }
  return [...new Set(saved)];
 }
 const historyEntry=row=>({name:row.name,text:row.text,evidence:row.evidence,updatedAt:row.updatedAt,
  constraint:row.constraint,origin:row.origin,source:row.source,enabled:row.enabled,kind:row.kind});
 function habitRows(){
  const topics=new Set(),skillIds=migratedSkillIds(store);
  return read().rows.filter(row=>!row.archivedProfile&&memoryKind(row)==='habit'&&
   (row.origin||row.updatedAt||!skillIds.has(row.id)))
   .sort((a,b)=>Number(b.origin==='manual')-Number(a.origin==='manual')||
    String(b.updatedAt??'').localeCompare(String(a.updatedAt??''))||(b.priority??0)-(a.priority??0))
   .filter(row=>{
    if(row.topic&&topics.has(row.topic))return false;
    if(row.topic)topics.add(row.topic);
    return row.enabled;
   });
 }
 function activeHabits(){
  return habitRows().map(({id,name,text,topic,updatedAt,constraint})=>({id,name,text,topic,updatedAt,
   constraint:constraint===undefined&&topic==='chicken-one'?{kind:'food_meal_limit',food:'鸡胸',maxMeals:1}:constraint??null}));
 }
 function learnHabit(update,source,{owner=false}={}){
  if(!owner&&!automaticMemoryEnabled(store))throw Error('本机自动记忆已关闭');
  const {name,text,evidence,constraint}=update;
  if(typeof name!=='string'||!name.trim()||typeof text!=='string'||!text.trim())throw Error('请提供偏好名称和内容');
  if(/(?:只这次|仅本轮|仅今天|这次例外|这次可以|这顿可以|不要记住|别记这条|假如|假设|如果|[？?])/.test(evidence??''))throw Error('临时指令仅在本轮生效');
  if(typeof evidence!=='string'||!evidence.trim()||!owner&&!source.includes(evidence)||memoryKind({name,text})!=='habit'||update.kind&&update.kind!=='habit')throw Error('长期习惯需要本轮原话依据');
  if(/sk-[\w-]{12,}|\b(?:api[ -]?key|password|bearer)\b|密码|密钥|验证码|身份证/i.test([name,text,evidence].join(' ')))
   throw Error('敏感凭据不能写入记忆');
  const {raw,rows}=read(),topic=preferenceTopic(text)??update.topic??preferenceTopic(evidence);
  const matches=rows.filter(row=>row.id!==PROFILE_ID&&(topic&&row.topic===topic||
   normalize(row.name).trim()===normalize(name).trim()));
  const previous=matches.find(row=>!row.enabled||row.origin==='manual')??
   matches.sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')))[0];
  if(previous?.enabled===false||previous?.origin==='manual')throw Error('这项记忆由用户管理，请只在当轮应用新指令。');
  if(previous?.enabled&&previous.text===text&&JSON.stringify(previous.constraint??null)===JSON.stringify(constraint??null))return previous;
  const priorHistory=previous?.history??[];
  const record={...previous,id:previous?.id??crypto.randomUUID(),name:previous?.name??name,text,topic,enabled:true,kind:'habit',
   origin:'conversation',constraint,priority:previous?.priority??50,updatedAt:new Date().toISOString(),evidence,
   source:update.source??{kind:'user_message'},history:[...priorHistory,...(previous?[historyEntry(previous)]:[])]};
  if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已在另一页面更新，请重新读取');
  store.setItem(MEMORY_KEY,JSON.stringify(rows.filter(row=>row.id!==record.id).concat(record)));
  return record;
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
  next.push(...added.map(row=>({...row,kind:'habit'})),{id:PROFILE_ID,kind:'rule',name:'健康规则版本',text:'现行核心规则及来源',enabled:false,
    version:profile.version,ruleIds:profile.ruleIds});
  return ()=>{if(store.getItem(MEMORY_KEY)!==raw)throw Error('记忆已变化，请重新预览');store.setItem(MEMORY_KEY,JSON.stringify(next));};
 }
 return {
  list:()=>read().rows.filter(row=>row.id!==PROFILE_ID),profile:()=>read().rows.find(row=>row.id===PROFILE_ID)??null,
  prepare,rememberFromTurn,importProfile,activeHabits,learnHabit,
  planningHabits(){
   const habits=activeHabits();
   const previous=read().rows.some(row=>row.topic==='chicken-one'||row.constraint?.kind==='food_meal_limit'&&row.constraint.food.includes('鸡胸'));
   return previous?habits:[...habits,{id:'default:chicken-meals',topic:'chicken-one',name:'默认鸡胸安排',
    text:'通常安排一袋鸡胸，一天最多一餐。',constraint:{kind:'food_meal_limit',food:'鸡胸',maxMeals:1}}];
  },
  relevant(text,{budget=1800,limit=8}={}){
   const terms=keywords(text);
   const ranked=habitRows().map(({name,text,priority,updatedAt})=>{
    const title=keywords(name),body=keywords(text);
    const score=[...terms].reduce((n,term)=>n+(title.has(term)?2:body.has(term)?1:0),0);
    return {name,text,score,priority,updatedAt};
   }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||(b.priority??0)-(a.priority??0)||String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')));
   let chars=0,count=0;
   return ranked.flatMap(({name,text})=>{
    if(count>=limit)return [];
    const remaining=budget-chars;
    if(remaining<=name.length)return [];
    const snippet=text.slice(0,remaining-name.length);
    chars+=snippet.length+name.length;count++;
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
  form.elements.kind.value=row?memoryKind(row):'habit';
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
   if(row.updatedAt){const when=document.createElement('small');when.textContent=({habit:'稳定习惯',fact:'一次性事实',plan:'临时计划',rule:'强制规则'}[memoryKind(row)])+' · 优先级 '+(row.priority??50)+' · '+row.updatedAt.slice(0,10);item.append(when);}
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
    enabled:form.elements.enabled.checked,priority:form.elements.priority.value,kind:form.elements.kind.value},editing?'update':'add').commit();
   update();onChange();status.textContent='已保存记忆。';
  }catch(err){status.textContent=err.message;}
 };
 update();
 return update;
}
