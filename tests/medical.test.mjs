import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addFood,cycleForDate,dayIntake,newState,validateAppState} from '../health/core.mjs';
import {ensureMedical,indicatorKey,makeMedicalAttachment,matchIndicator,medicalAttachmentBytes,medicalCounts,
 medicalData,medicalExport,medicalTrend,referenceFlag,saveMedicalNote,saveMedicalReport} from '../health/medical.mjs';
import {combinedBackup,unpackBackup} from '../health/backup.mjs';
import {exportState} from '../health/storage.mjs';
import {importSource} from '../health/sync-source.mjs';
import {planHealthMerge} from '../health/sync.mjs';
import {createSyncPackage,projectExternalLedger} from '../health/sync-io.mjs';
import {freshData} from '../finance-storage.mjs';
import {extractMedicalFacts,medicalIntent,reportDraft,setMedicalAuto,useMedicalTurn} from '../ai/medical-chat.mjs';
import {modelRequest,parseResult} from '../ai/responses.mjs';
import {readAppDocument,prepareDocumentEdit,setDocumentAccess} from '../ai/documents.mjs';
import {readAppData} from '../ai/data.mjs';
import {contextFor} from '../ai/context.mjs';
import {threadBook} from '../ai/threads.mjs';
import {selectSkills,skillCatalog} from '../ai/skills.mjs';
import {lab,medicalFixture,reportCandidate,syntheticPdf} from './medical-fixture.mjs';

const today='2030-08-04';
const raw={
 handoff_version:'301120.1',canonical_source:'health_tracker_301120.1.json',tables:{
  food_events:[],weight_events:[],food_inventory:[],
  medical_baseline:[
   {指标:'空腹血糖',结果:'6.2 mmol/L','状态/参考':'3.9–6.1 mmol/L',体检日期:'2021-02-10',当前意义:'合成原文'},
   {指标:'尿蛋白',结果:'未检出',体检日期:'未记载',类别:'合成检验'}
  ],
  symptom_events:[{日期:'2021-02-11',报告时间:'12:15',用户原话:'合成不适',诊断状态:'尚未确诊',备注:'待观察'}]
 }
};
const file=title=>new File([syntheticPdf(title)],'合成报告.pdf',{type:'application/pdf'});
const attachment=title=>makeMedicalAttachment(file(title));
function mock(){
 let state=medicalFixture();
 const map=new Map();
 return {finance:{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)},
  account:{},readHealth:async()=>structuredClone(state),saveHealth:async(next,rev,guard)=>{
   guard?.();assert.equal(rev,state.revision??0);assert.ok(validateAppState(next));
   state=structuredClone({...next,revision:rev+1});
  }};
}
test('archival legacy data imports exact evidence, leaves diagnosis empty and is idempotent',()=>{
 const baseline=importSource(raw).health;
 const medical=medicalData(baseline);
 assert.deepEqual(medicalCounts(baseline),{reports:2,measurements:2,symptoms:1,diagnoses:0,profile:0,attachments:0});
 assert.equal(medical.measurements[0].value,6.2);
 assert.equal(medical.measurements[0].unit,'mmol/L');
 assert.deepEqual(medical.measurements[0].original,raw.tables.medical_baseline[0]);
 assert.equal(medical.reports[1].date,null);
 assert.equal(medical.measurements[1].result,'未检出');
 assert.equal(medical.symptoms[0].uncertainty,'尚未确诊');
 assert.equal(medical.symptoms[0].time,'12:15');
 const old=structuredClone(baseline);
 delete old.local.medical;
 addFood(old,{date:'2021-02-10',name:'合成午餐',kcal:550,meal:'午餐'});
 const cycle=cycleForDate(old,'2021-02-10',today);
 assert.deepEqual(medicalCounts(ensureMedical(structuredClone(old))),medicalCounts(baseline));
 const first=planHealthMerge(old,importSource(raw));
 assert.equal(first.unresolved.length,0);
 assert.equal(first.problems.length,0);
 const again=planHealthMerge(first.next,importSource(raw));
 assert.equal(again.changed,false);
 assert.deepEqual(cycleForDate(first.next,'2021-02-10',today),cycle);
 assert.deepEqual(dayIntake(first.next,'2021-02-10'),dayIntake(old,'2021-02-10'));
});
test('indicator identity uses standard codes first and trends compare only known consistent units and methods',()=>{
 const state=medicalFixture();
 const row={...lab(),code:null,name:'FPG'};
 assert.equal(matchIndicator(medicalData(state),row).code,'1558-6');
 const readings=[
  ['2023-03-07',lab({unit:'mg/dL',value:93})],
  ['2023-04-07',lab({method:null,value:6.3})],
  ['2023-10-07',lab({method:'其他方法',value:6.4})],
  ['2024-03-07',lab({value:null,result:'未检出',unit:null,method:null})]
 ];
 for(const [date,measurement] of readings)saveMedicalReport(state,{date,measurements:[measurement]});
 const {rows,groups}=medicalTrend(medicalData(state),indicatorKey(lab()));
 assert.equal(rows.length,6);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].points.map(row=>row.value),[5.2,6]);
 assert.deepEqual(groups[0].points.map(row=>row.flag),['within','high']);
 assert.equal(rows[2].flag,null);
 assert.equal(rows.at(-1).flag,null);
});
test('flags honor each report bounds and units, including strictly exclusive bounds and missing information',()=>{
 assert.equal(referenceFlag(lab({value:6.1,reference:'<6.1 mmol/L'})),'high');
 assert.equal(referenceFlag(lab({value:6.1,reference:'≤6.1 mmol/L'})),'within');
 assert.equal(referenceFlag(lab({value:3.9,reference:'> 3.9 mmol/L'})),'low');
 assert.equal(referenceFlag(lab({value:-1,reference:'-2.0–-0.5'})),'within');
 assert.equal(referenceFlag(lab({value:100,reference:'3.9–6.1 mg/dL'})),null);
 assert.equal(referenceFlag(lab({value:7,reference:'偏高，须结合临床'})),null);
 assert.equal(referenceFlag(lab({value:null,result:'阳性',reference:'阴性'})),'outside');
});
test('manual clinician source is separate and impossible dates are rejected until verified',()=>{
 const state=newState();
 assert.throws(()=>saveMedicalReport(state,{date:'2026-02-29'}),/体检日期/);
 assert.throws(()=>saveMedicalNote(state,'diagnoses',{date:'2024-02-29',description:'疑似',evidence:'无',source:'ai'}),/医生诊断/);
 assert.throws(()=>saveMedicalNote(state,'diagnoses',{date:null,description:'疑似合成情况',
  evidence:'合成门诊记录',source:'clinician-confirmed'}),/待确诊/);
 saveMedicalNote(state,'symptoms',{date:null,description:'合成发冷',visit:'曾就诊'});
 saveMedicalNote(state,'diagnoses',{date:'2024-02-29',description:'合成医生诊断',source:'clinician-confirmed',evidence:'合成门诊记录'});
 assert.equal(medicalData(state).symptoms.length,1);
 assert.equal(medicalData(state).diagnoses.length,1);
 assert.ok(validateAppState(state));
});
test('attachments dedupe by content, survive backup and repeated sync, and fail integrity after tampering',async()=>{
 const state=newState(),pdf=await attachment();
 const fields={date:'2021-02-10',measurements:[lab()]};
 const first=saveMedicalReport(state,fields,[pdf],{rejectConflicts:true});
 const repeated=saveMedicalReport(state,fields,[pdf],{rejectConflicts:true});
 assert.equal(repeated.id,first.id);assert.equal(repeated.changed,false);
 assert.throws(()=>saveMedicalReport(state,{...fields,date:'2021-02-12'},[pdf]),/不同的体检日期/);
 const ledger=freshData(),combined=combinedBackup(state,ledger);
 const restored=unpackBackup(JSON.parse(JSON.stringify(combined)));
 assert.deepEqual(restored.finance,JSON.parse(JSON.stringify(ledger)));
 assert.equal(restored.health.local.medical.attachments[0].id,pdf.id);
 assert.equal(new TextDecoder().decode(medicalAttachmentBytes(restored.health.local.medical.attachments[0])),syntheticPdf());
 const combinedDamaged=structuredClone(combined);
 const damaged=combinedDamaged.health.local.medical.attachments[0];
 damaged.data=damaged.data.slice(0,20)+(damaged.data[20]==='A'?'B':'A')+damaged.data.slice(21);
 assert.throws(()=>unpackBackup(combinedDamaged),/完整性校验/);
 const metadata=JSON.parse(exportState(state,false));
 assert.deepEqual(metadata.local.medical.reports[0].attachmentIds,[pdf.id]);
 assert.equal(metadata.local.medical.attachments.length,0);
 const source=createSyncPackage(state,{id:'synth',version:'0.9.15'});
 assert.equal(source.health.local.medical.attachments.length,1);
 const noAttachments=createSyncPackage(state,{id:'synth',version:'0.9.15',includeMedicalAttachments:false});
 assert.equal(noAttachments.health.local.medical.attachments.length,0);
 const preview=planHealthMerge(newState(),importSource(source),{finance:ledger});
 assert.equal(preview.problems.length,0);
 assert.equal(preview.unresolved.length,0);
 assert.deepEqual(preview.next.local.medical,state.local.medical);
 const row=preview.rows.find(row=>row.kind==='medical-attachments');
 assert.equal('data' in row.after,false);
 const again=planHealthMerge(preview.next,importSource(source),{finance:ledger});
 assert.equal(again.changed,false);
 await assert.rejects(makeMedicalAttachment(new File(['<html/>'],'fake.pdf',{type:'application/pdf'})),/格式不符/);
});
test('archive sync reports conflicts and external projection keeps legacy tables and optional bytes',async()=>{
 const state=importSource(raw).health;
 const pdf=await attachment();
 saveMedicalReport(state,{date:'2020-05-03',measurements:[lab()]},[pdf]);
 const outpatient=medicalData(state).symptoms[0];
 const other=structuredClone(state);medicalData(other).symptoms[0].change='另一方的更正';
 const source=createSyncPackage(other,{id:'other',version:'0.9.15'});
 const preview=planHealthMerge(state,importSource(source));
 assert.equal(preview.unresolved.length,1);
 assert.equal(preview.unresolved[0].kind,'medical-symptoms');
 const keep=planHealthMerge(state,importSource(source),{choices:{[preview.unresolved[0].id]:'keep'}});
 assert.equal(keep.next.local.medical.symptoms[0].change,outpatient.change);
 const external=projectExternalLedger(raw,state,{version:'301120.2',id:'device',includeMedicalAttachments:true});
 assert.deepEqual(external.tables,raw.tables);
 const reopened=importSource(external).health;
 assert.equal(medicalData(reopened).attachments[0].id,pdf.id);
 const small=medicalExport({ ...reopened,legacy:{...reopened.legacy,sourceSnapshot:external}},false);
 assert.equal(small.legacy.sourceSnapshot.airplane_medical.attachments.length,0);
 assert.equal(small.legacy.sourceSnapshot.airplane_sync.health.local.medical.attachments.length,0);
});
test('scoped Responses PDF and PNG requests never include model history, medical identity or general ledger tools',()=>{
 const input={mode:'chat',text:'解读空腹血糖',date:today,history:[{role:'user',text:'history-instance'}]};
 const facts=extractMedicalFacts(medicalFixture(),'解读空腹血糖',today);
 assert.equal(facts.length,1);
 assert.equal(facts[0].value,6);
 const medical={kind:'explain',facts,files:[{type:'application/pdf',data:'PDF'}, {type:'image/png',data:'PNG'}]};
 const request=modelRequest(input,{medical,allowRead:true,autoMemory:true,documentAccess:true,
  memory:[{text:'user-secret'}],healthContext:{private:'never serializable'}});
 const serialized=JSON.stringify(request);
 for(const word of ['history-instance','user-secret','never serializable','不出设备','载体专用','read_app_document','previous_response_id'])
  assert.ok(!serialized.includes(word),word);
 assert.equal(request.store,false);
 const [context,,pdf,,photo]=request.input[0].content;
 assert.equal(JSON.parse(context.text).selectedIndicators.length,1);
 assert.equal(pdf.type,'input_file');assert.equal(pdf.file_data,'data:application/pdf;base64,PDF');
 assert.equal(photo.type,'input_image');
 const result={explanation:'合成解释',uncertainty:'仅限所选指标'};
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]};
 assert.deepEqual(parseResult(response,input,{medical}),result);
 assert.throws(()=>parseResult(response,input,{medical:{kind:'extract'}}));
});
test('archive Skill loads selectively and draft auto-save requires textual date and evidence',()=>{
 const store=mock().finance;
 assert.ok(selectSkills(skillCatalog(store),{text:'查看体检指标'}).some(skill=>skill.id==='medical'));
 assert.ok(!selectSkills(skillCatalog(store),{text:'今天吃一袋鸡胸'}).some(skill=>skill.id==='medical'));
 assert.equal(reportDraft(reportCandidate(today),today).auto,true);
 assert.equal(reportDraft(reportCandidate(today,{dateEvidence:'报告日期不清'}),today).auto,false);
 assert.equal(reportDraft(reportCandidate('2030-13-01'),today).date,null);
 assert.equal(reportDraft(reportCandidate(today,{measurements:[lab({value:58})]}),today).auto,false);
 assert.equal(reportDraft(reportCandidate(today,{measurements:[lab({value:5.8,result:'< 5.8'})]}),today).auto,false);
 assert.equal(medicalIntent('',0,1),'extract');
 assert.equal(medicalIntent('分析这份报告',0,1),'explain');
 assert.equal(medicalIntent('查空腹血糖趋势',0,0),'read');
 assert.equal(medicalIntent('',1,0),null);
});
test('local Agent archive applies manual preview or granted deduplicated save, and explanation stays read only',async()=>{
 const workspace=mock(),shows=[];
 let preview,requests=0;
 const task={kind:'extract',text:'',files:[file()],allowed:()=>true,
  ask:async(_text,input)=>{requests++;assert.equal(input.files.length,1);return reportCandidate('2023-05-02');},
  show:(...args)=>shows.push(args),review:value=>preview=value};
 await useMedicalTurn(workspace,task);
 assert.equal(requests,1);assert.ok(preview);
 assert.equal(medicalData(await workspace.readHealth()).attachments.length,0);
 assert.match(await preview.save('2023-05-02'),/已在本机保存/);
 setMedicalAuto(workspace.finance,true);
 await useMedicalTurn(workspace,task);
 assert.match(shows.at(-1)[0],/未重复录入/);
 preview=null;
 await useMedicalTurn(workspace,{...task,text:'仅预览体检报告，不要保存'});
 assert.ok(preview);
 const saved=await workspace.readHealth();
 assert.equal(medicalData(saved).attachments.length,1);
 await useMedicalTurn(workspace,{...task,kind:'read',text:'查空腹血糖趋势',files:[]});
 assert.match(shows.at(-1)[1],/己糖激酶法/);
 await useMedicalTurn(workspace,{...task,kind:'explain',text:'解读空腹血糖',files:[],ask:async(_text,{facts,files})=>{
  assert.equal(files.length,0);assert.equal(facts.length,1);assert.equal(facts[0].value,5.8);
  return {explanation:'合成解释',uncertainty:'区间以原报告为准'};
 }});
 assert.deepEqual(saved,await workspace.readHealth());
});
test('explicitly keeping an original on this device bypasses the model and keeps the selected file',async()=>{
 const workspace=mock();
 let preview;
 await useMedicalTurn(workspace,{kind:'extract',text:'不要上传这份体检报告，先保存在本机',files:[file()],
  ask:()=>{throw Error('本机操作不调用模型');},allowed:()=>true,show:()=>{},review:value=>preview=value});
 assert.equal(preview.title,'保存本机体检原件');
 assert.match(await preview.save('2023-05-02'),/已在本机保存/);
 assert.equal(medicalData(await workspace.readHealth()).attachments.length,1);
});
test('generic documents and chat context exclude protected medical records, including backup migration source',async()=>{
 const workspace=mock();
 const state=await workspace.readHealth();
 state.legacy.sourceSnapshot=structuredClone(raw);
 await workspace.saveHealth(state,0);
 setDocumentAccess(workspace.finance,true);
 const document=await readAppDocument(workspace,{document:'health',path:'',view:'value'});
 assert.equal(document.value.local.medical,undefined);
 assert.equal(document.value.legacy.sourceSnapshot.tables.medical_baseline,undefined);
 assert.equal(document.value.legacy.sourceSnapshot.tables.symptom_events,undefined);
 await assert.rejects(prepareDocumentEdit(workspace,{document:'health',patch:JSON.stringify([
  {op:'remove',path:'/local/medical'}])}),/健康档案只能/);
 const book=threadBook(workspace.finance);
 book.append('user','合成病情词',false,undefined,{privateMedical:true});
 book.append('assistant','状态',true);
 assert.equal(book.current.title,'健康档案');
 assert.equal(JSON.stringify(contextFor(book.current)).includes('合成病情词'),false);
 const messages=await readAppData(workspace,book,{dataset:'conversation_messages',id:book.current.id,date:null,query:'',fields:[]});
 assert.equal(JSON.stringify(messages).includes('合成病情词'),false);
 const chat=await readAppDocument(workspace,{document:'conversations',path:'',view:'value'});
 assert.equal(JSON.stringify(chat).includes('合成病情词'),false);
});
