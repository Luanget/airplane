import {APP_SCHEMA,NUTRIENTS,newState,normalizeLedger,numeric,round,sampleNutrientSum,validateAppState,validDate} from './core.mjs';
import {unpackBackup} from './backup.mjs';
import {normalizeClock} from '../calendar.mjs';

export const SYNC_FORMAT='airplane-health-sync-v1';
export const EVENT_TYPES=['foods','weights','activities'];
export const EVENT_TABLES={foods:'food_events',weights:'weight_events',activities:'activity_events'};
export const CATALOG_TABLES={
 aliases:['food_aliases'],
 prices:['price_catalog'],
 purchaseEvents:['purchase_events'],
 inventoryAudit:['inventory_transactions_audit','inventory_audit','inventory_audits','stock_audit','inventory_movements','inventory_history']
};

export const stable=value=>JSON.stringify(value,(_key,item)=>
 item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const same=(a,b)=>stable(a)===stable(b);
export function hash(value){
 let n=14695981039346656037n;
 for(const char of String(value))n=BigInt.asUintN(64,(n^BigInt(char.codePointAt(0)))*1099511628211n);
 return n.toString(16).padStart(16,'0');
}
export const normalized=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const rawValue=(row,fields)=>fields.map(key=>row[key]).find(value=>value!=null&&String(value).trim()!=='');
export const sourceId=row=>String(rawValue(row,['airplane_event_id','记录ID','事件ID','采购ID','流水ID','EventID','event_id','row_id','record_id','id','ID'])??'');
const forbiddenKeys=new Set(['__proto__','constructor','prototype']);
export const safeKey=value=>typeof value==='string'&&!!value&&!forbiddenKeys.has(value);
const actual=row=>row.status==='actual'||row.source==='legacy'&&row.actual;
export const foodStatus=row=>actual(row)?'actual':/^(plan|计划)/i.test(row.status??'')?'plan':'cancelled';
const copy=value=>structuredClone(value);
const list=(input,key)=>{
 const rows=input?.[key]??[];
 if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('无效的表：'+key);
 return rows;
};

function sourceName(input){
 const explicit=input.ledger_id??input.source_id??input.canonical_source??'health_tracker';
 return String(explicit).trim().replace(/\\/g,'/').split('/').at(-1)
  .replace(/_\d{6,8}(?:\.\d+)?(?=\.|$)/g,'').replace(/\.(?:json|sqlite|db)$/i,'')||'health_tracker';
}
export function inheritedLineage(state){
 const snapshot=state.legacy.sourceSnapshot;
 const canonical=snapshot?.ledger_id??snapshot?.source_id??snapshot?.canonical_source??state.importInfo?.canonicalSource;
 const version=String(snapshot?.handoff_version??state.importInfo?.sourceVersion??'').match(/^(\d{6,8}\.\d+)/)?.[1];
 if(canonical&&version)return {
  id:sourceName({canonical_source:canonical}),version,cutoff:String(snapshot?.updated_at??'').slice(0,10)
 };
 return state.sync?.lineage??null;
}

// The tidy main ledger records the original name verbatim. Only this explicit
// presentation metadata is ignored; a changed quantity, state or nutrient is
// still a different row that needs to be reconciled.
export function inheritedKey(type,row){
 if(!row)return null;
 if(type!=='foods')return hash(stable(row));
 const {'原食物/饮品名称':name,...original}=row;
 if(typeof name==='string'&&name.trim())original['食物/饮品']=name;
 return hash(stable(original));
}

function matchingBase(raw){
 // Prior releases embedded the exact file. Use it to recover source provenance
 // for old rows, never to compare positions between different files.
 const base=normalizeLedger(raw);
 const tables=raw.tables;
 const refs={};
 for(const type of EVENT_TYPES){
  const table=list(tables,EVENT_TABLES[type]);
  const rows=base.legacy[type];
  refs[type]=new Map(rows.map(row=>{
   const original=table[Number(row.id.slice(row.id.lastIndexOf('-')+1))];
   return [row.id,original??{}];
  }));
 }
 return {base,refs};
}
export function externalCatalogs(tables){
 return Object.fromEntries(Object.entries(CATALOG_TABLES).map(([kind,keys])=>[kind,keys.flatMap(table=>
  list(tables,table).map(row=>{
   const foodId=String(rawValue(row,['食品ID','标准食品ID','canonical_food_id','食物ID','SKU','sku','foodId','food_id'])??'');
   const name=String(rawValue(row,['名称','规范名称','标准名称','食品名称','食物/饮品','商品','商品名称','食品','name','food_name','product','item'])??'');
   const alias=String(rawValue(row,['别名','别称','匹配词','alias','alias_name'])??'');
   const date=String(rawValue(row,['日期','采购日期','时间','盘点日期','date','purchase_date','observedAt','updated'])??'').slice(0,10);
   const external=sourceId(row)||(kind==='prices'?String(row.price_id??''):
    kind==='purchaseEvents'&&row.order_id?String(row.order_id)+':'+hash(stable([foodId,name])):'');
   const data={table,foodId,name,date,...(external?{externalId:external}:{}),...(alias?{alias}:{}),
    ...(kind==='inventoryAudit'?{event:row.event??'',unit:row.unit??'',
     quantityDelta:numeric(row.qty_delta),priorBalance:numeric(row.prior_balance),remainingBalance:numeric(row.remaining_balance),
     foodEventAlreadyRecorded:row.food_event_already_recorded??null,
     financeId:String(rawValue(row,['financeId','finance_id','transaction_id','财务交易ID'])??'')}:{}),
    ...(kind==='prices'?{unit:String(rawValue(row,['价格基准','库存单位','单位','unit','price_basis','basis_unit'])??''),
      unitPrice:numeric(rawValue(row,['单价(CNY)','单价(元)','单价','unitPrice','unit_price','normalized_cny_per_unit']))}:{}),
    ...(kind==='purchaseEvents'?{totalCents:numeric(rawValue(row,['totalCents','total_cents']))??
      ((money)=>money===null?null:Math.round(money*100))(numeric(rawValue(row,['订单金额(CNY)','实付(CNY)','总价(CNY)','采购金额','金额(CNY)','金额','paid','total','amount','original_line_total_cny']))) }:{}),
    original:copy(row)};
   const time=normalizeClock(rawValue(row,['时间','采购时间','time'])??'');
   const merchant=normalized(rawValue(row,['商家','平台','来源','merchant','store','vendor'])??'');
   const business=kind==='aliases'&&alias?[foodId,name,alias]:kind==='prices'&&(name||foodId)?[foodId,name,date,data.unit]:
    kind==='purchaseEvents'&&date&&(name||foodId)?[date,time,foodId,normalized(name),merchant]:null;
   return {...data,id:table+':'+(external||hash(stable(business??row))),...(!external&&business?{business:true}:{})};
  })).map((row,index,all)=>row.business&&all.some((other,i)=>i!==index&&other.id===row.id)
   ?{...row,id:row.id+':'+hash(stable(row.original))}:row)]));
}
function compatibleBackup(health){
 if(health?.appType!==APP_SCHEMA||!health.local||!health.legacy||!health.settings)return health;
 const defaults=newState();
 return {...health,
  settings:Object.fromEntries(Object.entries({...defaults.settings,...health.settings}).map(([key,value])=>
   [key,value??defaults.settings[key]??null])),
  legacy:{...health.legacy,...Object.fromEntries(['foods','weights','activities','inventory','rules']
   .map(key=>[key,health.legacy[key]??[]])),daily:health.legacy.daily??{},energy:health.legacy.energy??{}},
  local:{...health.local,...Object.fromEntries(['foods','weights','activities','stockMoves']
   .map(key=>[key,health.local[key]??[]]))}
 };
}
export function importSource(input,{label,identity}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('请选择 JSON 账本或同步包');
 const pending=[input];
 while(pending.length){
  const node=pending.pop();
  for(const [key,value] of Object.entries(node)){
   if(forbiddenKeys.has(key))throw Error('文件含无效的对象键');
   if(value&&typeof value==='object')pending.push(value);
  }
 }
 let health,finance=null,raw=null,packageInfo=null;
 if(input.format===SYNC_FORMAT){
  health=input.health;packageInfo=input;
  if(!safeKey(input.source?.id)||!input.anchor||!Array.isArray(input.changes))throw Error('同步包缺少来源或锚点');
 }else if(input.format==='airplane-combined-v1'){
  ({health,finance}=unpackBackup({...input,health:compatibleBackup(input.health)}));
  if(!health)throw Error('文件里没有健康账本');
 }else if(input.appType===APP_SCHEMA)health=input;
 else if(input.tables){
  raw=input;
  const {base,refs}=matchingBase(input);
  for(const type of EVENT_TYPES)for(const row of base.legacy[type]){
   const original=refs[type].get(row.id);
   const id=sourceId(original);
   if(id)row.externalId=id;
   row.externalRow=original;
  }
  base.legacy.catalogs=externalCatalogs(input.tables);
  // Opening quantities are snapshots, not replayable purchases. Known
  // opening portions are retained as lots for a newly introduced SKU.
  health=base;
 }
 if(!raw)health=compatibleBackup(health);
 if(!validateAppState(health)||!Array.isArray(health.legacy.rules))throw Error('健康账本格式无效');
 const id=String(identity??(raw?sourceName(raw):packageInfo?.source.id??health.sync?.deviceId??'airplane-backup')).trim();
 if(!id)throw Error('请填写一个固定的来源名称');
 const sid=(raw?'external': 'airplane')+':'+id;
 // A matching checksum establishes that the embedded sidecar is the
 // representation of these exact projected tables. It includes the journals;
 // importing both the net raw balance and the sidecar movements would replay them.
 if(raw?.airplane_sync?.format===SYNC_FORMAT&&raw.airplane_sync.tablesHash===hash(stable(raw.tables))&&
  validateAppState(raw.airplane_sync.health)){
  health=raw.airplane_sync.health;packageInfo=raw.airplane_sync;
 }
 const version=String(raw?.handoff_version??packageInfo?.source.version??label?.match(/health_tracker_(\d{6,8}(?:\.\d+)?)/i)?.[1]??raw?.schema_version??
  input.exportedAt??health.exportedAt??health.revision??'未标版本');
 return {id:sid,version,label:label||id,health,finance,raw:raw&&packageInfo?null:raw,packageInfo};
}

export function originalEventRefs(state){
 const raw=state.legacy.sourceSnapshot;
 if(!raw?.tables)return {};
 try{return matchingBase(raw).refs;}catch{return {};}
}
export function eventIdentity(row,original={}){
 return String(row.externalId||sourceId(original)||(row.source!=='legacy'||!/^legacy-(food|weight|activity)-\d+$/.test(row.id??'')?row.id??'':''));
}
export function eventData(type,row){
 const base={date:row.date,time:normalizeClock(row.time)};
 if(type==='foods'){
  const obj={...base,name:normalized(row.name),meal:normalized(row.meal),status:foodStatus(row),
   portion:normalized(row.portion).replace(/\s*(?:克|g)(?=$|[（(])/i,'g').replace(/\s*(?:毫升|ml)$/i,'ml').replace(/\s+(?=[包袋个份盒瓶])/g,''),
   nutrition:Object.fromEntries(NUTRIENTS.map(key=>[key,numeric(row.nutrition?.[key])])),
   ...(row.weighing?{weighing:row.weighing}:{}),...(row.cost!=null?{cost:numeric(row.cost)}:{})};
  return obj;
 }
 if(type==='weights')return {...base,kg:numeric(row.kg),isMorning:row.isMorning??/^(?:是|暂定纳入|纳入)/.test(row.trendStatus??'')};
 return {...base,name:normalized(row.name),km:numeric(row.km),minutes:numeric(row.minutes),kcal:numeric(row.kcal),
  energyKind:row.energyKind??'activity',includedInBase:!!row.includedInBase,...(row.excludedFromEnergy?{excludedFromEnergy:true}:{}),status:row.status??''};
}

export function baselines(state){
 const dates=new Set([...Object.keys(state.legacy.daily),...Object.keys(state.legacy.energy)]);
 const rowsByDay=new Map(),activitiesByDay=new Map();
 for(const row of state.legacy.foods)if(actual(row)){
  if(!rowsByDay.has(row.date))rowsByDay.set(row.date,[]);
  rowsByDay.get(row.date).push(row);
 }
 for(const row of state.legacy.activities)
  if(!row.includedInBase&&row.energyKind!=='total'&&!/计划|取消|作废/.test(row.status??''))
   activitiesByDay.set(row.date,(activitiesByDay.get(row.date)??0)+(numeric(row.kcal)??0));
 return Object.fromEntries([...dates].filter(validDate).map(date=>{
  const daily=state.legacy.daily[date],energy=state.legacy.energy[date];
  const rows=rowsByDay.get(date)??[],sum=sampleNutrientSum(rows);
  const nutrition={},unresolved=[];
  for(const key of NUTRIENTS){
   const base=numeric(daily?.nutrition?.[key]??(key==='kcal'?energy?.intake:null));
   if(base===null)continue;
   const residual=round(base-(sum[key]??0),2);
   if(rows.some(row=>numeric(row.nutrition?.[key])===null)||residual<0){unresolved.push(key); continue;}
   // Explicit zero means a source summary was entirely covered by rows.
   nutrition[key]=residual;
  }
  const total=numeric(energy?.tdee);
  return [date,{nutrition,unresolved,originalSummary:unresolved.length?daily?.nutrition??{kcal:energy?.intake}:undefined,baseTdee:total===null?null:round(total-(activitiesByDay.get(date)??0),2),
   note:daily?.note??'',status:energy?.status??''}];
 }));
}
