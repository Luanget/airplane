import {localDate,syncCalendarFields} from '../calendar.mjs';
import {addDays,validDate} from '../health/core.mjs';
import {indicatorKey,makeMedicalAttachment,matchIndicator,medicalData,medicalTrend,referenceFlag,saveMedicalNote,saveMedicalReport} from '../health/medical.mjs';
import {jpeg} from '../health/assistant.mjs';
import {hash,stable} from '../health/sync-source.mjs';

const ACCESS='airplane-ai-medical-auto-v1';
export const medicalAuto=store=>store.getItem(ACCESS)==='yes';
export function setMedicalAuto(store,allow){if(allow)store.setItem(ACCESS,'yes');else store.removeItem(ACCESS);}
const medicalTopic=/体检|化验|检验报告|健康档案|基础资料|症状|就诊|医生诊断|指标趋势|血糖|血脂|血压|血常规|尿酸|转氨酶|肌酐/;
const explanatory=/解读|分析|解释|什么意思|意味着/;
const stayLocal=/(?:仅|只)在?本机|(?:不要|不用|禁止|别)(?:上传|发送)|本机保存原件/;
const explicitWrite=/记录|录入|记一下|保存|提取|转录/;
const flagText={high:'高于本次参考范围',low:'低于本次参考范围',outside:'与本次参考结果不一致'};
const normalized=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function medicalIntent(text,ordinaryPhotos,reportFiles){
 if(reportFiles||ordinaryPhotos&&medicalTopic.test(text))return explanatory.test(text)&&!explicitWrite.test(text)&&!stayLocal.test(text)?'explain':'extract';
 if(!medicalTopic.test(text))return null;
 if(/症状/.test(text)&&explicitWrite.test(text)&&!/查|看看|有没有/.test(text))return 'symptom';
 if(explanatory.test(text))return 'explain';
 if(/查询|查看|找|列出|查|趋势|最新|有哪些|什么|记录|情况/.test(text))return 'read';
 return null;
}
function dateIn(text,today){
 const named=text.normalize('NFKC').match(/(\d{4})[年/-]\s*(\d{1,2})[月/-]\s*(\d{1,2})(?:日|号)?/);
 if(named)return named[1]+'-'+named[2].padStart(2,'0')+'-'+named[3].padStart(2,'0');
 if(/前天/.test(text))return addDays(today,-2);
 if(/昨天|昨日/.test(text))return addDays(today,-1);
 if(/今天|今日/.test(text))return today;
 return null;
}
const aliases={空腹血糖:['血糖','fpg','fasting glucose','1558-6'],'fasting glucose':['空腹血糖','血糖','fpg','1558-6'],糖化血红蛋白:['hba1c','糖化'],甘油三酯:['tg','血脂'],总胆固醇:['tc','血脂'],
 丙氨酸氨基转移酶:['alt','谷丙转氨酶','转氨酶'],谷丙转氨酶:['alt','转氨酶','丙氨酸氨基转移酶']};

export function selectedMedicalIndicators(state,text,today){
 const data=medicalData(state),query=normalized(text),askedDate=dateIn(text,today);
 const names=new Map();
 for(const row of data.measurements){
  const indicator=indicatorKey(matchIndicator(data,row));
  const words=[row.name,row.code,...(aliases[row.name.toLowerCase()]??[]),...(row.code==='1558-6'?aliases.空腹血糖:[])].map(normalized).filter(word=>word.length>=2);
  if(words.some(word=>query.includes(word)))names.set(indicator,row.name);
 }
 return [...names].flatMap(([id,name])=>{
   const {rows,groups}=medicalTrend(data,id);
  const selected=rows.filter(row=>!askedDate||askedDate===row.date);
  return selected.length?[{name,rows:selected,groups:askedDate?[]:groups}]:[];
 });
}
const summaryLine=row=>[(row.date??'日期待核对'),row.name,row.value??row.result??'结果待补',row.unit,
 row.reference&&'参考 '+row.reference,flagText[referenceFlag(row)]].filter(value=>value!=null&&value!=='').join(' · ');
export function queryMedical(state,text,today){
 const data=medicalData(state),selected=selectedMedicalIndicators(state,text,today);
 if(selected.length){
  const details=selected.flatMap(group=>group.rows.map(summaryLine));
  const trend=selected.flatMap(row=>row.groups.map(group=>{
   const first=group.points[0],last=group.points.at(-1);
   return row.name+' · '+group.method+' · '+first.value+' → '+last.value+' '+group.unit;
  }));
  const recent=!/趋势|历次|变化/.test(text)&&selected.length===1?selected[0].rows.at(-1):null;
  return {text:recent?summaryLine(recent):'本机档案 · '+selected.map(group=>group.name).join('、'),
   detail:[...trend,...details].join('\n')};
 }
 const date=dateIn(text,today);
 if(/基础资料/.test(text)){
  const profile=data.profile[0];
  return profile?{text:'本机基础资料',detail:[profile.name,profile.birthDate&&'出生日期 '+profile.birthDate,
   profile.sex,profile.notes].filter(Boolean).join('\n')}:{text:'尚未填写基础资料。'};
 }
 if(/症状|就诊|医生诊断/.test(text)){
  const symptoms=/医生诊断/.test(text)?[]:data.symptoms.filter(row=>!date||row.date===date);
  const diagnoses=/医生诊断/.test(text)?data.diagnoses.filter(row=>!date||row.date===date):[];
  const lines=[...symptoms.map(row=>[row.date??'日期待核对',row.time,'用户自述',row.description,
   row.change&&'变化 '+row.change,row.visit&&'就诊 '+row.visit].filter(Boolean).join(' · ')),
   ...diagnoses.map(row=>[row.date??'日期待核对','医生诊断',row.description,row.evidence].join(' · '))];
  return {text:lines.length?'本机档案 '+lines.length+' 条':'所查范围暂无档案记录。',detail:lines.join('\n')};
 }
 const reports=data.reports.filter(row=>!date||row.date===date);
 return {text:reports.length?'本机有 '+reports.length+' 份体检档案。可按具体指标名称查询。':'所查范围暂无匹配的指标或体检报告。',
  detail:reports.map(row=>[row.date??'日期待核对',row.institution,data.measurements.filter(item=>item.reportId===row.id).length+' 项指标'].filter(Boolean).join(' · ')).join('\n')};
}
export function extractMedicalFacts(state,query,today){
 return selectedMedicalIndicators(state,query,today).flatMap(group=>{
  const rows=group.rows.filter(row=>row.date);
  const selected=/趋势|历次|变化/.test(query)?rows:rows.slice(-1);
  return selected.map(({date,name,value,result,unit,method,reference})=>({date,name,value,
   result:value===null?result:null,unit,method,reference}));
 });
}
function fractionEvidence(row){
 if(!row.evidence||row.uncertainty)return false;
 const cited=normalized(row.evidence);
 if([row.name,row.code,row.method,row.reference].some(field=>field&&!cited.includes(normalized(field))))return false;
 if(row.value===null)return Boolean(row.result&&cited.includes(normalized(row.result)));
 const text=row.evidence.normalize('NFKC').replace(/附件\s*\d+|(?:第\s*)?\d+\s*页/g,'');
 return !/(?:[≤≥<>]|<=|>=)\s*\d/.test(row.result??'')&&
  (text.match(/[+-]?\d+(?:\.\d+)?/g)??[]).some(value=>Number(value)===row.value)&&
  (!row.unit||normalized(text).includes(normalized(row.unit)));
}
export function reportDraft(result,today){
 if(!result.report)return null;
 const report=result.report;
 const date=validDate(report.date)&&report.date<=today?report.date:null;
 const dateProven=Boolean(date&&report.dateEvidence&&dateIn(report.dateEvidence,today)===date);
 return {...report,date,source:'ai',
  auto:Boolean(dateProven&&!report.uncertainty&&report.measurements.length&&report.measurements.every(fractionEvidence))};
}
export function symptomDraft(result,text,today){
 const date=dateIn(text,today);
 if(!text.includes(result.evidence)||!result.evidence.includes(result.description)||
  [result.change,result.visit].some(value=>value&&!result.evidence.includes(value)))throw Error('症状候选与本轮原话不一致，请重述或手动录入。');
 if(result.date&&result.date!==date)throw Error('发生日期与原话不一致，请在档案核对。');
 if(date&&(!validDate(date)||date>today))throw Error('请核对症状发生日期。');
 const time=result.time&&text.includes(result.time)?result.time:null;
 const description=result.description;
 return {...result,date,time,source:'user',id:'ai-symptom:'+hash(stable([date,time,description])),
  auto:!result.uncertainty};
}
function draftLines(rows){
 return rows.map(row=>[summaryLine(row),row.method&&'方法 '+row.method,
  row.evidence?'证据 '+row.evidence:'证据待核对',row.uncertainty?'待核对 '+row.uncertainty:!fractionEvidence(row)?'证据需人工核对':null].filter(Boolean).join('\n')).join('\n\n');
}
function checkGrant(workspace,allowed,automatic){
 if(!allowed())throw Error('本轮未允许健康档案写入。');
 if(automatic&&!medicalAuto(workspace.finance))throw Error('健康档案自动保存已关闭。');
}

export async function useMedicalTurn(workspace,{kind,text,files,ask,allowed,show,review,onSaved}){
 const previewOnly=/(?:只|仅)(?:识别|看看|预览)|先(?:看看|预览|别记)|(?:不要|不用|不必|暂不)(?:录入|保存|写入|记录)/.test(text);
 const today=localDate();
 if(kind==='read'){
  if(!allowed())throw Error('请先允许本轮查询本机数据。');
  const result=queryMedical(await workspace.readHealth(),text,today);
  show(result.text,result.detail);return;
 }
 if(kind==='explain'){
  let facts=[],attachments=[];
  if(files.length){
   if(stayLocal.test(text))throw Error('可先在本机保存原件，再指定需要解读的指标。');
   attachments=await analysisFiles(files);
  }
  else {
   if(!allowed())throw Error('请先允许本轮查询本机数据。');
   facts=extractMedicalFacts(await workspace.readHealth(),text,today);
   if(!facts.length){show('请在本轮指定要解读的指标名称或选取报告附件。');return;}
  }
  const result=await ask(text||'解读本轮选中的体检附件',{kind,files:attachments,facts});
  show(result.explanation,result.uncertainty);return;
 }
 if(!allowed())throw Error('请先允许本轮访问本机健康档案。');
 if(kind==='symptom'){
  const draft=symptomDraft(await ask(text,{kind}),text,today);
  const save=async(_date,automatic=false)=>{
   const latest=await workspace.readHealth(),next=structuredClone(latest);
   checkGrant(workspace,allowed,automatic);
   if(medicalData(latest).symptoms.some(row=>row.id===draft.id)){
    onSaved?.({symptomId:draft.id,revision:latest.revision??0,source:'medical'});
    return '症状已记录，重试未新增。';
   }
   saveMedicalNote(next,'symptoms',draft);
   await workspace.saveHealth(next,latest.revision??0,()=>checkGrant(workspace,allowed,automatic));
   const stored=await workspace.readHealth();
   if(!medicalData(stored).symptoms.some(row=>row.id===draft.id))throw Error('未能核对症状保存回执。');
   onSaved?.({symptomId:draft.id,revision:stored.revision??0,source:'medical'});
   return '已保存症状自述。';
  };
  const detail=[draft.description,draft.date??'发生日期未知',draft.change,draft.visit,draft.uncertainty].filter(Boolean).join('\n');
  if(draft.auto&&!previewOnly&&medicalAuto(workspace.finance))show(await save(null,true),detail);
  else review({title:'核对症状自述',detail,save});
  return;
 }
 if(!files.length)throw Error('请选择体检照片或 PDF。');
 const originals=await Promise.all(files.map(makeMedicalAttachment));
 const localOnly=stayLocal.test(text);
 let draft,detail;
 if(localOnly){
  draft={date:dateIn(text,today),source:'manual',measurements:[],auto:false};
  detail='仅在本机保存所选原件。\n'+originals.map(row=>row.name).join('\n');
 }else{
  const candidate=await ask(text||'转录本轮选中的体检附件',{kind,files:await analysisFiles(files,originals)});
  draft=reportDraft(candidate,today);
  if(!draft){show('本轮未能确认所属体检报告。',candidate.message);return;}
  detail=[draft.dateEvidence&&'日期依据 '+draft.dateEvidence,draft.uncertainty,draftLines(draft.measurements)].filter(Boolean).join('\n\n');
 }
 const save=async(date,automatic=false)=>{
  const latest=await workspace.readHealth(),next=structuredClone(latest);
  checkGrant(workspace,allowed,automatic);
  if(!validDate(date)||date>today)throw Error('请核对体检日期。');
  const result=saveMedicalReport(next,{...draft,date},originals,{rejectConflicts:true,dedupeByResult:true});
  if(result.changed)await workspace.saveHealth(next,latest.revision??0,()=>checkGrant(workspace,allowed,automatic));
  const stored=await workspace.readHealth(),saved=medicalData(stored);
  const record=saved.reports.find(row=>row.id===result.id);
  if(!record||originals.some(file=>!record.attachmentIds.includes(file.id)||
    !saved.attachments.some(attachment=>attachment.id===file.id)))throw Error('未能核对报告和原件的保存回执。');
  onSaved?.({reportId:record.id,measurementIds:saved.measurements.filter(row=>row.reportId===record.id).map(row=>row.id),
   revision:stored.revision??0,source:'medical'});
  return result.changed?'已在本机保存报告 · 新录入 '+result.added+' 项指标。':'此报告已在本机，未重复录入。';
 };
 if(draft.auto&&!previewOnly&&medicalAuto(workspace.finance))show(await save(draft.date,true),detail);
 else review({title:localOnly?'保存本机体检原件':'核对体检报告与指标',detail,date:draft.date,save});
}

async function analysisFiles(files,originals){
 const rows=originals??await Promise.all(files.map(makeMedicalAttachment));
 if(rows.reduce((sum,row)=>sum+row.size,0)>32*1024*1024)throw Error('单次识别请选择总计不超过 32 MB 的体检附件。');
 return Promise.all(rows.map(async(row,index)=>{
  if(row.type==='image/heic'||row.type==='image/heif'){
   const decoded=await jpeg(files[index]);
   return {type:'image/jpeg',data:decoded.split(',')[1]};
  }
  return {type:row.type,data:row.data};
 }));
}
export function renderMedicalReview(panel,draft,finish,notify,locked){
 const heading=document.createElement('h3');heading.textContent=draft.title;
 const detail=document.createElement('pre');detail.className='assistant-data-review';detail.textContent=draft.detail;
 panel.replaceChildren(heading,detail);
 let date;
 if(draft.date!==undefined){
  const label=document.createElement('label');label.textContent='体检日期';
  date=document.createElement('input');date.type='date';date.max=localDate();
  date.required=true;date.value=draft.date??'';
  label.append(date);panel.append(label);syncCalendarFields(panel);
 }
 const actions=document.createElement('div');actions.className='chat-actions';
 const save=document.createElement('button');save.className='primary-button';save.type='submit';save.textContent='保存到本机';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='text-button';cancel.textContent='取消';
 cancel.onclick=()=>finish('已取消本轮健康档案录入。');
 actions.append(save,cancel);panel.append(actions);panel.hidden=false;
 panel.onsubmit=async event=>{
  event.preventDefault();
  if(save.disabled||locked())return;
  save.disabled=true;cancel.disabled=true;
  try{finish(await draft.save(date?.value),draft.detail);}
  catch(error){notify(error);}
  finally{save.disabled=false;cancel.disabled=false;}
 };
}
