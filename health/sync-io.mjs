import {freshData,readFinance} from '../finance-storage.mjs';
import {localDate} from '../calendar.mjs';
import {combinedBackup} from './backup.mjs';
import {addDays,cycleForDate,dayIntake,energyForDay,events,inventoryWithMoves,validateAppState,validDate} from './core.mjs';
import {saveState} from './storage.mjs';
import {CATALOG_TABLES,EVENT_TABLES,EVENT_TYPES,SYNC_FORMAT,eventData,externalCatalogs,foodStatus,hash,importSource,originalEventRefs,sourceId,stable} from './sync-source.mjs';
import {planHealthMerge} from './sync.mjs';

export const financeStamp=record=>stable([record.primary,record.payload]);
export async function commitHealthMerge(current,plan,expectedFinance,account){
 if(plan.unresolved.length||plan.problems.length)throw Error('请先解决预览中的冲突或关联问题');
 if(!plan.changed)return current;
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
 const health=structuredClone(state);
 const original=health.legacy.sourceSnapshot,refs=originalEventRefs(state);
 if(original?.tables&&!health.legacy.catalogs)health.legacy.catalogs=externalCatalogs(original.tables);
 for(const type of EVENT_TYPES)for(const row of health.legacy[type]){
  if(!row.externalRow&&refs[type]?.has(row.id)){
   row.externalRow=refs[type].get(row.id);
   const externalId=sourceId(row.externalRow);
   if(externalId)row.externalId=externalId;
  }
 }
 delete health.legacy.sourceSnapshot;
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
 for(const type of ['stockMoves','batches','purchases','templates','shoppingList']){
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
   ...(row.cost!=null?{'饮食成本(CNY)':row.cost}:{}),...(row.weighing?{airplane_weighing:row.weighing}:{})};
 }
 if(type==='weights')return {...raw,'数值':row.kg,'纳入趋势':row.trendStatus??(row.isMorning?'是':'否')};
 return {...raw,'项目':row.name,'距离(km)':row.km,'时长(min)':row.minutes,'活动消耗估计(kcal)':row.kcal,
  '状态':row.status??'实际',includedInBase:row.includedInBase,energyKind:row.energyKind};
}

export function externalBase(raw,{identity,choices}={}){
 const source=importSource(raw,{identity});
 const bridge=raw.airplane_sync;
 if(bridge?.format!==SYNC_FORMAT||!validateAppState(bridge.health))return {state:source.health,sourceId:source.id};
 if(bridge.tablesHash===hash(stable(raw.tables)))return {state:bridge.health,sourceId:source.id};
 // JSON remains authoritative when edited externally after an earlier export.
 const plan=planHealthMerge(bridge.health,source,{choices});
 return {state:plan.next,plan,sourceId:source.id};
}

export function projectExternalLedger(raw,state,{version,id,today=localDate(),now=new Date().toISOString()}={}){
 if(!raw?.tables||!version||!id)throw Error('请指定外部主账、目标版本和来源');
 const tables=structuredClone(raw.tables);
 const rawEvents={};
 for(const type of EVENT_TYPES){
  const table=EVENT_TABLES[type];
  const originals=new Map((tables[table]??[]).map(row=>[sourceId(row),row]).filter(([key])=>key));
  const list=events(state,type);
  rawEvents[type]=list;
  tables[table]=list.map(row=>toExternalEvent(type,{...row,
   externalRow:row.externalRow??originals.get(row.externalId||row.id)}));
  if(type!=='foods')tables[table].push(...(raw.tables[table]??[]).filter(row=>!validDate(row['日期'])));
 }
 const dates=new Set([...Object.keys(state.legacy.daily),...Object.keys(state.legacy.energy),
  ...rawEvents.foods.map(row=>row.date),...rawEvents.activities.map(row=>row.date)].filter(validDate));
 const days=new Map((tables.daily_summaries??[]).map(row=>[row['日期'],row]));
 const energy=new Map((tables.energy_balance??[]).map(row=>[row['饮食日期'],row]));
 for(const date of dates){
  const intake=dayIntake(state,date),model=energyForDay(state,date,today);
  days.set(date,{...days.get(date),'日期':date,...rawNutrients(intake.totals),
   '记录完整性':intake.incomplete.length?'仍有待补：'+intake.incomplete.join('、'):days.get(date)?.['记录完整性']??''});
  energy.set(date,{...energy.get(date),'饮食日期':date,'摄入(kcal)':model.intake,'估计总消耗(kcal)':model.tdee,
   '当日缺口(kcal)':model.closed?model.deficit:null,'结算状态':model.closed?'已封账':'待结算'});
 }
 tables.daily_summaries=[...days.values()];
 tables.energy_balance=[...energy.values()];
 const stockBefore=new Map((tables.food_inventory??[]).map(row=>[String(row['食品ID']??''),row]));
 tables.food_inventory=inventoryWithMoves(state).map(row=>({...stockBefore.get(row.id),'食品ID':row.id,'名称':row.name,
  '库存值':row.qty,'库存单位':row.unitDescription||row.unit,'标准份量':row.standard,
  '单价(CNY)':row.pricePerUnit,'价格基准':row.priceBasis,active:row.active!==false,
  kcal:row.nutrition.kcal,'P(g)':row.nutrition.protein,'C(g)':row.nutrition.carbs,'F(g)':row.nutrition.fat,'Na(mg)':row.nutrition.sodium}));
 const rules=new Map((tables.rules??[]).map(row=>[row.Key,row]));
 for(const rule of state.legacy.rules)rules.set(rule.key,{...rules.get(rule.key),Key:rule.key,状态:'active',说明:rule.desc,当前值:rule.value});
 tables.rules=[...rules.values()];
 tables.cycle_parameters={...tables.cycle_parameters,'起始日期':state.settings.cycleAnchor,'周期天数':state.settings.cycleDays,
  '周期日期':state.settings.cycleAnchor+'–'+addDays(state.settings.cycleAnchor,state.settings.cycleDays-1),
  '周期目标缺口':state.settings.cycleTarget,'无运动基线TDEE':state.settings.baselineTdee,'日摄入参考':state.settings.calorieTarget,
  proteinMin:state.settings.proteinMin,proteinMax:state.settings.proteinMax,fatMin:state.settings.fatMin};
 for(const [name,keys] of Object.entries(CATALOG_TABLES)){
  const imported=state.legacy.catalogs?.[name]??[];
  for(const key of keys)if(imported.some(row=>row.table===key))
   tables[key]=imported.filter(row=>row.table===key).map(row=>row.original);
 }
 const cycles=new Map();
 for(const date of dates){
  const cycle=cycleForDate(state,date,today);
  if(!cycles.has(cycle.start)){
   const {start,end,closedDays,deficit,goal,fatEquivalent}=cycle;
   cycles.set(start,{start,end,closedDays,deficit,goal,fatEquivalent});
  }
 }
 const bridge=createSyncPackage(state,{id,version,now});
 return {...raw,handoff_version:version,updated_at:now,tables,
  airplane_sync:{...bridge,cycles:[...cycles.values()],tablesHash:hash(stable(tables))}};
}
