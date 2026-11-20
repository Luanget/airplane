import {syncChoiceFields} from '../choice-picker.mjs';
import {shellIcon} from '../shell.mjs';

export const SKILL_LIMIT=800;
export const SKILL_NAME_LIMIT=60;
const STORAGE_KEY='airplane-ai-skills-v2';
const inheritedFolders=[{id:'l-series',name:'L 系列 · 栾云煦创',preset:true},{id:'personal',name:'我的 Skill',preset:true}];

const presets=[
 {id:'l-data',name:'L · 数据与纠错规范',enabled:true,text:'处理补报、修改、撤销、跨日重算或账本异常时，按需用 read_app_data 的 guide 查 fields、workflow、calculations、exceptions 及目标数据集。以应用实时字段、状态、单位、关联 ID 和计算口径为准。确认前展示改动，处理来源记录和联动关系；同步中断按恢复流程续办。'},
 {id:'l-record',name:'L · 记录与纠错',enabled:true,text:'从最新本机账本接手，按日期、餐次和食品查相关记录。区分实际、计划、查询、更正与删除。更正定位原记录，只调整受影响的日期、营养和库存。照片分清整份、剩余与续餐，续加的份量单独计，同一份只记一次。报告逐项份量、五项营养、有依据的成本及估量来源；汇总单餐、当天实际摄入、目标差距和库存变化。个人目标从本机读取。以应用回执说明保存结果；备份使用 Airplane 导出。'},
 {id:'l-meals',name:'L · 配餐与营养',enabled:true,text:'按今日实际摄入、本机目标和现有库存配餐，优先用实称整份。午晚餐正常安排，午餐多了也不靠跳过晚餐补偿。每餐优先一种主要蔬菜，便携食品适合加餐。骑行日兼顾碳水、饮水和恢复，不机械吃回运动热量。逐项列份量、热量、蛋白质、碳水、脂肪、钠、已知成本和估算依据。数据优先级为原包装及实称、同款校准、再到通用资料或照片估量。给出整餐合计、全天条件合计和目标对照。计划不扣库，报告实际后重排当天下一餐。'},
 {id:'l-stock',name:'L · 库存与采购',enabled:true,text:'先匹配已有食品、同款标签及实际分装。按实际克、毫升、包或个登记，瓶装品核对同一容器前后毛重；皮重和密度未知时保留不确定性。明确摄入才扣库存，送人、丢弃和盘点仅改库存，未说明从库存取用的一次性食品只记摄入。库存未知与已用完分开；金额有证据才记，部分缺价只报告已知成本。按实际消耗速度提示预计只够 2–3 天的常用食材。只采购才产生支出；吃掉、丢弃或赠送用相应库存口径，别生成第二笔支出。'},
 {id:'l-progress',name:'L · 运动与周期',enabled:true,text:'普通日消耗取本机 TDEE 设置，已含日常活动时只额外计入确认且不重叠的专项运动。手表全天、静息、活动和单次训练是不同口径，不叠加。体重看最近七次有效晨重和变化，单日波动不当作脂肪变化。周期按本机长度、目标及次日结算。报告起止、封账截至、已结算缺口、进度、理论脂肪当量、距目标剩余与体重趋势。当天条件缺口单列，未报饮食保留待补。请区分近七次晨重与上个窗口。落后也按正常饮食和恢复安排。'},
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
   if(saved?.overrides&&Array.isArray(saved.personal)){
    saved.folders??=[];
    let migrated=false;
    for(const preset of presets){
     const row=saved.overrides[preset.id];
     if(typeof row?.text==='string'&&typeof row.baseText!=='string'){
      row.baseText=preset.text;migrated=true;
     }
    }
    if(migrated)write(saved);
    return saved;
   }
  }catch{}
  const text=storage.getItem(legacyKey)?.trim();
  const personal=text?[{id:'legacy-preference',name:'原有个人偏好',text,enabled:true}]:[];
  return {overrides:{},personal,folders:[]};
 }
 function list(state=read()){
  const rows=presets.map(preset=>{
   const {baseText,...override}=state.overrides[preset.id]??{};
   return {...preset,...override,preset:true,folderId:'l-series',
    updateAvailable:typeof override.text==='string'&&baseText!==preset.text};
  });
  return [...rows,...state.personal.map(row=>({...row,folderId:row.folderId??'personal'}))];
 }
 function folders(state=read()){return [...inheritedFolders,...state.folders];}
 function folderName(value){
  const name=String(value??'').trim();
  if(!name||name.length>SKILL_NAME_LIMIT)throw Error('请输入有效的文件夹名称');
  return name;
 }
 function chooseFolder(state,id='personal',proposedName){
  if(!proposedName){
   if(id==='l-series'||!folders(state).some(row=>row.id===id))throw Error('请选择个人 Skill 文件夹');
   return id;
  }
  const name=folderName(proposedName),existing=folders(state).find(row=>row.name===name);
  if(existing?.id==='l-series')throw Error('请选择个人 Skill 文件夹');
  if(existing)return existing.id;
  const folder={id:crypto.randomUUID(),name};state.folders.push(folder);return folder.id;
 }
 function write(state){storage.setItem(STORAGE_KEY,JSON.stringify(state));}
 function update(id,changes,expected){
  const state=read(),item=list(state).find(row=>row.id===id);
  if(!item||expected&&(item.text!==expected.text||item.name!==expected.name||item.folderId!==expected.folderId))
   throw Error('Skill 已变更，请重新打开后编辑');
  if(item.preset){
   const override=state.overrides[id]??={};
   if(typeof changes.text==='string')override.baseText??=presets.find(row=>row.id===id).text;
   Object.assign(override,changes);
  }else Object.assign(state.personal.find(row=>row.id===id),changes);
  write(state);
 }
 return {
  list,folders,
  mergeInfo(id){
   const state=read(),preset=presets.find(row=>row.id===id),own=state.overrides[id];
   if(!preset||typeof own?.text!=='string'||own.baseText===preset.text)return null;
   return {id,name:preset.name,previous:own.baseText,current:preset.text,personal:own.text};
  },
  resolveDefault(info,text){
   if(!info)throw Error('该 Skill 已是当前版本');
   const latest=this.mergeInfo(info.id);
   if(!latest||JSON.stringify(latest)!==JSON.stringify(info))throw Error('Skill 已变更，请重新核对新版');
   const state=read(),override=state.overrides[info.id];
   if(text!==undefined)override.text=skillText(text);
   override.baseText=info.current;write(state);
  },
  saveFolder(id,changes,action='update'){
   const state=read(),existing=state.folders.find(row=>row.id===id);
   if(action==='delete'){
    if(!existing)throw Error('只能删除自己的文件夹');
    state.folders=state.folders.filter(row=>row.id!==id);
    for(const row of state.personal)if(row.folderId===id)row.folderId='personal';
   }else{
    const name=folderName(changes.name??existing?.name);
    if(folders(state).some(row=>row.id!==id&&row.name===name))throw Error('已有同名 Skill 文件夹');
    if(action==='add'){
     id=crypto.randomUUID();state.folders.push({id,name});
    }else if(existing)existing.name=name;
    else throw Error('只能编辑自己的文件夹');
    for(const skillId of changes.skillIds??[]){
     const row=state.personal.find(skill=>skill.id===skillId);
     if(!row)throw Error('找不到要移动的个人 Skill');
     row.folderId=id;
    }
   }
   write(state);return id;
  },
  active:()=>list().filter(row=>row.enabled).map(({name,text})=>({name,text})),
  enable:(id,enabled)=>update(id,{enabled}),
  save({id,name,text,folderId},expected){
   text=skillText(text);
   name=String(name??'').trim();
   if(!name||name.length>SKILL_NAME_LIMIT)throw Error('请输入 1–'+SKILL_NAME_LIMIT+' 字的名称');
   if(id){
    const preset=presets.some(row=>row.id===id);
    const state=read();
    update(id,preset?{text}:{name,text,folderId:chooseFolder(state,folderId??expected?.folderId)},expected);
   }else{
    const state=read();
    state.personal.push({id:crypto.randomUUID(),name,text,enabled:true,folderId:chooseFolder(state,folderId)});
    write(state);
   }
  },
  applyChanges(id,changes,expected,action){
   const state=read(),item=list(state).find(row=>row.id===id);
   if(action==='add'){
    const name=String(changes.name??'').trim(),text=skillText(changes.text);
    if(!name||name.length>SKILL_NAME_LIMIT)throw Error('请核对 Skill 名称');
    state.personal.push({id:crypto.randomUUID(),name,text,enabled:changes.enabled??true,folderId:chooseFolder(state,changes.folderId,changes.folderName)});
    write(state);
    return;
   }
   if(!item||['name','text','enabled','folderId'].some(key=>item[key]!==expected[key]))throw Error('Skill 已变更，请重新核对');
   if(action==='delete'){
    if(item.preset)throw Error('预置 Skill 可关闭');
    state.personal=state.personal.filter(row=>row.id!==id);
    write(state);
    return;
   }
   const validated={...changes};
   if(Object.hasOwn(changes,'text'))validated.text=skillText(changes.text);
   if(Object.hasOwn(changes,'name')){
    validated.name=changes.name.trim();
    if(item.preset||!validated.name||validated.name.length>SKILL_NAME_LIMIT)throw Error('请核对 Skill 名称');
   }
   if(Object.hasOwn(changes,'folderId')||Object.hasOwn(changes,'folderName')){
    if(item.preset)throw Error('内置 Skill 保留在自己的文件夹');
    validated.folderId=chooseFolder(state,changes.folderId,changes.folderName);
    delete validated.folderName;
    Object.assign(state.personal.find(row=>row.id===id),validated);write(state);
   }else update(id,validated,expected);
  },
  restore(id,expected){
   if(presets.some(row=>row.id===id))update(id,{text:undefined,baseText:undefined},expected);
  }
 };
}

export function mountSkillSettings(panel,library,onChange,onMerge){
 const form=panel.querySelector('#skill-editor'),items=panel.querySelector('[data-skill-items]');
 const status=panel.querySelector('[data-skill-status]'),error=form.querySelector('[data-skill-error]');
 const restore=form.querySelector('[data-restore-skill]'),create=panel.querySelector('[data-new-skill]');
 const buttons=new Map(),openFolders=new Set(['personal']);
 const folderForm=panel.querySelector('[data-skill-folder-form]'),newFolder=panel.querySelector('[data-new-folder]');
 let editing=null,opener=null;
 function moveEditor(button){
  opener?.setAttribute('aria-expanded','false');
  opener=button;
  if(opener){
   (opener.closest('.skill-row')??opener).after(form);
   opener.setAttribute('aria-expanded','true');
  }else create.after(form);
 }
 function closeEditor(){
  const button=opener;
  form.hidden=true;editing=null;error.textContent='';
  moveEditor(null);
  button?.focus({preventScroll:true});
 }
 function displayEditor(button,item=null){
  if(opener===button){closeEditor();return;}
  editing=item;moveEditor(button);form.hidden=false;status.textContent='';error.textContent='';
  form.elements.name.value=item?.name??'';
  form.elements.name.readOnly=!!item?.preset;
  const folder=form.elements.folderId;
  folder.parentElement.hidden=!!item?.preset;
  folder.replaceChildren(...library.folders().filter(row=>row.id!=='l-series').map(row=>new Option(row.name,row.id)));
  folder.value=item?.preset?'personal':item?.folderId??'personal';
  syncChoiceFields(form);
  if(item?.updateAvailable){
   const notice=form.querySelector('[data-skill-update]');notice.hidden=false;
   notice.querySelector('[data-merge]').onclick=()=>onMerge(library.mergeInfo(item.id));
   notice.querySelector('[data-keep]').onclick=()=>{
    try{library.resolveDefault(library.mergeInfo(item.id));finish('已保留你的规则。');}
    catch(err){error.textContent=err.message;}
   };
  }else form.querySelector('[data-skill-update]').hidden=true;
  form.elements.text.value=item?.text??'';
  form.elements.name.maxLength=SKILL_NAME_LIMIT;
  form.elements.text.maxLength=SKILL_LIMIT;
  restore.hidden=!item?.preset;
  form.querySelector('[type=submit]').textContent=item?'保存 Skill':'保存并启用';
 }
 function showStatus(message,button=create){
  status.textContent=message;
  const row=button.closest('.skill-row')??button;
  (button===opener?form:row).after(status);
 }
 function refresh(){
  const rows=library.list();
  for(const details of items.querySelectorAll('.skill-group')) {
   if(details.open)openFolders.add(details.dataset.folderId);else openFolders.delete(details.dataset.folderId);
  }
  create.after(form,status);
  buttons.clear();items.replaceChildren();
  for(const folder of library.folders()){
   const group=rows.filter(row=>row.folderId===folder.id);
   const section=document.createElement('details'),header=document.createElement('summary');
   const title=document.createElement('span'),count=document.createElement('small');
   title.textContent=folder.name;
   const available=group.filter(row=>row.updateAvailable).length;
   count.textContent=available?available+' 项有新版':group.length+' 项';
   const icon=document.createElement('span');icon.className='skill-folder-icon';icon.innerHTML=shellIcon('folder');
   header.append(icon,title,count);section.append(header);
   section.className='skill-group';section.dataset.folderId=folder.id;section.open=openFolders.has(folder.id);
   for(const skill of group){
    const row=document.createElement('div'),label=document.createElement('label'),toggle=document.createElement('input');
    const name=document.createElement('span'),edit=document.createElement('button');
    row.className='skill-row';toggle.type='checkbox';toggle.checked=skill.enabled;name.textContent=skill.name;
    if(skill.updateAvailable){const mark=document.createElement('small');mark.className='skill-update-mark';mark.textContent='新版';name.append(' ',mark);}
    toggle.onchange=()=>{
     try{library.enable(skill.id,toggle.checked);onChange();status.textContent='';}
     catch(err){toggle.checked=!toggle.checked;showStatus(err.message,edit);}
    };
    edit.type='button';edit.className='text-button';edit.textContent='编辑';
    edit.setAttribute('aria-label','编辑 '+skill.name);
    edit.setAttribute('aria-controls',form.id);edit.setAttribute('aria-expanded','false');
    edit.onclick=()=>displayEditor(edit,skill);buttons.set(skill.id,edit);
    label.append(toggle,name);row.append(label,edit);section.append(row);
   }
   items.append(section);
  }
  if(!form.hidden){
   const button=editing?buttons.get(editing.id):create;
   if(button)moveEditor(button);else closeEditor();
  }
  status.textContent='';onChange();
 }
 function finish(message){
  const id=editing?.id;
  form.hidden=true;editing=null;error.textContent='';moveEditor(null);
  refresh();
  const button=buttons.get(id)??create;
  if(button!==create)button.closest('details').open=true;
  showStatus(message,button);button.focus({preventScroll:true});
 }
 create.setAttribute('aria-controls',form.id);create.setAttribute('aria-expanded','false');
 create.onclick=()=>displayEditor(create);
 form.querySelector('[data-close-skill]').onclick=closeEditor;
 newFolder.onclick=()=>{folderForm.hidden=!folderForm.hidden;};
 folderForm.querySelector('[data-close-folder]').onclick=()=>{folderForm.hidden=true;};
 folderForm.onsubmit=event=>{
  event.preventDefault();
  const output=folderForm.querySelector('output');
  try{
   const id=library.saveFolder(null,{name:folderForm.elements.name.value},'add');
   openFolders.add(id);folderForm.reset();folderForm.hidden=true;output.textContent='';refresh();
  }catch(err){output.textContent=err.message;}
 };
 form.onsubmit=event=>{
  event.preventDefault();
  try{
   library.save({id:editing?.id,name:form.elements.name.value,text:form.elements.text.value,folderId:form.elements.folderId.value},editing);
   finish('已保存到本机。');
  }catch(err){error.textContent=err.message;}
 };
 restore.onclick=()=>{
  try{
   if(!editing?.preset)return;
   library.restore(editing.id,editing);
   finish('已恢复原版。');
  }catch(err){error.textContent=err.message;}
 };
 refresh();
 return refresh;
}
