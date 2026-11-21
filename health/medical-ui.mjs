import {displayDay,localDate,syncCalendarFields} from '../calendar.mjs';
import {syncChoiceFields} from '../choice-picker.mjs';
import {indicatorKey,makeMedicalAttachment,matchIndicator,medicalAttachmentBytes,medicalData,
 medicalTrend,referenceFlag,saveMedicalNote,saveMedicalReport} from './medical.mjs';

const views={reports:'体检',trends:'指标趋势',symptoms:'症状',profile:'基础资料'};
const labelDate=date=>date?displayDay(date,true):'日期待核对';
const node=(tag,text,className)=>{
 const element=document.createElement(tag);
 if(text)element.textContent=text;
 if(className)element.className=className;
 return element;
};
const button=(label,action,style='text-button')=>{
 const control=node('button',label,style);
 control.type='button';control.onclick=action;
 return control;
};
const description=(row)=>[row.value===null?(row.result||'结果待补'):row.value,row.unit].filter(value=>value!=null).join(' ');
const flagLabels={high:'高于本次参考范围',low:'低于本次参考范围',outside:'与本次参考结果不一致'};
function measurementView(row,withName=true){
 const heading=withName?row.name:labelDate(row.date);
 const value=description(row);
 const flag=flagLabels[referenceFlag(row)];
 const tag=node('strong',heading),line=node('div',null,'medical-result');
 line.append(tag,node('span',value));
 const section=node('div',null,'medical-row');
 section.append(line);
 if(flag)section.append(node('small',flag,'medical-flag'));
 const info=[row.code&&'代码 '+row.code,row.reference&&'本次参考 '+row.reference,row.legacyStatus&&'历史标注 '+row.legacyStatus,row.method&&'方法 '+row.method].filter(Boolean);
 if(info.length)section.append(node('small',info.join(' · '),'muted'));
 if(row.evidence||row.uncertainty||row.original){
  const evidence=node('details');
  const source={legacy:'历史主账',manual:'手动录入',ai:'AI 转录 · 原报告',user:'用户自述'};
  evidence.append(node('summary','证据与来源'));
  for(const line of [source[row.source],row.evidence,row.uncertainty].filter(Boolean))evidence.append(node('p',line));
  if(row.original)evidence.append(node('p',Object.entries(row.original).filter(([,value])=>value).map(([label,value])=>label+' '+value).join('\n')));
  section.append(evidence);
 }
 return section;
}
function fileLink(row,notify){
 return button(row.name,()=>{
  try{
   const url=URL.createObjectURL(new Blob([medicalAttachmentBytes(row)],{type:row.type}));
   const link=node('a');link.href=url;link.download=row.name;document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),3000);
  }catch(error){notify(error.message);}
 });
}

function plot(points){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 320 64');svg.setAttribute('aria-hidden','true');
 const days=points.map(row=>Date.parse(row.date)),first=days[0],last=days.at(-1);
 const values=points.map(row=>row.value),min=Math.min(...values),max=Math.max(...values);
 const shape=document.createElementNS(svg.namespaceURI,'polyline');
 shape.setAttribute('points',points.map((point,i)=>
  [8+304*(days[i]-first)/(last-first),min===max?32:56-48*(point.value-min)/(max-min)].join(',')).join(' '));
 svg.append(shape);
 return svg;
}

export function attachMedical(panel,sheet,{getState,commit,notify}){
 const list=sheet.querySelector('[data-medical-list]'),editor=sheet.querySelector('[data-medical-editor]');
 const title=sheet.querySelector('h2'),body=sheet.querySelector('[data-medical-body]');
 let view,selected,trigger,formDraft,saving=false;
 const openReports=new Set();

 function showEditor(type,reportId=null){
  formDraft={type,reportId};
  editor.replaceChildren();
  editor.append(node('h3',{report:'添加体检报告',measurement:'添加体检指标',symptoms:'记录症状',
   diagnoses:'记录医生诊断',profile:'编辑基础资料',attachment:'补存原件'}[type]));
  const form=node('form');
  const info=medicalData(getState()).profile[0]??{};
  function field(key,label,{type='text',value='',required=false}={}){
   const wrapper=node('label',label);
   const input=node(type==='textarea'?'textarea':'input');
   if(type!=='textarea')input.type=type;
   else input.rows=2;
   input.name=key;input.value=value??'';input.required=required;
   if(type==='number'){input.step='any';input.inputMode='decimal';}
   if(type==='date')input.max=localDate();
   if(type==='file'){input.accept='.pdf,image/*';input.multiple=true;}
   if(type==='text'||type==='textarea')input.maxLength=type==='textarea'?2000:200;
   wrapper.append(input);
   form.append(wrapper);
   return input;
  }
  if(['report','symptoms','diagnoses'].includes(type))
   field('date',type==='report'?'体检日期':'发生或记录日期',{type:'date',required:type==='report',value:localDate()});
  if(type==='report'||type==='diagnoses')field('institution','机构（可选）');
  if(type==='report')field('note','备注（可选）',{type:'textarea'});
  if(type==='attachment'||type==='report')field('attachments','原始照片或 PDF（最多 16 MB／份）',{type:'file',required:type==='attachment'});
  if(type==='measurement'){
   field('name','指标名称',{required:true});
   field('value','数值',{type:'number'});
   field('result','定性结果或原文');
   field('unit','单位');
   field('code','标准代码（可选）');
   field('reference','该次报告参考范围');
   field('method','检测方法（可选）');
   field('evidence','报告依据（可选）');
   field('uncertainty','不确定项（可选）');
  }
  if(type==='symptoms'){
   field('time','发生时间（可选）',{type:'time'});
   field('description','症状自述',{required:true,type:'textarea'});
   field('change','变化情况（可选）');
   field('visit','就诊情况（可选）');
  }
  if(type==='diagnoses'){
   field('description','医生明确诊断',{required:true});
   field('evidence','诊断来源（如诊断书或门诊记录）',{required:true,type:'textarea'});
  }
  if(type==='profile'){
   field('name','姓名或称呼',{value:info.name});
   field('birthDate','出生日期',{type:'date',value:info.birthDate});
   field('sex','性别（可选）',{value:info.sex});
   field('notes','备注（可选）',{type:'textarea',value:info.notes});
  }
  if(type==='attachment'||type==='report')form.append(node('p','原件仅保存到本机，可在助手中单独选择需要识别的附件。','form-hint'));
  const actions=node('div',null,'button-row'),submit=node('button','保存','btn btn-primary');
  submit.type='submit';
  actions.append(button('取消',()=>{editor.hidden=true;formDraft=null;},'btn btn-secondary'),submit);
  form.append(actions);editor.append(form);editor.hidden=false;syncCalendarFields(form);
  editor.scrollIntoView({block:'nearest'});
  form.onsubmit=async event=>{
   event.preventDefault();
   if(saving)return;
   saving=true;submit.disabled=true;
   try{
    const next=structuredClone(getState()),fields=Object.fromEntries(new FormData(form));
    if(type==='report'||type==='attachment'||type==='measurement'){
     const attachments=form.elements.attachments?await Promise.all([...form.elements.attachments.files].map(makeMedicalAttachment)):[];
     const report=medicalData(next).reports.find(row=>row.id===reportId);
     let input=fields;
     if(type==='attachment')input={date:report?.date};
     if(type==='measurement'){
      const value=fields.value===''?null:Number(fields.value);
      if(value===null&&!fields.result.trim())throw Error('请填写数值或定性结果');
      input={date:report?.date,measurements:[{...fields,value}]};
     }
     const result=saveMedicalReport(next,input,attachments,{reportId});
     openReports.add(result.id);
    }else saveMedicalNote(next,type,{...fields,...(type==='diagnoses'?{source:'clinician-confirmed'}:{})});
    await commit(next,'健康档案已保存');
    if(!sheet.open)return;
    const scroll=body.scrollTop;
    editor.hidden=true;editor.replaceChildren();formDraft=null;render();
    body.scrollTop=scroll;
    (reportId&&list.querySelector('[data-medical-report="'+CSS.escape(reportId)+'"] summary')||list.querySelector('button'))?.focus({preventScroll:true});
   }catch(err){notify(err.message);}
   finally{saving=false;submit.disabled=false;}
  };
 }

 function reports(data){
  const current=[...data.reports].sort((a,b)=>(b.date??'').localeCompare(a.date??''));
  const controls=node('div',null,'medical-controls');
  controls.append(button('添加报告',()=>showEditor('report'),'btn btn-secondary'));
  list.append(controls);
  if(!current.length)list.append(node('p','暂无体检报告。','form-hint'));
  for(const report of current){
   const details=node('details',null,'medical-item');
   details.dataset.medicalReport=report.id;details.open=openReports.has(report.id);
   const rows=data.measurements.filter(row=>row.reportId===report.id);
   const summary=node('summary',[labelDate(report.date),report.institution,rows.length+' 项指标'].filter(Boolean).join(' · '));
   details.append(summary);
   if(report.note)details.append(node('p',report.note,'form-hint'));
   if(report.uncertainty)details.append(node('p',report.uncertainty,'form-hint'));
   for(const id of report.attachmentIds){
    const file=data.attachments.find(value=>value.id===id);
    if(file)details.append(fileLink(file,notify));else details.append(node('p','原件未随文件导入','form-hint'));
   }
   for(const row of rows)details.append(measurementView(row));
   if(report.date)details.append(button('添加指标',()=>showEditor('measurement',report.id)),button('补存原件',()=>showEditor('attachment',report.id)));
   details.ontoggle=()=>{if(details.isConnected){if(details.open)openReports.add(report.id);else openReports.delete(report.id);}};
   list.append(details);
  }
 }
 function symptoms(data){
  list.append(button('记录症状',()=>showEditor('symptoms'),'btn btn-secondary'));
  for(const row of [...data.symptoms].sort((a,b)=>(b.date??'').localeCompare(a.date??''))){
   const item=node('section',null,'medical-item');
   item.append(node('strong',labelDate(row.date)+(row.time?' · '+row.time:'')),node('p',row.description));
   for(const text of [row.change&&'变化 '+row.change,row.visit&&'就诊 '+row.visit,row.uncertainty].filter(Boolean))
    item.append(node('small',text,'muted'));
   if(row.original){
    const source=node('details');source.append(node('summary','历史主账原文'),
     node('p',Object.entries(row.original).filter(([,value])=>value).map(([key,value])=>key+' '+value).join('\n')));
    item.append(source);
   }
   list.append(item);
  }
  list.append(node('h3','医生诊断'),button('记录医生诊断',()=>showEditor('diagnoses'),'btn btn-secondary'));
  for(const row of data.diagnoses){
   const item=node('section',null,'medical-item');
   item.append(node('strong',row.description),node('p',[labelDate(row.date),row.institution,row.evidence].filter(Boolean).join(' · ')));
   list.append(item);
  }
 }
 function trends(data){
  const options=new Map(data.measurements.map(row=>[indicatorKey(matchIndicator(data,row)),row.name]));
  if(!options.size){list.append(node('p','暂无指标记录。','form-hint'));return;}
  const picker=node('select');picker.dataset.picker='';
  picker.append(...[...options].map(([id,name])=>new Option(name,id)));
  if(!options.has(selected))selected=options.keys().next().value;
  picker.value=selected;
  const label=node('label','选择指标');label.append(picker);
  const trend=node('div',null,'medical-trend');
  list.append(label,trend);
  function renderTrend(){
   const series=medicalTrend(data,selected);
   trend.replaceChildren();
   if(!series.groups.length)trend.append(node('p','至少两次日期明确、单位和检测方法一致的数值结果才能比较。','form-hint'));
   for(const group of series.groups){
    const start=group.points[0],end=group.points.at(-1);
    const diff=Number((end.value-start.value).toPrecision(6));
    const section=node('section',null,'medical-item');
    section.append(node('strong',group.method+' · '+group.unit),plot(group.points),node('small',
     description(start)+' → '+description(end)+' · 变化 '+(diff>0?'+':'')+diff+' '+group.unit,'muted'));
    trend.append(section);
   }
   for(const row of [...series.rows].reverse())trend.append(measurementView(row,false));
  }
  picker.onchange=()=>{selected=picker.value;renderTrend();};renderTrend();syncChoiceFields(list);
 }
 function render(){
  const data=medicalData(getState());
  list.replaceChildren();
  title.textContent=views[view];
  if(view==='reports')reports(data);
  if(view==='trends')trends(data);
  if(view==='symptoms')symptoms(data);
  if(view==='profile'){
   const row=data.profile[0];
   for(const line of [row?.name,row?.birthDate&&'出生日期 '+row.birthDate,row?.sex&&'性别 '+row.sex,row?.notes].filter(Boolean))
    list.append(node('p',line));
   if(!row)list.append(node('p','暂无基础资料。','form-hint'));
   list.append(button('编辑资料',()=>showEditor('profile'),'btn btn-secondary'));
  }
 }
 panel.onclick=event=>{
  const control=event.target.closest('[data-medical-view]');
  if(!control)return;
  trigger=control;view=control.dataset.medicalView;
  editor.hidden=true;editor.replaceChildren();formDraft=null;
  render();body.scrollTop=0;sheet.showModal();
 };
 sheet.addEventListener('close',()=>{editor.hidden=true;editor.replaceChildren();formDraft=null;trigger?.focus({preventScroll:true});});
 return ()=>{
  if(sheet.open&&!saving&&!formDraft){
   const scroll=body.scrollTop;render();body.scrollTop=scroll;
  }
 };
}
