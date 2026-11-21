import {localDate} from '../calendar.mjs';
import {CORE_RULES,applyProfileSettings,prepareHealthProfile} from './health-profile.mjs';
import {skillCatalog,setSkillEnabled} from './skills.mjs';

export function mountAgentSettings(panel,workspace,refreshMemory){
 const find=selector=>panel.querySelector(selector);
 const catalog=find('[data-skill-list]'),status=find('[data-agent-status]'),summary=find('[data-profile-summary]');
 const preview=find('[data-profile-preview]'),file=find('[data-profile-file]'),values=find('[data-profile-values]');
 const adopt=find('[data-profile-calculations]'),apply=find('[data-profile-apply]');
 let draft=null,busy=false,sequence=0;
 function show(){
  const active=workspace.memory.profile();
  summary.textContent=active?'个人配置 '+active.version+' · '+active.ruleIds.length+' 条现行规则':'可从已导入主账或本机文件读取个人配置';
  catalog.replaceChildren(...skillCatalog(workspace.finance).map(skill=>{
   const row=document.createElement('label'),toggle=document.createElement('input'),copy=document.createElement('span');
   row.className='document-access';toggle.type='checkbox';toggle.checked=skill.enabled;
   copy.textContent=skill.name+' · v'+skill.version;row.append(toggle,copy);
   toggle.onchange=()=>{
    try{setSkillEnabled(workspace.finance,skill.id,toggle.checked);status.textContent=skill.name+(toggle.checked?'已启用。':'已停用。');}
    catch(err){toggle.checked=!toggle.checked;status.textContent=err.message;}
   };
   return row;
  }));
 }
 function clear(){sequence++;draft=null;preview.hidden=true;adopt.checked=false;status.textContent='';}
 async function prepare(files){
  clear();
  const token=sequence;
  try{
   const [state,documents]=await Promise.all([workspace.readHealth(),Promise.all(files.map(async file=>({name:file.name,text:await file.text()})))]);
   if(token!==sequence)return;
   const profile=prepareHealthProfile(documents,state,{previousVersion:workspace.memory.profile()?.version});
   const fields={baselineTdee:'基础消耗',calorieTarget:'日热量参考',proteinMin:'蛋白下限',proteinMax:'蛋白上限',
    fatMin:'脂肪下限',sodiumTarget:'钠参考',cycleDays:'周期天数',cycleTarget:'周期目标',commuteIncluded:'基础含通勤',watchReference:'手表总量保留为参考'};
   const lines=[profile.version+' · '+profile.sources.join('、'),...profile.ruleIds.map(id=>CORE_RULES[id]),
    ...profile.entries.map(row=>row.name+' · '+row.text),
    ...Object.entries(profile.settings).map(([key,value])=>fields[key]+' '+(value===true?'启用':value))];
   if(profile.ignored)lines.push('已忽略 '+profile.ignored+' 个旧版来源。');
   values.textContent=lines.join('\n');preview.hidden=false;draft={profile,state};
   adopt.disabled=!Object.keys(profile.settings).length;
  }catch(err){if(token===sequence)status.textContent=err.message;}
 }
 find('[data-profile-choose]').onclick=()=>file.click();
 file.onchange=()=>{const files=[...file.files];file.value='';if(files.length)void prepare(files);};
 find('[data-profile-ledger]').onclick=()=>void prepare([]);
 find('[data-profile-cancel]').onclick=clear;
 apply.onclick=async()=>{
  if(!draft||busy)return;
  busy=true;apply.disabled=true;
  let settingsSaved=false;
  try{
   const {profile,state}=draft,commit=workspace.memory.importProfile(profile);
   if(adopt.checked){
    await workspace.saveHealth(applyProfileSettings(state,profile.settings,localDate()),state.revision??0);
    settingsSaved=true;
   }
   commit();clear();show();refreshMemory();
   status.textContent='已保存个人配置 '+profile.version+(settingsSaved?'，计算参数已采用。':'。');
  }catch(err){status.textContent=(settingsSaved?'计算参数已保存，习惯导入未完成。':'')+err.message;}
  finally{busy=false;apply.disabled=false;}
 };
 show();
 return show;
}
