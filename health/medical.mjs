import * as cryptoLibrary from '../vendor/nacl-fast.min.js';

const nacl=cryptoLibrary.default??globalThis.nacl;
const encoder=new TextEncoder();
const MEDIA_TYPES=['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'];
export const MEDICAL_FILE_LIMIT=16*1024*1024;
export const MEDICAL_TABLES=['reports','measurements','symptoms','diagnoses','profile','attachments'];
const medicalType={reports:'体检报告',measurements:'体检指标',symptoms:'症状',diagnoses:'医生诊断',profile:'个人基础资料',attachments:'体检附件'};
export const medicalTableLabel=table=>medicalType[table];
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const unconfirmed=value=>/疑似|待排|待确诊|未确诊|尚未明确诊断|可能为/.test(value);
const optionalString=value=>value===null||typeof value==='string';
const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const key=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-()（）·]/g,'');
const unitKey=value=>String(value??'').normalize('NFKC').replace(/\s/g,'');
const isoDate=value=>date(String(value??'').slice(0,10))?String(value).slice(0,10):null;
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const digest=bytes=>hex(nacl.hash(bytes));
const hashText=value=>digest(encoder.encode(JSON.stringify(value))).slice(0,36);
const sorted=value=>JSON.stringify(value,(_key,item)=>object(item)?
 Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const validId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_:-]{0,179}$/i.test(value);
const attachmentId=value=>typeof value==='string'&&/^sha512-[a-f0-9]{128}$/.test(value);
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const empty=()=>Object.fromEntries(MEDICAL_TABLES.map(name=>[name,[]]));
export const medicalData=state=>state.local.medical??empty();
export const medicalCounts=state=>Object.fromEntries(MEDICAL_TABLES.map(table=>[table,medicalData(state)[table].length]));

function withoutMissing(array){return Array.isArray(array)?array.filter(object):[];}
function migrateTables(tables){
 const medical=empty(),reports=new Map();
 for(const row of withoutMissing(tables?.medical_baseline)){
  const name=text(row.指标),originalDate=row.体检日期??null;
  const when=isoDate(originalDate),institution=text(row.机构??row.体检机构);
  const reportId='legacy-report:'+hashText([when??originalDate,institution]);
  if(!reports.has(reportId))reports.set(reportId,{id:reportId,date:when,institution,note:null,attachmentIds:[],
   source:'legacy',originalDate,uncertainty:when?null:'原体检日期待核对'});
  const result=text(row.结果);
  const match=result?.normalize('NFKC').match(/^([+-]?\d+(?:\.\d+)?)\s*([A-Za-zμµ%°][A-Za-zμµ%°0-9/·^.\-²³]+|[%gL]|毫米汞柱|千克|公斤)?$/);
  const unit=text(row.单位??match?.[2]);
  const status=text(row['状态/参考']);
  const citedRange=status&&/^(?:[<>≤≥]|[+-]?\d+(?:\.\d+)?\s*[–—~～至-]\s*[+-]?\d|阴性$|未检出$)/.test(status.normalize('NFKC'));
  const reference=text(row['参考范围'])??(citedRange?status:null);
  const identity=row.id??row.记录ID??[reportId,name,row.检测方法??row.方法??null];
  const baseId='legacy-lab:'+hashText(identity);
  const id=medical.measurements.some(item=>item.id===baseId&&!Object.is(sorted(item.original),sorted(row)))?
   baseId+':'+hashText(sorted(row)):baseId;
  medical.measurements.push({id,reportId,name:name??'未命名指标',code:text(row.标准代码??row.code),
   value:match?Number(match[1]):null,result,unit,method:text(row.检测方法??row.方法),
   reference,...(status&&status!==reference?{legacyStatus:status}:{}),evidence:result,source:'legacy',
   uncertainty:text(row.不确定性)??'转录自历史主账，原始报告和方法可能缺失',original:structuredClone(row)});
 }
 medical.reports=[...reports.values()];
 for(const row of withoutMissing(tables?.symptom_events)){
  const originalDate=row.日期??null;
   const id='legacy-symptom:'+hashText(row.id??row.记录ID??[originalDate,row.报告时间,row.用户原话??row.症状]);
  medical.symptoms.push({id,date:isoDate(originalDate),time:text(row.报告时间),originalDate,
   description:text(row.用户原话)??text(row.症状)??'原症状描述缺失',change:text(row.变化??row.备注),
   visit:text(row.就诊情况),uncertainty:text(row.诊断状态)??'原主账未确认诊断',
   source:'legacy',original:structuredClone(row)});
 }
 for(const table of ['measurements','symptoms']){
  const list=medical[table];
  medical[table]=[...new Map(list.map(row=>[row.id,row])).values()];
 }
 return medical;
}

export function ensureMedical(state,external=state.legacy?.sourceSnapshot){
 if(state.local.medical)return state;
 const legacy=migrateTables(external?.tables);
 const native=external?.airplane_medical;
 if(native!=null){
  if(!validMedical(native))throw Error('健康档案格式无效');
  verifyMedicalFiles(native);
  for(const table of MEDICAL_TABLES){
   const rows=new Map(legacy[table].map(row=>[row.id,row]));
   for(const row of native[table])rows.set(row.id,structuredClone(row));
   legacy[table]=[...rows.values()];
  }
 }
 if(MEDICAL_TABLES.some(table=>legacy[table].length))state.local.medical=legacy;
 return state;
}

export function validMedical(data){
 if(data===undefined)return true;
 if(!object(data)||!MEDICAL_TABLES.every(table=>Array.isArray(data[table])&&
  data[table].every(row=>object(row)&&validId(row.id))&&new Set(data[table].map(row=>row.id)).size===data[table].length))
  return false;
 const reports=new Set(data.reports.map(row=>row.id));
 const strings=(row,fields)=>fields.every(key=>optionalString(row[key]));
 const dated=row=>row.date===null||date(row.date);
 return data.reports.every(row=>dated(row)&&strings(row,['institution','note'])&&Array.isArray(row.attachmentIds)&&
   row.attachmentIds.every(attachmentId)&&new Set(row.attachmentIds).size===row.attachmentIds.length)&&
  data.measurements.every(row=>reports.has(row.reportId)&&text(row.name)&&(row.value===null||numeric(row.value))&&
   strings(row,['code','result','unit','method','reference','evidence','uncertainty'])&&typeof row.source==='string')&&
  data.symptoms.every(row=>dated(row)&&text(row.description)&&strings(row,['time','change','visit','uncertainty']))&&
  data.diagnoses.every(row=>dated(row)&&text(row.description)&&!unconfirmed(row.description)&&text(row.evidence)&&row.source==='clinician-confirmed')&&
  data.profile.length<=1&&data.profile.every(row=>row.id==='personal'&&(row.birthDate===null||date(row.birthDate))&&
   strings(row,['name','sex','notes']))&&
  data.attachments.every(row=>attachmentId(row.id)&&MEDIA_TYPES.includes(row.type)&&typeof row.name==='string'&&
   Number.isInteger(row.size)&&row.size>0&&row.size<=MEDICAL_FILE_LIMIT&&typeof row.data==='string'&&
   row.data.length===Math.ceil(row.size/3)*4);
}

const header=(bytes,start=0,length=12)=>String.fromCharCode(...bytes.subarray(start,start+length));
function signature(type,bytes){
 if(type==='application/pdf')return header(bytes,0,5)==='%PDF-';
 if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(type==='image/png')return header(bytes,0,8)==='\u0089PNG\r\n\u001a\n';
 if(type==='image/webp')return header(bytes,0,4)==='RIFF'&&header(bytes,8,4)==='WEBP';
 return header(bytes,4,4)==='ftyp';
}
const encode=bytes=>{
 let value='';
 for(let start=0;start<bytes.length;start+=0x8000)value+=String.fromCharCode(...bytes.subarray(start,start+0x8000));
 return btoa(value);
};
export function medicalAttachmentBytes(row){
 const raw=atob(row.data);
 const bytes=Uint8Array.from(raw,value=>value.charCodeAt(0));
 if(row.size!==bytes.length||!signature(row.type,bytes)||'sha512-'+digest(bytes)!==row.id)
  throw Error('体检附件完整性校验失败：'+row.name);
 return bytes;
}
export async function makeMedicalAttachment(file){
 const name=file.name?.split(/[\\/]/).at(-1).slice(0,150)||'体检附件';
 const extension=name.split('.').at(-1).toLowerCase();
 const type=MEDIA_TYPES.includes(file.type)?file.type:
  ({pdf:'application/pdf',jpeg:'image/jpeg',jpg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif'})[extension];
 if(!type||!file.size||file.size>MEDICAL_FILE_LIMIT)throw Error('请选择不超过 16 MB 的 PDF 或报告照片');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!signature(type,bytes))throw Error('体检附件的文件内容与格式不符');
 return {id:'sha512-'+digest(bytes),name,type,size:bytes.length,data:encode(bytes)};
}
export function verifyMedicalFiles(data){
 for(const row of data?.attachments??[]){
  try{medicalAttachmentBytes(row);}
  catch{throw Error('体检附件完整性校验失败：'+row.name);}
 }
}
export function verifyMedicalState(state){
 const snapshot=state?.legacy?.sourceSnapshot;
 for(const archive of [state?.local?.medical,snapshot?.airplane_medical,snapshot?.airplane_sync?.health?.local?.medical])
  verifyMedicalFiles(archive);
}
export function medicalExport(state,includeAttachments=true){
 verifyMedicalState(state);
 if(includeAttachments||!state.local.medical)return state;
 const result={...state,local:{...state.local,medical:{...state.local.medical,attachments:[]}}};
 const raw=state.legacy.sourceSnapshot;
 if(raw?.airplane_medical||raw?.airplane_sync?.health?.local?.medical){
  const snapshot={...raw};
  if(raw.airplane_medical)snapshot.airplane_medical={...raw.airplane_medical,attachments:[]};
  if(raw.airplane_sync?.health?.local?.medical){
   const {health}=raw.airplane_sync;
   snapshot.airplane_sync={...raw.airplane_sync,health:{...health,local:{...health.local,medical:{...health.local.medical,attachments:[]}}}};
  }
  result.legacy={...state.legacy,sourceSnapshot:snapshot};
 }
 return result;
}

const aliases=new Map([
 ['空腹血糖','空腹血糖'],['fpg','空腹血糖'],['fastingplasmaglucose','空腹血糖'],
 ['糖化血红蛋白','糖化血红蛋白'],['hba1c','糖化血红蛋白'],['甘油三酯','甘油三酯'],['tg','甘油三酯'],
 ['总胆固醇','总胆固醇'],['tc','总胆固醇'],['谷丙转氨酶','丙氨酸氨基转移酶'],['丙氨酸氨基转移酶','丙氨酸氨基转移酶'],['alt','丙氨酸氨基转移酶']
]);
const normalizedIndicator=name=>aliases.get(key(name))??key(name);
export const indicatorKey=row=>row.code?'code:'+key(row.code):'name:'+normalizedIndicator(row.name);
export function matchIndicator(data,row){
 const name=normalizedIndicator(row.name);
 const matches=data.measurements.filter(previous=>previous.code&&
  (row.code?key(previous.code)===key(row.code):normalizedIndicator(previous.name)===name));
 const codes=new Set(matches.map(previous=>key(previous.code)));
 if(codes.size===1)return {...row,code:matches[0].code};
 return row;
}

const qualitative=value=>({阴性:'negative',未检出:'negative',negative:'negative',
 阳性:'positive',检出:'positive',positive:'positive'})[key(value)];
const qualified=value=>typeof value==='string'&&/^[<>≤≥]/.test(value.normalize('NFKC').trim());
export function referenceFlag(row){
 if(!row.reference||qualified(row.result))return null;
 if(!numeric(row.value)){
  const result=qualitative(row.result),reference=qualitative(row.reference);
  return result&&reference?(result===reference?'within':'outside'):null;
 }
 const ref=row.reference.normalize('NFKC').trim();
 const number='([+-]?\\d+(?:\\.\\d+)?)';
 const bounds=new RegExp('^'+number+'\\s*(?:[–—~～至-])\\s*'+number+'\\s*(.*)$').exec(ref);
 const single=new RegExp('^\\s*(<=|>=|<|>|≤|≥)\\s*'+number+'\\s*(.*)$').exec(ref);
 const unitMatches=unit=>!unit||Boolean(row.unit&&unitKey(row.unit)===unitKey(unit));
 if(bounds&&unitMatches(bounds[3])){
  const low=Number(bounds[1]),high=Number(bounds[2]);
  if(low>high)return null;
  return row.value<low?'low':row.value>high?'high':'within';
 }
 if(single&&unitMatches(single[3])){
  const bound=Number(single[2]);
  const operator=single[1];
  if(operator==='<')return row.value>=bound?'high':'within';
  if(operator==='<='||operator==='≤')return row.value>bound?'high':'within';
  if(operator==='>')return row.value<=bound?'low':'within';
  return row.value<bound?'low':'within';
 }
 return null;
}

export function medicalTrend(data,indicator){
 const reports=new Map(data.reports.map(report=>[report.id,report]));
 const rows=data.measurements.filter(row=>indicatorKey(matchIndicator(data,row))===indicator)
  .map(row=>({...row,date:reports.get(row.reportId)?.date??null,flag:referenceFlag(row)}))
  .sort((a,b)=>(a.date??'9999').localeCompare(b.date??'9999'));
 const comparable=new Map();
 for(const row of rows){
  if(!row.date||!numeric(row.value)||!row.unit||!row.method)continue;
  const id=JSON.stringify([unitKey(row.unit),key(row.method)]);
  (comparable.get(id)??(comparable.set(id,[]),comparable.get(id))).push(row);
 }
 const groups=[...comparable.values()].filter(group=>new Set(group.map(row=>row.date)).size>1).map(group=>{
  const repeats=new Set(group.filter((row,index)=>group.some((other,i)=>index!==i&&other.date===row.date)).map(row=>row.date));
  const points=group.filter(row=>!repeats.has(row.date));
  return {unit:group[0].unit,method:group[0].method,points};
 }).filter(group=>group.points.length>=2);
 return {rows,groups};
}

export function saveMedicalReport(state,fields,attachments=[],options={}){
 const data=state.local.medical??=empty();
 if(!date(fields.date))throw Error('请核对体检日期');
 const ids=[...new Set(attachments.map(row=>row.id))];
 for(const file of attachments)medicalAttachmentBytes(file);
 const historical=data.reports.filter(report=>ids.some(id=>report.attachmentIds.includes(id)));
 if(historical.some(report=>report.date!==fields.date))throw Error('该附件已有不同的体检日期，请在体检记录核对。');
 if(historical.length>1)throw Error('附件匹配多个报告，请合并前核对。');
 const sameMetric=(a,b)=>indicatorKey(matchIndicator(data,a))===indicatorKey(matchIndicator(data,b))&&
  unitKey(a.unit)===unitKey(b.unit)&&key(a.method)===key(b.method);
 const sameResult=(a,b)=>a.value===b.value&&(a.value!=null||key(a.result)===key(b.result));
 const sameDay=options.dedupeByResult?data.reports.filter(report=>report.date===fields.date&&
  (!report.institution||!fields.institution||key(report.institution)===key(fields.institution))&&
  data.measurements.some(row=>row.reportId===report.id&&(fields.measurements??[]).some(candidate=>
   sameMetric(row,candidate)&&sameResult(row,candidate)))):[];
 const previous=data.reports.find(row=>row.id===options.reportId)??historical[0]??(sameDay.length===1?sameDay[0]:null);
 if(options.reportId&&!previous)throw Error('找不到体检报告，请刷新。');
 const medicalSource=fields.source??'manual';
 const report=previous??{id:options.id??crypto.randomUUID(),date:fields.date,institution:text(fields.institution),
  note:text(fields.note),source:medicalSource,attachmentIds:[],...(fields.uncertainty?{uncertainty:fields.uncertainty}:{})};
 const base=data.measurements.filter(row=>row.reportId===report.id);
 const toAdd=[];
 for(const candidate of fields.measurements??[]){
  const row=matchIndicator(data,{id:crypto.randomUUID(),reportId:report.id,name:candidate.name?.trim(),
   code:text(candidate.code),result:text(candidate.result),value:qualified(candidate.result)?null:candidate.value??null,unit:text(candidate.unit),
   method:text(candidate.method),reference:text(candidate.reference),evidence:text(candidate.evidence),
   uncertainty:text(candidate.uncertainty),source:medicalSource});
  if(!row.name||row.value!==null&&!numeric(row.value))throw Error('指标名称或数值无效');
  const matches=[...base,...toAdd].filter(existing=>sameMetric(existing,row));
  if(matches.some(existing=>sameResult(existing,row)&&existing.reference===row.reference))continue;
  if(matches.length&&options.rejectConflicts)throw Error('同一报告已有「'+row.name+'」的不同结果，请在体检记录核对。');
  toAdd.push(row);
 }
 const addedFiles=attachments.some(file=>!data.attachments.some(row=>row.id===file.id));
 if(!previous)data.reports.push(report);
 report.attachmentIds=[...new Set([...report.attachmentIds,...ids])];
 for(const file of attachments)if(!data.attachments.some(row=>row.id===file.id))data.attachments.push(file);
 data.measurements.push(...toAdd);
 return {id:report.id,added:toAdd.length,changed:!previous||toAdd.length>0||addedFiles||ids.some(id=>!historical.some(row=>row.attachmentIds.includes(id)))};
}

export function saveMedicalNote(state,kind,fields){
 const data=state.local.medical??=empty();
 if(kind==='profile'){
  const row={id:'personal',name:text(fields.name),birthDate:text(fields.birthDate),sex:text(fields.sex),notes:text(fields.notes)};
  if(row.birthDate&&!date(row.birthDate))throw Error('请核对出生日期');
  data.profile=[row];return row;
 }
 const when=text(fields.date);
 if(when&&!date(when)||!text(fields.description))throw Error('请核对日期及描述');
 const id=fields.id??crypto.randomUUID(),description=text(fields.description),source=fields.source??'manual';
 if(kind==='diagnoses'){
  const evidence=text(fields.evidence);
  if(!evidence||source!=='clinician-confirmed')throw Error('请填写医生诊断的来源依据');
  if(unconfirmed(description))throw Error('疑似或待确诊内容可保存在症状的就诊情况中。');
  const row={id,date:when,description,evidence,source,institution:text(fields.institution)};
  data.diagnoses.push(row);return row;
 }
 if(kind!=='symptoms')throw Error('找不到档案记录类型');
 const previous=data.symptoms.find(row=>row.id===id);
 if(previous)return previous;
 const row={id,date:when,time:text(fields.time),description,change:text(fields.change),visit:text(fields.visit),
  uncertainty:text(fields.uncertainty),source};
 data.symptoms.push(row);return row;
}

export function redactMedicalDocument(value){
 // Only the in-app medical workflow handles medical data and attachment bytes.
 if(!object(value))return value;
 const omitTables=table=>Object.fromEntries(Object.entries(table??{}).filter(([key])=>!['medical_baseline','symptom_events'].includes(key)));
 const clean={...value};
 if(clean.health)clean.health=redactMedicalDocument(clean.health);
 if(clean.local?.medical){clean.local={...clean.local};delete clean.local.medical;}
 if(clean.legacy?.sourceSnapshot){
  const raw=clean.legacy.sourceSnapshot;
  clean.legacy={...clean.legacy,sourceSnapshot:{...raw,tables:omitTables(raw.tables)}};
  if(raw.tables?.medical_baseline||raw.tables?.symptom_events)delete clean.legacy.sourceSnapshot.current;
  delete clean.legacy.sourceSnapshot.airplane_medical;
  delete clean.legacy.sourceSnapshot.airplane_sync;
 }
 if(clean.sync?.sources){
  clean.sync={...clean.sync,sources:Object.fromEntries(Object.entries(clean.sync.sources).map(([id,source])=>[id,{
   ...source,...(source.changes?{changes:source.changes.filter(row=>!row.type?.startsWith('medical-'))}:{}),
   ...(source.anchors?{anchors:Object.fromEntries(Object.entries(source.anchors).filter(([name])=>!name.startsWith('medical-')))}:{})
  }]))};
 }
 return clean;
}

export function medicalDocumentContent(value){
 const health=value?.health??value;
 const raw=health?.legacy?.sourceSnapshot;
 const sync=Object.fromEntries(Object.entries(health?.sync?.sources??{}).flatMap(([id,row])=>{
  const changes=(row.changes??[]).filter(change=>change.type?.startsWith('medical-'));
  const anchors=Object.fromEntries(Object.entries(row.anchors??{}).filter(([name])=>name.startsWith('medical-')));
  return changes.length||Object.keys(anchors).length?[[id,{changes,anchors}]]:[];
 }));
 return {medical:health?.local?.medical,legacy:raw?.tables?.medical_baseline,symptoms:raw?.tables?.symptom_events,
  externalProfile:raw?.airplane_medical,externalBridge:raw?.airplane_sync?.health?.local?.medical,sync};
}
