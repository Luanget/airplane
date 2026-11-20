export const SKILL_LIMIT=320;
export const SKILL_NAME_LIMIT=60;
const STORAGE_KEY='airplane-ai-skills-v2';

const presets=[
 {id:'l-record',name:'L · 记录与纠错',enabled:true,text:'从最新本机账本接手，按日期和食品查相关记录，少问已经有答案的问题。先区分已发生、计划、查询和更正；更正定位原记录，只修改受影响的日期、营养和库存。照片分清整份、剩余与续餐，同一份只记一次。先给结论，按需列份量、热量、主要营养、钠及已知成本。以应用回执说明保存结果；备份使用 Airplane 导出。'},
 {id:'l-meals',name:'L · 配餐与营养',enabled:true,text:'按今日实际摄入、本机目标和可用库存安排下一餐；已有分装优先按实称整份。午晚餐正常安排，午餐多了也不靠跳过晚餐补偿。每餐优先一种主要蔬菜，正餐与便携加餐各按实际场景安排。骑行日兼顾碳水、饮水和恢复，不机械吃回全部运动热量。计划总量与实际分开；先给可执行搭配和一两句理由，细节留给计划卡。'},
 {id:'l-stock',name:'L · 库存与采购',enabled:true,text:'先匹配已有食品、同款标签及实际分装。按实际克、毫升、包或个登记，瓶装品核对同一容器前后毛重；皮重和密度未知时保留不确定性。明确摄入才扣库存，送人、丢弃和盘点仅改库存，未说明从库存取用的一次性食品只记摄入。库存未知与已用完分开；金额有证据才记，部分缺价只报告已知成本。按实际消耗速度提示近期需要补货的食材。'},
 {id:'l-progress',name:'L · 运动与周期',enabled:true,text:'普通日消耗取本机 TDEE 设置，已含日常活动时只额外计入确认且不重叠的专项运动。手表全天、静息、活动和单次训练是不同口径，不叠加。体重看最近七次有效晨重和变化，单日波动不当作脂肪变化。周期用本机长度、目标和次日结算结果；分清正式累计和当天条件估算，饮食未报不当作零摄入。落后也按正常饮食和恢复安排。'},
 {id:'l-food-preferences',name:'L · 餐食偏好',enabled:false,text:'早餐按需要安排，午餐稍多、晚餐稍少。有自制鸡胸时通常一天一袋，按实际袋重；有鸡蛋则灵活搭配。提到一包面先核对已有荞麦面规格。水饺自然轮换，避免连续两餐清库存；坚果、火鸡味拌面和日常自制牛肉按明确需求安排，调味酱按实用量记录。'}
];

export function skillText(value){
 const text=String(value??'').trim();
 if(!text||text.length>SKILL_LIMIT)throw Error('请输入 1–'+SKILL_LIMIT+' 字的 Skill 内容');
 return text;
}

export function skillLibrary(storage,legacyKey='airplane-ai-skill-v1'){
 function read(){
  try{
   const saved=JSON.parse(storage.getItem(STORAGE_KEY));
   if(saved?.overrides&&Array.isArray(saved.personal))return saved;
  }catch{}
  const text=storage.getItem(legacyKey)?.trim();
  const personal=text?[{id:'legacy-preference',name:'原有个人偏好',text,enabled:true}]:[];
  return {overrides:{},personal};
 }
 function list(state=read()){
  return [...presets.map(preset=>({...preset,...state.overrides[preset.id],preset:true})),...state.personal];
 }
 function write(state){storage.setItem(STORAGE_KEY,JSON.stringify(state));}
 function update(id,changes,expected){
  const state=read(),item=list(state).find(row=>row.id===id);
  if(!item||expected&&(item.text!==expected.text||item.name!==expected.name))
   throw Error('Skill 已变更，请重新打开后编辑');
  if(item.preset)state.overrides[id]={...state.overrides[id],...changes};
  else Object.assign(item,changes);
  write(state);
 }
 return {
  list,
  active:()=>list().filter(row=>row.enabled).map(({name,text})=>({name,text})),
  enable:(id,enabled)=>update(id,{enabled}),
  save({id,name,text},expected){
   text=skillText(text);
   name=String(name??'').trim();
   if(!name||name.length>SKILL_NAME_LIMIT)throw Error('请输入 1–'+SKILL_NAME_LIMIT+' 字的名称');
   if(id){
    const preset=presets.some(row=>row.id===id);
    update(id,preset?{text}:{name,text},expected);
   }else{
    const state=read();
    state.personal.push({id:crypto.randomUUID(),name,text,enabled:true});
    write(state);
   }
  },
  restore(id,expected){
   if(presets.some(row=>row.id===id))update(id,{text:undefined},expected);
  }
 };
}

export function mountSkillSettings(panel,library,onChange){
 const form=panel.querySelector('form'),items=panel.querySelector('[data-skill-items]');
 const status=panel.querySelector('output'),restore=form.querySelector('[data-restore-skill]');
 let editing=null;
 function displayEditor(item=null){
  editing=item;form.hidden=false;status.textContent='';
  form.elements.name.value=item?.name??'';
  form.elements.name.readOnly=!!item?.preset;
  form.elements.text.value=item?.text??'';
  form.elements.name.maxLength=SKILL_NAME_LIMIT;
  form.elements.text.maxLength=SKILL_LIMIT;
  restore.hidden=!item?.preset;
  form.querySelector('[type=submit]').textContent=item?'保存 Skill':'保存并启用';
  (item?form.elements.text:form.elements.name).focus();
 }
 function refresh(message=''){
  const rows=library.list();
  items.replaceChildren();
  for(const [title,group] of [['L 系列 · 栾云煦创',rows.filter(row=>row.preset)],['我的 Skill',rows.filter(row=>!row.preset)]]){
   if(!group.length)continue;
   const section=document.createElement('section'),heading=document.createElement('h3');
   section.className='skill-group';heading.textContent=title;section.append(heading);
   for(const skill of group){
    const row=document.createElement('div'),label=document.createElement('label'),toggle=document.createElement('input');
    const name=document.createElement('span'),edit=document.createElement('button');
    row.className='skill-row';toggle.type='checkbox';toggle.checked=skill.enabled;name.textContent=skill.name;
    toggle.onchange=()=>{
     try{library.enable(skill.id,toggle.checked);onChange();status.textContent='';}
     catch(err){toggle.checked=!toggle.checked;status.textContent=err.message;}
    };
    edit.type='button';edit.className='text-button';edit.textContent='编辑';
    edit.setAttribute('aria-label','编辑 '+skill.name);edit.onclick=()=>displayEditor(skill);
    label.append(toggle,name);row.append(label,edit);section.append(row);
   }
   items.append(section);
  }
  status.textContent=message;onChange();
 }
 panel.querySelector('[data-new-skill]').onclick=()=>displayEditor();
 form.querySelector('[data-close-skill]').onclick=()=>{form.hidden=true;editing=null;};
 form.onsubmit=event=>{
  event.preventDefault();
  try{
   library.save({id:editing?.id,name:form.elements.name.value,text:form.elements.text.value},editing);
   form.hidden=true;editing=null;refresh('已保存到本机。');
  }catch(err){status.textContent=err.message;}
 };
 restore.onclick=()=>{
  try{
   library.restore(editing.id,editing);
   form.hidden=true;editing=null;refresh('已恢复原版。');
  }catch(err){status.textContent=err.message;}
 };
 refresh();
 return refresh;
}
