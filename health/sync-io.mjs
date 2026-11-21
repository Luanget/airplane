import {ensureContainers} from './containers.mjs';
import {freshData,readFinance} from '../finance-storage.mjs';
import {localDate} from '../calendar.mjs';
import {combinedBackup} from './backup.mjs';
import {addDays,cycleForDate,actualFood,dayIntake,energyForDay,events,inventoryWithMoves,validateAppState,validDate} from './core.mjs';
import {saveState} from './storage.mjs';
import {CATALOG_TABLES,EVENT_TABLES,EVENT_TYPES,SYNC_FORMAT,eventData,externalCatalogs,foodStatus,hash,importSource,inheritedKey,inheritedLineage,originalEventRefs,same,sourceId,stable} from './sync-source.mjs';
import {planHealthMerge,verifyMergeConsistency} from './sync.mjs';

export const HEALTH_FILE_STATUS_KEY='airplane-health-file-status-v1';
export function readHealthFileStatus(store,state){
 let issued=null;
 try{issued=JSON.parse(store.getItem(HEALTH_FILE_STATUS_KEY));}catch{}
 return {device:{revision:state.revision??0,sourceVersion:state.importInfo?.sourceVersion??null},
  syncPackage:issued&&typeof issued.issuedAt==='string'?{issuedAt:issued.issuedAt,revision:issued.revision}:null,
  external:{verified:false,message:'外部主账合并状态需在外部核对；本机无法验证。'}};
}
export const financeStamp=record=>stable([record.primary,record.payload]);
export async function commitHealthMerge(current,plan,expectedFinance,account){
 if(plan.unresolved.length||plan.problems.length)throw Error('请先解决预览中的冲突或关联问题');
 if(!plan.changed)return current;
 if(verifyMergeConsistency(current,plan.next,plan.authorization).length)
  throw Error('再次校验未通过，请重新预览后合并');
 const before=readFinance(account.finance);
 const guard=()=>{
  if(financeStamp(readFinance(account.finance))!==expectedFinance)throw Error('财务账本已变化，请重新预览');
 };
 guard();
 const snapshot=combinedBackup(current,before.payload??freshData());
 // IndexedDB commits the full recovery snapshot and merged health together.
 return saveState(plan.next,current.revision??0,account,snapshot,guard);
}

export function createSyncPackage(state,{id,version,now=new Date().toISOString()}){
 if(!validateAppState(state)||!id)throw Error('健康账本格式无效');
 const health=ensureContainers(structuredClone(state));
 const original=health.legacy.sourceSnapshot,refs=originalEventRefs(state);
 if(original?.tables&&!health.legacy.catalogs)health.legacy.catalogs=externalCatalogs(original.tables);
 for(const type of EVENT_TYPES)for(const row of health.legacy[type]){
  if(!row.externalRow&&refs[type]?.has(row.id)){
   row.externalRow=refs[type].get(row.id);
   const externalId=sourceId(row.externalRow);
   if(externalId)row.externalId=externalId;
  }
 }
 const lineage=inheritedLineage(state);
 if(lineage)(health.sync??={}).lineage=lineage;
 delete health.legacy.sourceSnapshot;
 delete health.local.assistantActions;
 const anchors={};
 for(const [name,source] of Object.entries(state.sync?.sources??{}))
  anchors[name]={version:source.version,records:source.anchors??{}};
 const changes=[];
 for(const type of EVENT_TYPES){
  const observed=new Map();
  for(const anchor of Object.values(anchors))for(const value of Object.values(anchor.records[type]??{}))
   if(value.target)observed.set(value.target,value.incoming);
  for(const row of events(state,type)){
   const fingerprint=hash(stable(eventData(type,row)));
   const known=observed.get(row.id);
   if(known!==fingerprint)changes.push({type,id:row.id,action:known?'update':'add',fingerprint});
  }
 }
 const deletes=new Map();
 for(const type of EVENT_TYPES)for(const entry of state.legacy[type]){
  if(state.local.edits?.[type]?.[entry.id]===null)
   deletes.set(type+':'+entry.id,{type,id:entry.id,before:entry});
 }
 for(const row of state.sync?.tombstones??[])deletes.set(row.type+':'+row.id,row);
 for(const value of deletes.values())
  if(EVENT_TYPES.includes(value.type)&&!events(state,value.type).some(row=>row.id===value.id))
   changes.push({...value,action:'delete'});
 for(const type of ['stockMoves','batches','purchases','templates','shoppingList','containers','containerEvents','dayCompleteness','agentReceipts']){
  const prior=new Map(Object.values(anchors).flatMap(anchor=>Object.values(anchor.records[type]??{}))
   .filter(record=>record.target).map(record=>[record.target,record.accepted]));
  for(const row of state.local[type]??[]){
   const id=row.id??row.foodId,fingerprint=hash(stable(row));
   if(fingerprint!==prior.get(id))changes.push({type,id,action:prior.has(id)?'update':'add',fingerprint});
  }
 }
 return {format:SYNC_FORMAT,source:{id,version},anchor:{revision:state.revision??0,exportedAt:now,sources:anchors},changes,health};
}

const rawNutrients=nutrition=>({'kcal':nutrition.kcal,'蛋白质(g)':nutrition.protein,'碳水(g)':nutrition.carbs,
 '脂肪(g)':nutrition.fat,'钠(mg)':nutrition.sodium});
function toExternalEvent(type,row){
 const raw={...row.externalRow,airplane_event_id:row.externalId||sourceId(row.externalRow??{})||row.id,'日期':row.date,'时间':row.time??''};
 if(type==='foods'){
  const status=foodStatus(row);
  return {...raw,'餐次':row.meal,'食物/饮品':row.name,'食品ID':row.foodId,'份量/重量':row.portion,
   '状态':{actual:'实际',plan:'计划',cancelled:'取消'}[status],...rawNutrients(row.nutrition),
   ...(row.cost!=null?{'饮食成本(CNY)':row.cost}:{}),...(row.weighing?{airplane_weighing:row.weighing}:{}),...(row.agentEvidence?{airplane_evidence:row.agentEvidence}:{})};
 }
 if(type==='weights')return {...raw,'数值':row.kg,'纳入趋势':row.trendStatus??(row.isMorning?'是':'否')};
 return {...raw,'项目':row.name,'距离(km)':row.km,'时长(min)':row.minutes,'活动消耗估计(kcal)':row.kcal,
  '状态':row.status??'实际',includedInBase:row.includedInBase,energyKind:row.energyKind,...(row.excludedFromEnergy?{excludedFromEnergy:true}:{})};
}

export function externalBase(raw,{identity,choices}={}){
 const source=importSource(raw,{identity});
 const bridge=raw.airplane_sync;
 if(bridge?.format!==SYNC_FORMAT||!validateAppState(bridge.health))return {state:source.health,sourceId:source.id};
 if(bridge.tablesHash===hash(stable(raw.tables)))return {state:structuredClone(bridge.health),sourceId:source.id};
 // JSON remains authoritative when edited externally after an earlier export.
 const plan=planHealthMerge(bridge.health,source,{choices});
 return {state:plan.next,plan,sourceId:source.id};
}

// Apply differences in the application representation to the original row.
// The unchanged raw spelling, quality flags, blanks and audit fields stay intact.
function patchColumns(original,before,after,excluded=[]){
 const changed=Object.keys({...before,...after}).filter(key=>
  !excluded.includes(key)&&!same(before[key],after[key]));
 return changed.length?{...original,...Object.fromEntries(changed.map(key=>[key,after[key]??null]))}:original;
}
function indexBy(rows,key){
 const index=new Map();
 for(const row of rows){
  const id=key(row);
  if(!id)continue;
  if(!index.has(id))index.set(id,[]);
  index.get(id).push(row);
 }
 return index;
}

function projectEvents(tables,raw,base,state){
 const dates=new Set(),refs=originalEventRefs(state);
 for(const type of EVENT_TYPES){
  const key=EVENT_TABLES[type],originals=raw.tables[key]??[];
  const current=events(state,type),before=events(base,type);
  const originalsInState=new Map(state.legacy[type].map(row=>[row.id,row]));
  const currentById=new Map(current.map(row=>[row.id,row]));
  const beforeByExternal=indexBy(before,row=>row.externalId||sourceId(row.externalRow??{})||row.id);
  const beforeByRaw=indexBy(before,row=>inheritedKey(type,row.externalRow));
  const archived=row=>originalsInState.get(row.id)?.externalRow??refs[type]?.get(row.id)??row.externalRow;
  const currentByRaw=indexBy([...current,...state.legacy[type].filter(row=>!currentById.has(row.id))],
   row=>inheritedKey(type,archived(row)));
  const usedBefore=new Set(),usedCurrent=new Set();
  const originalKeys=new Set(originals.map(row=>inheritedKey(type,row)));
  const deleted=new Set((state.sync?.tombstones??[]).filter(row=>row.type===type).map(row=>row.id));
  const touch=(old,row)=>{
   if(type==='weights'||type==='foods'&&!(old&&actualFood(old)||row&&actualFood(row)))return;
   for(const date of [old?.date,row?.date])if(validDate(date))dates.add(date);
  };
  const rows=originals.flatMap(original=>{
   const fingerprint=inheritedKey(type,original),explicit=sourceId(original);
   const previous=(explicit?beforeByExternal.get(explicit):beforeByRaw.get(fingerprint))
    ?.find(row=>!usedBefore.has(row.id));
   if(!previous)return [original];
   usedBefore.add(previous.id);
   const sameId=currentById.get(previous.id)??originalsInState.get(previous.id);
   const oldRaw=sameId&&archived(sameId);
   const stableId=sameId&&!/^legacy-(food|weight|activity)-\d+$/.test(sameId.id);
   const direct=sameId&&(stableId&&!oldRaw||explicit&&(sameId.externalId===explicit||sameId.id===explicit)||
    inheritedKey(type,oldRaw)===fingerprint);
   const target=direct?sameId:currentByRaw.get(fingerprint)?.find(row=>!usedCurrent.has(row.id));
   if(!target){
    if(deleted.has(previous.id)&&!currentById.has(previous.id)){touch(previous,null);return [];}
    return [original];
   }
   usedCurrent.add(target.id);
   const updated=currentById.get(target.id);
   if(!updated&&state.local.edits?.[type]?.[target.id]===null){touch(previous,null);return [];}
   if(!updated||same(eventData(type,previous),eventData(type,updated))||
    inheritedKey(type,archived(target))===fingerprint&&same(updated,originalsInState.get(target.id)))return [original];
   touch(previous,updated);
   const encode=row=>toExternalEvent(type,{...row,externalRow:undefined});
   const revised=patchColumns(original,encode(previous),encode(updated),['airplane_event_id']);
   return [!explicit&&revised!==original?{...revised,airplane_event_id:target.id}:revised];
  });
  const priorIds=new Set(before.map(row=>row.id));
  for(const row of current){
   if(usedCurrent.has(row.id)||priorIds.has(row.id)||!validDate(row.date))continue;
   // Unmatched raw legacy records can only come from an explicitly accepted
   // external import. An existing raw row with this fingerprint is never appended.
   if(row.externalRow&&originalKeys.has(inheritedKey(type,row.externalRow)))continue;
   rows.push(toExternalEvent(type,row));touch(null,row);
  }
  if(!same(rows,originals))tables[key]=rows;
 }
 return dates;
}

function projectSummaries(tables,raw,base,state,dates,today){
 for(const field of ['daily','energy']){
  const left=base.legacy[field],right=state.legacy[field];
  for(const date of new Set([...Object.keys(left),...Object.keys(right)]))
   if(validDate(date)&&!same(left[date],right[date]))dates.add(date);
 }
 const beforeStatus=new Map((base.local.dayCompleteness??[]).map(row=>[row.date,row.status]));
 const afterStatus=new Map((state.local.dayCompleteness??[]).map(row=>[row.date,row.status]));
 for(const date of new Set([...beforeStatus.keys(),...afterStatus.keys()]))
  if(beforeStatus.get(date)!==afterStatus.get(date))dates.add(date);
 const daily=new Map(),energy=new Map();
 for(const date of dates){
  const previous=dayIntake(base,date),next=dayIntake(state,date);
  const oldDaily=base.legacy.daily[date],newDaily=state.legacy.daily[date];
  if(!same(previous.totals,next.totals)||oldDaily?.note!==newDaily?.note){
   daily.set(date,{before:{...rawNutrients(previous.totals),'记录完整性':oldDaily?.note},
    after:{...rawNutrients(next.totals),'记录完整性':newDaily?.note??oldDaily?.note}});
  }
  const old=energyForDay(base,date,today),updated=energyForDay(state,date,today);
  const oldRow=base.legacy.energy[date],newRow=state.legacy.energy[date];
  const pack=(model,row)=>({'摄入(kcal)':model.intake,'估计总消耗(kcal)':model.tdee,
   '当日缺口(kcal)':model.deficit,'结算状态':row?.status});
  if(oldRow||newRow)energy.set(date,{before:pack(old,oldRow),after:pack(updated,newRow)});
 }
 const dailyRows=(raw.tables.daily_summaries??[]).map(row=>{
  const date=row['日期'],change=daily.get(date);
  daily.delete(date);
  return change?patchColumns(row,change.before,change.after):row;
 });
 for(const [date,change] of daily)
  if(Object.values(change.after).some(value=>value!=null&&value!==''))dailyRows.push({'日期':date,...change.after});
 if(!same(dailyRows,raw.tables.daily_summaries??[]))tables.daily_summaries=dailyRows;
 const energyRows=(raw.tables.energy_balance??[]).map(row=>{
  const change=energy.get(row['饮食日期']);
  return change?patchColumns(row,change.before,change.after):row;
 });
 // Historical absence of an energy row is significant; only an explicit
 // stored energy baseline can introduce a new row.
 const known=new Set(energyRows.map(row=>row['饮食日期']));
 for(const [date,change] of energy)
  if(!known.has(date)&&!base.legacy.energy[date]&&state.legacy.energy[date])
   energyRows.push({'饮食日期':date,...change.after});
 if(!same(energyRows,raw.tables.energy_balance??[]))tables.energy_balance=energyRows;
}

function projectInventory(tables,raw,base,state){
 const previous=new Map(inventoryWithMoves(base).map(row=>[row.id,row]));
 const current=new Map(inventoryWithMoves(state).map(row=>[row.id,row]));
 const encode=row=>({'食品ID':row.id,'名称':row.name,'库存值':row.qty,'库存单位':row.unitDescription||row.unit,
  '标准份量':row.standard,'单价(CNY)':row.pricePerUnit,'价格基准':row.priceBasis,active:row.active!==false,
  kcal:row.nutrition.kcal,'P(g)':row.nutrition.protein,'C(g)':row.nutrition.carbs,'F(g)':row.nutrition.fat,'Na(mg)':row.nutrition.sodium});
 const originals=raw.tables.food_inventory??[];
 const rows=originals.map((original,index)=>{
  const id=String(original['食品ID']||'legacy-inventory-'+index);
  const old=previous.get(id),row=current.get(id);
  return old&&row?patchColumns(original,encode(old),encode(row)):original;
 });
 const rawIds=new Set(rows.map((row,index)=>String(row['食品ID']||'legacy-inventory-'+index)));
 for(const row of current.values())if(!rawIds.has(row.id)&&!previous.has(row.id))rows.push(encode(row));
 if(!same(rows,originals))tables.food_inventory=rows;
}

function projectCatalogs(tables,base,state){
 for(const name of [...Object.keys(CATALOG_TABLES),'rules']){
  const rules=name==='rules',key=row=>rules?row.key:row.id;
  const old=rules?base.legacy.rules:base.legacy.catalogs?.[name]??[];
  const next=rules?state.legacy.rules:state.legacy.catalogs?.[name]??[];
  const prior=new Map(old.map(row=>[key(row),row]));
  const changes=next.filter(row=>!same(row,prior.get(key(row))));
  if(!changes.length)continue;
  for(const row of changes){
   const previous=prior.get(key(row)),table=rules?'rules':row.table;
   const rows=tables[table]??=[];
   const index=previous?rows.findIndex(item=>rules?item.Key===previous.key&&item.状态==='active':same(item,previous.original)):-1;
   if(rules){
    const values={Key:row.key,状态:'active',说明:row.desc,当前值:row.value};
    if(index>=0)rows[index]={...rows[index],...values};else rows.push(values);
   }else if(index>=0)rows[index]=row.original;
   else if(!rows.some(item=>same(item,row.original)))rows.push(row.original);
   tables[table]=rows;
  }
 }
}

export function projectExternalLedger(raw,state,{version,id,today=localDate(),now=new Date().toISOString()}={}){
 if(!raw?.tables||!version||!id)throw Error('请指定外部主账、目标版本和来源');
 const tables=structuredClone(raw.tables);
 const bridged=raw.airplane_sync;
 const base=bridged?.format===SYNC_FORMAT&&bridged.tablesHash===hash(stable(raw.tables))&&validateAppState(bridged.health)
  ?bridged.health:importSource(raw).health;
 const dates=projectEvents(tables,raw,base,state);
 projectSummaries(tables,raw,base,state,dates,today);
 projectInventory(tables,raw,base,state);
 projectCatalogs(tables,base,state);
 const parameters=settings=>({'起始日期':settings.cycleAnchor,'周期天数':settings.cycleDays,
  '周期日期':settings.cycleAnchor+'–'+addDays(settings.cycleAnchor,settings.cycleDays-1),
  '周期目标缺口':settings.cycleTarget,'无运动基线TDEE':settings.baselineTdee,'日摄入参考':settings.calorieTarget,
  proteinMin:settings.proteinMin,proteinMax:settings.proteinMax,fatMin:settings.fatMin});
 const params=patchColumns(tables.cycle_parameters??{},parameters(base.settings),parameters(state.settings));
 if(!same(params,tables.cycle_parameters??{}))tables.cycle_parameters=params;
 const priorCycles=Array.isArray(bridged?.cycles)?bridged.cycles.filter(row=>validDate(row?.start)):[];
 const sameCycleSettings=['cycleAnchor','cycleDays','cycleTarget'].every(key=>base.settings[key]===state.settings[key]);
 const cycles=new Map(sameCycleSettings?priorCycles.map(row=>[row.start,row]):[]);
 if(!sameCycleSettings)for(const row of priorCycles)dates.add(row.start);
 for(const date of dates){
  const {start,end,closedDays,deficit,goal,fatEquivalent}=cycleForDate(state,date,today);
  cycles.set(start,{start,end,closedDays,deficit,goal,fatEquivalent});
 }
 const bridge=createSyncPackage(state,{id,version,now});
 return {...raw,handoff_version:version,updated_at:now,tables,
  airplane_sync:{...bridge,cycles:[...cycles.values()],tablesHash:hash(stable(tables))}};
}
