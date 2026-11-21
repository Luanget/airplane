import {normalizeClock} from '../calendar.mjs';
import {NUTRIENTS,actualFood,addFood,batchBalances,dayIntake,deleteEvent,energyForDay,events,
 inventoryWithMoves,numeric,round,sampleNutrientSum,validDate,validateAppState} from './core.mjs';
import {quantityInUnit} from './candidates.mjs';
import {recordedPortion} from './food-history.mjs';
import {orderBatchId,revisePurchase} from './purchases.mjs';
import {EVENT_TYPES,baselines,eventData,eventIdentity,externalCatalogs,foodStatus,hash,inheritedKey,inheritedLineage,normalized,originalEventRefs,
 safeKey,same,stable} from './sync-source.mjs';

const clone=structuredClone;
const empty=()=>Object.create(null);
const labels={foods:'饮食',weights:'体重',activities:'运动',inventory:'食品与库存',purchases:'采购',
 batches:'库存批次',stockMoves:'库存流水',templates:'餐食模板',shoppingList:'补货清单',
 stockLinks:'扣库待核对',baselines:'每日汇总与能量基线',settings:'健康参数',aliases:'食品别名',prices:'单价目录',purchaseEvents:'外部采购',inventoryAudit:'库存审计',rules:'现行规则'};
const keyFor=(kind,row)=>kind==='shoppingList'?row.foodId:kind==='rules'?row.key:row.id;
const canonicalName=(state,row)=>{
 const names=[row.name];
 for(const alias of state.legacy.catalogs?.aliases??[]){
  if(alias.alias&&normalized(row.name)===normalized(alias.alias)&&alias.name)names.push(alias.name);
 }
 return names.map(normalized);
};
function nearby(type,a,b,names){
 if(a.date!==b.date)return false;
 if(type==='weights')return eventData(type,a).isMorning===eventData(type,b).isMorning;
 if(type==='foods'&&foodStatus(a)!==foodStatus(b))return false;
 return canonicalName(names,a).some(name=>canonicalName(names,b).includes(name))||
  !!(a.foodId&&b.foodId&&a.foodId===b.foodId);
}
function equivalent(type,a,b,names){
 const left=eventData(type,a),right=eventData(type,b);
 if(left.name!==right.name&&nearby(type,a,b,names))left.name=right.name;
 if(!left.time||!right.time)delete left.time,delete right.time;
 if(type==='activities'&&(!left.status||!right.status))delete left.status,delete right.status;
 // Amount and all supplied values must agree. Missing nutrients on one
 // writer's copy do not identify a different meal if amount is explicit.
 if(type==='foods'&&left.portion&&left.portion===right.portion){
  for(const field of ['weighing','cost'])if(left[field]==null||right[field]==null)delete left[field],delete right[field];
  for(const key of NUTRIENTS)if(left.nutrition[key]===null||right.nutrition[key]===null)
   delete left.nutrition[key],delete right.nutrition[key];
 }
 return same(left,right);
}
function eventRow(row,type,ids){
 const next=clone(row);
 if(type==='foods'){
  if(next.foodId)next.foodId=ids.get(next.foodId)??next.foodId;
  if(next.batchId)next.batchId=ids.get(next.batchId)??next.batchId;
 }
 return next;
}
function setEvent(state,type,previous,row,id,raw){
 if(!row){
  if(previous)deleteEvent(state,type,id);
  return;
 }
 const record={...previous,...clone(row),id};
 if(previous&&type==='foods'){
  const linked=state.local.stockMoves.filter(move=>move.linkedFoodId===id);
  if(raw&&linked.length){
   record.foodId=previous.foodId;
   record.batchId=previous.batchId;
   record.cost=previous.cost;
   record.costSource=previous.costSource;
   record.stockQty=previous.stockQty;
   const changed=eventData(type,previous).portion!==eventData(type,row).portion;
   const moved=record.date!==previous.date;
   if(changed||moved||foodStatus(record)!=='actual'){
    if(!validDate(record.date))throw Error('扣库饮食必须有有效日期');
    const used=linked.reduce((sum,move)=>sum-move.delta,0);
    let quantity=used;
    if(changed&&foodStatus(record)==='actual'){
     const before=recordedPortion(previous),after=recordedPortion(row);
     if(before.unit!==after.unit)throw Error('原记录的扣库单位无法确认，请先在本机更正');
     quantity=round(used*after.amount/before.amount,6);
    }
    const saved=addFood(state,{...record,...record.nutrition,status:foodStatus(record),stockQty:quantity,
     cost:previous.costSource==='inventory'?null:previous.cost},id);
    saved.externalId=record.externalId;
    saved.externalRow=record.externalRow;
    return;
   }
  }
  if(raw&&previous.source!=='legacy'){
   record.source=previous.source;
   record.status=foodStatus(row);
  }
 }
 if(state.legacy[type].some(entry=>entry.id===id)){
  ((state.local.edits??={})[type]??={})[id]=record;
 }else if(!previous&&(raw||type==='foods'&&!validDate(record.date)&&foodStatus(record)!=='actual')){
  state.legacy[type].push(record);
 }else{
  const rows=state.local[type],at=rows.findIndex(entry=>entry.id===id);
  if(at===-1)rows.push(record);
  else rows[at]=record;
 }
}
function snapshotEvents(state,type){
 const edits=state.local.edits?.[type]??{};
 const originals=new Map(state.legacy[type].map(row=>[row.id,row]));
 return events(state,type).map(row=>({id:row.id,row,original:originals.get(row.id)}))
  .concat(state.legacy[type].filter(row=>Object.hasOwn(edits,row.id)&&edits[row.id]===null)
   .map(row=>({id:row.id,row:null,original:row})));
}
function upsert(rows,key,value,id){
 const at=rows.findIndex(row=>key(row)===id);
 if(at<0)rows.push(value);
 else rows[at]=value;
}

function chooseBaseline(current,next,selected,dates){
 const originals=new Map(),activity=new Map();
 for(const row of next.legacy.foods)if(actualFood(row)){
  if(!originals.has(row.date))originals.set(row.date,[]);
  originals.get(row.date).push(row);
 }
 for(const row of next.legacy.activities)
  if(!row.includedInBase&&row.energyKind!=='total'&&!/计划|取消|作废/.test(row.status??''))
   activity.set(row.date,(activity.get(row.date)??0)+(numeric(row.kcal)??0));
 const previous=baselines(current);
 for(const date of dates){
  const base=selected[date]??previous[date],sum=sampleNutrientSum(originals.get(date)??[]);
  if(!base)continue;
  const daily=next.legacy.daily[date],energy=next.legacy.energy[date];
  const nutrition=Object.fromEntries(NUTRIENTS.map(key=>{
   // Keep unprovable local aggregates separately for review. On merged
   // dates, they cannot be combined with row deltas safely.
   return [key,Object.hasOwn(base.nutrition,key)?round(base.nutrition[key]+(sum[key]??0),2):null];
  }));
  if(Object.values(nutrition).some(value=>value!==null)||daily){
   next.legacy.daily[date]={...daily,date,nutrition,note:base.note};
  }
  if(selected[date]&&(energy||base.baseTdee!==null)){
   next.legacy.energy[date]={...energy,date,intake:nutrition.kcal,
    tdee:base.baseTdee===null?null:round(base.baseTdee+(activity.get(date)??0),2),
    deficit:null,status:base.status};
  }
 }
}

function verifyGraph(state,baseline){
 const inventory=new Map(inventoryWithMoves(state).map(row=>[row.id,row]));
 const batches=new Map((state.local.batches??[]).map(row=>[row.id,row]));
 const effective=events(state,'foods').filter(actualFood);
 const foods=new Set(effective.map(row=>row.id));
 const oldFoods=new Map(events(baseline,'foods').map(row=>[row.id,row]));
 const linked=new Map();
 const problems=[];
 const report=(id,text)=>problems.push(id+' · '+text);
 const priorMoves=new Map(baseline.local.stockMoves.map(row=>[row.id,row]));
 for(const row of state.local.stockMoves){
  if(row.linkedFoodId&&row.delta<0)linked.set(row.linkedFoodId,(linked.get(row.linkedFoodId)??0)-row.delta);
  // Keep historical orphan records intact. New or changed links must be valid.
  if(same(row,priorMoves.get(row.id)))continue;
  if(!inventory.has(row.foodId))report(row.id,'库存流水缺少食品');
  if(row.batchId&&batches.get(row.batchId)?.foodId!==row.foodId)report(row.id,'库存流水和批次食品不一致');
  if(row.linkedFoodId&&!foods.has(row.linkedFoodId))report(row.id,'扣库流水没有关联的实际饮食');
 }
 for(const row of effective){
  if(row.stockQty>0&&!same(row,oldFoods.get(row.id))&&Math.abs(row.stockQty-(linked.get(row.id)??0))>1e-6)
   report(row.name,'记录份量与关联扣库流水不一致');
 }
 const previousLots=new Map((baseline.local.batches??[]).map(row=>[row.id,row]));
 for(const row of batches.values()){
  if(same(row,previousLots.get(row.id)))continue;
  if(!inventory.has(row.foodId)||row.parent&&batches.get(row.parent)?.foodId!==row.foodId)report(row.id,'批次来源不完整');
 }
 const beforeStock=new Map(inventoryWithMoves(baseline).map(row=>[row.id,row.qty]));
 const beforeLots=new Map(batchBalances(baseline).map(row=>[row.id,row.remaining]));
 const totals=new Map();
 for(const batch of batchBalances(state)){
  if(batch.remaining<0&&batch.remaining!==beforeLots.get(batch.id))report(batch.id,'批次余量不足');
  totals.set(batch.foodId,(totals.get(batch.foodId)??0)+batch.remaining);
 }
 for(const [id,row] of inventory){
  const changed=row.qty!==beforeStock.get(id)||[...batches.values()].some(batch=>batch.foodId===id&&!same(batch,previousLots.get(batch.id)));
  if(changed&&row.qty!==null&&(row.qty<0||row.qty<round(totals.get(id)??0,6)))report(row.name,'库存不足或低于已有批次总量');
 }
 const orderBefore=new Map((baseline.local.purchases??[]).map(row=>[row.id,row]));
 const financeLinks=new Set();
 for(const order of state.local.purchases??[]){
  if(order.status==='cancelled')continue;
  if(order.financeId){
   if(financeLinks.has(order.financeId))report(order.id,'同一财务支出被多次关联');
   financeLinks.add(order.financeId);
  }
  if(same(order,orderBefore.get(order.id)))continue;
  const items=order.items??[];
  const known=items.reduce((sum,row)=>sum+(row.costCents??0),0);
  if(!items.length||known>order.totalCents||items.every(row=>row.costCents!=null)&&known!==order.totalCents)report(order.id,'订单金额与明细不一致');
  items.forEach((line,index)=>{
   const batch=batches.get(orderBatchId(order,line,index));
   if(!batch||batch.foodId!==line.foodId||batch.quantity!==line.quantity||batch.costCents!==line.costCents)
    report(order.id,'采购与入库批次不一致');
  });
 }
 return [...new Set(problems)];
}

function changedRows(before,after,key){
 const left=new Map(before.map(row=>[key(row),row]));
 const right=new Map(after.map(row=>[key(row),row]));
 return [...new Set([...left.keys(),...right.keys()])].flatMap(id=>{
  const old=left.get(id),row=right.get(id);
  return same(old,row)?[]:[[id,old,row]];
 });
}

export function verifyMergeConsistency(before,after,allowed={}){
 const problems=[];
 const check=(kind,key)=>allowed[kind]?.includes(key);
 const dates=new Set([...Object.keys(before.legacy.daily),...Object.keys(after.legacy.daily),
  ...Object.keys(before.legacy.energy),...Object.keys(after.legacy.energy)]);
 const intakeDates=new Set(),activityDates=new Set();
 for(const kind of EVENT_TYPES){
  const left=events(before,kind),right=events(after,kind);
  for(const row of [...left,...right])if(validDate(row.date))dates.add(row.date);
  for(const [id,old,row] of changedRows(left,right,value=>value.id)){
   if(!check(kind+'Ids',id)){
    problems.push(labels[kind]+'发生未经预览的改动 · '+(row?.date||old?.date||'日期未定'));
    continue;
   }
   for(const date of [old?.date,row?.date]){
    if(kind==='foods'&&(old&&actualFood(old)||row&&actualFood(row)))intakeDates.add(date);
    if(kind==='activities')activityDates.add(date);
   }
  }
 }
 for(const date of dates){
  if(!intakeDates.has(date)&&!check('baselines',date)&&
   !same(dayIntake(before,date).totals,dayIntake(after,date).totals))
   problems.push('历史营养基线发生未经预览的改动 · '+date);
  const oldEnergy=before.legacy.energy[date],newEnergy=after.legacy.energy[date];
  if(!check('baselines',date)&&(!same(oldEnergy?.tdee,newEnergy?.tdee)||
   !activityDates.has(date)&&(oldEnergy?.tdee!=null||!check('settings','baselineTdee'))&&
    energyForDay(before,date,date).tdee!==energyForDay(after,date,date).tdee))
   problems.push('历史总消耗发生未经预览的改动 · '+date);
 }
 for(const [id] of changedRows([...before.legacy.inventory,...(before.local.inventory??[])],
  [...after.legacy.inventory,...(after.local.inventory??[])],row=>row.id))
  if(!check('inventory',id))problems.push('库存期初发生未经预览的改动 · '+id);
 for(const [id] of changedRows(before.local.stockMoves,after.local.stockMoves,row=>row.id))
  if(!check('stockMoves',id))problems.push('库存流水发生未经预览的改动 · '+id);
 const balances=new Map(inventoryWithMoves(before).map(row=>[row.id,row.qty]));
 const flows=new Set(allowed.stockSkus??[]);
 for(const row of inventoryWithMoves(after))
  if(balances.has(row.id)&&balances.get(row.id)!==row.qty&&!flows.has(row.id)&&!check('inventory',row.id))
   problems.push('库存余额发生未经预览的改动 · '+row.id);
 return [...new Set(problems)];
}

export function planHealthMerge(current,source,{choices={},finance=null,baseSource}={}){
 if(!validateAppState(current))throw Error('本机健康账本格式无效');
 const {health:incoming,id:sourceId,raw}=source;
 const next=clone(current);
 const sync=next.sync??={};
 const sources=sync.sources??={};
 const previous=sources[sourceId]??{};
 const anchors=clone(previous.anchors??{});
 const rows=[],ids=new Map(),dates=new Set(),newActualDates=new Set(),newLegacyDates=new Set(),suppressed=new Set(),changedNative=new Set();
 const leftLineage=inheritedLineage(current),rightLineage=inheritedLineage(incoming);
 const observedDay=String(raw?.updated_at??'').slice(0,10);
 const sharedLineage=leftLineage&&rightLineage&&leftLineage.id===rightLineage.id;
 const sameEdition=sharedLineage&&leftLineage.version===rightLineage.version;
 const lastInheritedDay=EVENT_TYPES.flatMap(type=>current.legacy[type].map(row=>row.date)).filter(validDate).sort().at(-1);
 const authorization={foodsIds:[],weightsIds:[],activitiesIds:[],baselines:[],inventory:[],settings:[]};
 const failures=[];
 const versionNumber=value=>{
  const match=/^(\d{6,8})(?:\.(\d+))?$/.exec(value??'');
  return match?BigInt(match[1])*1000000n+BigInt(match[2]??0):null;
 };
 const oldVersion=versionNumber(previous.version),newVersion=versionNumber(source.version);
 const oldRevision=previous.sourceRevision,newRevision=source.packageInfo?.anchor?.revision;
 if(oldVersion!==null&&newVersion!==null&&oldVersion>newVersion||
  Number.isSafeInteger(oldRevision)&&Number.isSafeInteger(newRevision)&&oldRevision>newRevision)
  failures.push('此文件早于该来源上次合并的版本，请选择最新文件。');
 const baselineChoices=empty(),currentBase=baselines(current);
 const affectedDates=(old,row)=>{for(const value of [old?.date,row?.date])if(validDate(value))dates.add(value);};
 const entry=(kind,key,before,after,status,options=[],impact='')=>{
  const id=kind+':'+key;
  const chosen=Object.hasOwn(choices,id)&&options.some(option=>option.value===choices[id])?choices[id]:null;
  const row={id,kind,label:labels[kind],status,before:before??null,after:after??null,options,chosen,impact};
  rows.push(row);return row;
 };
 const review=[{value:'keep',label:'保留本机'},{value:'take',label:'采用来源'}];
 const known=(kind,key)=>anchors[kind]?.[key];
 function removePreviously(kind,key,old){
  if(old?.key&&old.key!==key)delete anchors[kind][old.key];
 }
 function saveAnchor(kind,key,target,incomingRow,accepted,old){
  removePreviously(kind,key,old);
  (anchors[kind]??={})[key]={target,incoming:hash(stable(incomingRow)),accepted:hash(stable(accepted))};
 }
 const oldMatch=(kind,key)=>known(kind,key);

 const catalog=(kind,local,inRows)=>{
  const found=new Map(local.map(row=>[keyFor(kind,row),row]));
  for(const row of inRows){
   const id=keyFor(kind,row);if(!safeKey(id))continue;
   const key=hash(id),before=found.get(id),old=oldMatch(kind,key);
   const oldRow=old?.incoming===hash(stable(row));
   const status=!before?'added':same(before,row)?'same':oldRow?'existing':
    old&&old.accepted===hash(stable(before))?'corrected':'conflict';
   const change=entry(kind,key,before,row,status,status==='conflict'?review:[],'资料性记录，不自动重复入库或记账');
   const take=['added','corrected'].includes(status)||change.chosen==='take';
   if(take){upsert(local,value=>keyFor(kind,value),clone(row),id);found.set(id,row);}
   if(!change.options.length||change.chosen)saveAnchor(kind,key,id,row,take?row:before);
  }
 };
 const inheritedTables=incoming.legacy.sourceSnapshot?.tables;
 const typedCatalogs=incoming.legacy.catalogs??(inheritedTables&&(!sameEdition||!current.legacy.catalogs)
  ?externalCatalogs(inheritedTables):{});
 for(const [kind,items] of Object.entries(typedCatalogs)){
  if(!['aliases','prices','purchaseEvents','inventoryAudit'].includes(kind)||!Array.isArray(items))continue;
  const catalogs=next.legacy.catalogs??={};
  catalog(kind,catalogs[kind]??=[],items);
 }
 catalog('rules',next.legacy.rules,incoming.legacy.rules);
 const names=next;

 // Register food identities before linking events, purchases and movements.
 const existingInventory=inventoryWithMoves(next);
 const incomingInventory=inventoryWithMoves(incoming);
 const newSkus=new Set();
 for(const sku of incomingInventory){
  if(!safeKey(sku.id))throw Error('食品 ID 无效');
  const key=hash(raw&&/^legacy-inventory-\d+$/.test(sku.id)?stable([normalized(sku.name),sku.unit,sku.standard]):sku.id);
  const old=oldMatch('inventory',key);
  const exact=(!raw||!/^legacy-inventory-\d+$/.test(sku.id))&&existingInventory.find(row=>row.id===sku.id);
  const named=existingInventory.filter(row=>row.unit===sku.unit&&canonicalName(names,row).some(name=>canonicalName(names,sku).includes(name)));
  const mapped=old&&existingInventory.find(row=>row.id===old.target);
  const candidates=mapped?[mapped]:exact?[exact]:named;
  const base=(incoming.legacy.inventory.find(row=>row.id===sku.id)??incoming.local.inventory?.find(row=>row.id===sku.id));
  if(candidates.length>1){
   const ambiguity=entry('inventory',key,candidates,sku,'suspect',
    [{value:'skip',label:'暂不合并此食品'},...candidates.map(row=>({value:row.id,label:'关联 '+row.name+' · '+row.id}))],
    '无法唯一确定食品，依赖它的记录会暂缓');
   if(!ambiguity.chosen||ambiguity.chosen==='skip'){suppressed.add(sku.id);continue;}
   ids.set(sku.id,ambiguity.chosen);
  }else if(candidates.length)ids.set(sku.id,candidates[0].id);
  else {
   const target=existingInventory.some(row=>row.id===sku.id)||raw&&/^legacy-inventory-\d+$/.test(sku.id)?'sync-sku-'+hash(sourceId+key):sku.id;
   const values={...clone(base),id:target};
   if(raw)next.legacy.inventory.push(values);else (next.local.inventory??=[]).push(values);
   authorization.inventory.push(target);
   newSkus.add(sku.id);ids.set(sku.id,target);existingInventory.push({...values,qty:sku.qty});
   entry('inventory',key,null,sku,'added',[],'新食品与来源库存');
   saveAnchor('inventory',key,target,sku,sku);
   continue;
  }
  const target=ids.get(sku.id),before=existingInventory.find(row=>row.id===target);
  const location=next.legacy.inventory.find(row=>row.id===target)??next.local.inventory?.find(row=>row.id===target);
  const signature=row=>({...row,id:target});
  const comparableBefore=raw&&!sameEdition?before:location,comparableIncoming=raw&&!sameEdition?sku:base;
  const sameOpening=sameEdition&&before.id===sku.id&&location.qty===base.qty&&
   location.pricePerUnit===base.pricePerUnit&&same(location.nutrition,base.nutrition);
  const sameInventory=sameOpening||same(signature(comparableBefore),signature(comparableIncoming));
  if(!sameInventory&&(!old||old.incoming!==hash(stable(sku)))){
   const change=entry('inventory',key+'-values',before,sku,'conflict',review,
    raw&&!sameEdition
     ?(validDate(observedDay)?'采用即确认 '+observedDay+' 及此前的本机流水已含在来源净盘点，之后的流水另计。':
      '来源盘点日期未定。采用即确认其净余额已包含当前本机流水。')
     :'采用来源期初数量，本机后续流水继续计算现存量');
   if(change.chosen==='take'){
    authorization.inventory.push(target);
    const reflectedMoves=next.local.stockMoves.filter(row=>row.foodId===target&&
     (!validDate(observedDay)||row.date<=observedDay));
    const quantity=raw&&!sameEdition&&sku.qty!==null
     ?round(sku.qty-reflectedMoves.reduce((n,row)=>n+row.delta,0),6):base.qty;
    Object.assign(location,clone(base),{id:target,qty:quantity});
   }
   if(!change.chosen)continue;
  }else entry('inventory',key,before,sku,sameInventory?'same':'existing');
  saveAnchor('inventory',key,target,sku,location);
 }

 const refs=originalEventRefs(current),incomingRefs=originalEventRefs(incoming);
 const portable=baseSource?source.packageInfo?.anchor?.sources?.[baseSource]?.records:null;
 for(const type of EVENT_TYPES){
  const destinations=snapshotEvents(next,type);
  const outbound=new Map(Object.values(portable?.[type]??{}).filter(row=>row?.target)
   .map(row=>[row.target,row]));
  const byId=new Map(destinations.map(info=>[info.id,info]));
  const byDay=new Map(),byIdentity=new Map(),byInherited=new Map();
  const baseRow=(row,lookup)=>row&&(row.externalRow??lookup[type]?.get(row.id));
  const index=info=>{
   const row=info.row??info.original;
   if(!row)return;
   if(!byDay.has(row.date))byDay.set(row.date,[]);
   byDay.get(row.date).push(info);
   if(sharedLineage&&info.original){
    const inherited=inheritedKey(type,baseRow(info.original,refs));
    if(inherited){
     if(!byInherited.has(inherited))byInherited.set(inherited,[]);
     byInherited.get(inherited).push(info);
    }
   }
   const identity=eventIdentity(row,refs[type]?.get(row.id));
   if(identity){
    if(!byIdentity.has(identity))byIdentity.set(identity,[]);
    byIdentity.get(identity).push(info);
   }
  };
  destinations.forEach(index);
  const seen=new Map();
  const claimed=new Set();
  const incomingRows=snapshotEvents(incoming,type);
  const recordsSeen=new Set(incomingRows.map(info=>info.id));
  for(const deletion of source.packageInfo?.changes??[]){
   if(deletion.type===type&&deletion.action==='delete'&&deletion.before&&!recordsSeen.has(deletion.id))
    incomingRows.push({id:deletion.id,row:null,original:deletion.before});
  }
  for(const info of incomingRows){
   const {row,original,id}=info;
   const sourceRow=row??original;
   if(!sourceRow)continue;
   if(suppressed.has(sourceRow.foodId))continue;
   const external=eventIdentity(sourceRow,incomingRefs[type]?.get(sourceRow.id));
   const fingerprint=hash(stable(eventData(type,sourceRow)));
   const primary=external?'id-'+hash(external):'row-'+fingerprint;
   const occurrence=(seen.get(primary)??0)+1;seen.set(primary,occurrence);
   const key=occurrence===1?primary:primary+'-'+occurrence;
   let old=oldMatch(type,key);
   const patch=row?eventRow(row,type,ids):null;
   const inherited=sharedLineage&&original?inheritedKey(type,baseRow(original,incomingRefs)):null;
   const baselineMatches=inherited?byInherited.get(inherited)??[]:[];
   const inheritedOnly=!raw&&original&&row&&same(row,original)||raw&&!!original;
   const untouchedGroup=baselineMatches.length>1&&baselineMatches.every(info=>same(info.row,info.original));
   const cutoff=sharedLineage&&validDate(leftLineage.cutoff)?leftLineage.cutoff:lastInheritedDay;
   const protectInherited=!!original&&(sharedLineage&&(sameEdition||!raw)||!external&&!!cutoff&&
    (!validDate(sourceRow.date)||sourceRow.date<=cutoff));
   const overlapsSummary=type==='foods'&&row&&actualFood(row)&&
    Object.values(currentBase[row.date]?.nutrition??{}).some(value=>value>0);
   const indexed=(byDay.get(sourceRow.date)??[]).filter(target=>nearby(type,target.row??target.original,sourceRow,names));
   const stableMatches=external?byIdentity.get(external)??[]:[];
   const available=indexed.filter(info=>!claimed.has(info.id));
   const informative=type!=='foods'||!!sourceRow.portion?.trim()||!!normalizeClock(sourceRow.time)||
    !!Object.values(sourceRow.nutrition??{}).some(value=>numeric(value)!==null);
   const exact=informative?available.filter(info=>equivalent(type,info.row??info.original,sourceRow,names)):[];
   const strong=external?stableMatches.filter(info=>!claimed.has(info.id)):[];
   const inheritedAvailable=baselineMatches.filter(info=>!claimed.has(info.id));
   const candidates=strong.length?strong:inheritedAvailable.length?inheritedAvailable:exact.length?exact:available;
   if(!old&&candidates.length===1&&!strong.length){
    const candidate=candidates[0].row??candidates[0].original;
    const matchTime=!normalizeClock(candidate.time)||!normalizeClock(sourceRow.time)||normalizeClock(candidate.time)===normalizeClock(sourceRow.time);
    const sameMeal=type!=='foods'||normalized(candidate.meal)===normalized(sourceRow.meal);
    if(matchTime&&sameMeal){
    const known=Object.entries(anchors[type]??{}).filter(([_key,value])=>value.target===candidates[0].id);
    if(known.length===1)old={...known[0][1],key:known[0][0]};
    }
   }
   let target=old&&byId.get(old.target);
   if(!target&&(candidates.length===1||untouchedGroup&&inheritedOnly&&inheritedAvailable.length))
    target=candidates[0];
   let status;
   const incomingHash=hash(stable(patch?eventData(type,patch):null));
   const before=target?.row??null;
   const beforeData=before?eventData(type,before):null;
   const incomingSame=!!old&&old.incoming===incomingHash;
   const provenInherited=!!target&&baselineMatches.includes(target)&&(baselineMatches.length===1||untouchedGroup&&inheritedOnly);
   const strongIdentity=!!old||strong.length===1||provenInherited;
   const shared=target&&outbound.get(id);
   const hasShared=shared&&typeof shared.accepted==='string'&&typeof shared.incoming==='string';
   const localChanged=hasShared&&hash(stable(beforeData))!==shared.incoming;
   const sourceChanged=hasShared&&incomingHash!==shared.accepted;
   if(incomingSame){status='existing';target=old.target?byId.get(old.target)??null:null;}
   else if(provenInherited&&inheritedOnly)status='same';
   else if(!provenInherited&&protectInherited&&!strong.length&&(!target||!exact.includes(target)))status='suspect';
   else if(provenInherited&&!inheritedOnly&&same(before,target.original)&&validDate(patch?.date??original?.date))status='corrected';
   else if(occurrence>1&&!old)status='suspect';
   else if(!target&&candidates.length)status='suspect';
   else if(!target&&!row)status='existing';
   else if(!target&&old?.target)status='conflict';
   else if(!target&&overlapsSummary)status='suspect';
   else if(!target)status='added';
   else if(!before&&!row)status='same';
   else if(before&&patch&&equivalent(type,before,patch,names)&&(informative||strongIdentity))status='same';
   else if(!old&&hasShared&&!sourceChanged)status='existing';
   else if(!old&&hasShared&&sourceChanged&&!localChanged&&!shared.kept)status='corrected';
   else if(old&&!old.kept&&old.accepted===hash(stable(beforeData))&&validDate(patch?.date??original?.date))status='corrected';
   else status=strongIdentity||hasShared?'conflict':'suspect';
   const separateAllowed=!!patch&&(!protectInherited||raw&&!sameEdition&&validDate(patch.date));
   const options=status==='conflict'?review:status==='suspect'?
    [{value:'keep',label:'保留现有记录'},...(separateAllowed?[{value:'separate',label:'作为独立记录加入'}]:[]),
     ...candidates.map(info=>({value:'take:'+info.id,label:'更正 '+(info.row??info.original).name+' · '+info.id}))]:[];
   const change=entry(type,key,target?before:candidates.map(info=>info.row),patch,status,options,
    protectInherited&&status==='suspect'?'继承自共同主账，身份未核定。可保留本机或指定原记录。':
    overlapsSummary&&status==='suspect'?'当天存在未逐条记录的摄入汇总。加入前需核对是否已计入。':
    type==='foods'?'影响对应日的营养、成本与已有扣库':'影响对应日的趋势或结算');
   if(change.chosen?.startsWith('take:'))target=byId.get(change.chosen.slice(5));
   const separate=change.chosen==='separate';
   if(separate)target=null;
   const targetId=target?.id??(separate||raw||byId.has(id)?'legacy-'+({foods:'food',weights:'weight',activities:'activity'}[type])+
    '-sync-'+hash(sourceId+type+key):id);
   const take=['added','corrected'].includes(status)||change.chosen==='take'||change.chosen?.startsWith('take:')||separate;
   if(options.length&&!change.chosen){
    suppressed.add(id);continue;
   }
   if(change.chosen==='keep'&&candidates.length>1&&!old){
    suppressed.add(id);
    saveAnchor(type,key,null,patch?eventData(type,patch):null,null,old);
    continue;
   }
   if(take){
    affectedDates(target?.row,patch);
    authorization[type+'Ids'].push(targetId);
    if(protectInherited&&!target&&patch&&!separate)failures.push('继承历史不能作为新增写入 · '+(patch.date||'日期未定'));
    if(type==='foods'&&!target&&patch&&actualFood(patch)&&validDate(patch.date)){
     newActualDates.add(patch.date);
     if(raw)newLegacyDates.add(patch.date);
    }
    if(!raw)changedNative.add(targetId);
    try{
     if(patch&&!validDate(patch.date)&&target)throw Error('原记录日期无效，请保留本机或作为独立历史记录导入');
     setEvent(next,type,target?.row,patch,targetId,!!raw);
    }catch(err){failures.push(labels[type]+' · '+(patch?.name??targetId)+'：'+err.message);continue;}
    const updated={id:targetId,row:patch?events(next,type).find(row=>row.id===targetId):null,original:target?.original};
    byId.set(targetId,updated);
    if(!target)index(updated);
   }
   if(incomingSame&&!target){suppressed.add(id);continue;}
   if(take||target){
    ids.set(id,targetId);claimed.add(targetId);
   }else if(!row)suppressed.add(id);
   const after=byId.get(targetId)?.row;
   if(incomingSame)continue;
   saveAnchor(type,key,take||target?targetId:null,patch?eventData(type,patch):null,after?eventData(type,after):null,old);
   if(change.chosen==='keep')anchors[type][key].kept=true;
  }
 }

 // Import Airplane records as a linked graph. External quantities are
 // already net balances, so historical purchases stay in the catalog.
 if(!raw){
  const orders=incoming.local.purchases??[];
  const financeRows=new Map((finance?.transactions??[]).map(row=>[row.id,row]));
  const seenOrders=next.local.purchases??=[];
  const ignoredLots=new Set(),ignoredOrders=new Set();
  const purchaseKey=order=>stable([order.date,order.totalCents,order.items.map(item=>[item.foodId,item.quantity,item.costCents]).sort()]);
  const reserve=(order,skip)=>{
   if(skip)ignoredOrders.add(order.id);
   order.items.forEach((item,i)=>ignoredLots.add(orderBatchId(order,item,i)));
  };
  const ownedLots=new Map();
  for(const order of orders)order.items.forEach((line,i)=>ownedLots.set(orderBatchId(order,line,i),order.id));
  for(const orderSrc of orders){
   const order=clone(orderSrc);
   order.items=order.items.map((item,i)=>({...item,foodId:ids.get(item.foodId)??item.foodId,
    batchId:orderBatchId(order,item,i)}));
   if(orderSrc.items.some(item=>suppressed.has(item.foodId))){reserve(order,true);continue;}
   const key=hash(order.id),old=oldMatch('purchases',key);
   const sameId=seenOrders.find(row=>row.id===(old?.target??order.id));
   const common=seenOrders.filter(row=>order.financeId&&row.financeId===order.financeId||purchaseKey(row)===purchaseKey(order));
   const close=seenOrders.filter(row=>row.date===order.date&&row.items.some(item=>order.items.some(other=>other.foodId===item.foodId)));
   const before=sameId??(common.length===1?common[0]:null);
   const compare=value=>value&&{...value,items:value.items.map(line=>({...line,batchId:undefined})),id:undefined,history:undefined,financeId:undefined};
   if(before&&(same(compare(before),compare(order))||old?.incoming===hash(stable(orderSrc)))){
    before.items.forEach((line,i)=>{
     const counterpart=order.items.find(other=>other.foodId===line.foodId&&other.quantity===line.quantity);
     if(counterpart)ids.set(counterpart.batchId,orderBatchId(before,line,i));
    });
    reserve(order,false);
    entry('purchases',key,before,order,'same');
    saveAnchor('purchases',key,before.id,orderSrc,before);
    continue;
   }
   if(before||close.length||common.length){
    const linked=before&&(before.financeId||financeRows.has('expense-'+before.id));
    const options=before?[{value:'keep',label:'保留本机采购'},
     ...(!linked||before.totalCents===order.totalCents&&before.date===order.date&&order.status!=='cancelled'?review.slice(1):[])]:
     [{value:'keep',label:'暂不入库'},{value:'separate',label:'确认为另一笔采购'}];
    const row=entry('purchases',key,before??common.concat(close),order,before?'conflict':'suspect',options,
     linked?'已关联财务。金额或日期的更正请在库存页处理原订单；合并不写财务。':'影响采购批次与成本，合并不新增财务支出');
    if(row.chosen==='take'){
     const items=order.items.map((item,i)=>({...item,batchId:before.items[i]?.foodId===item.foodId?orderBatchId(before,before.items[i],i):item.batchId}));
     let revision;
     try{revision=revisePurchase(next,before.id,order.status==='cancelled'?null:{...order,items});}
     catch(err){failures.push('采购 '+before.id+'：'+err.message);reserve(order,true);continue;}
     next.local=revision.next.local;
     order.items.forEach((line,i)=>ids.set(line.batchId,items[i].batchId));
     reserve(order,true);
     saveAnchor('purchases',key,before.id,orderSrc,revision.order);
    }else if(row.chosen!=='separate'){
     reserve(order,true);
     if(row.chosen)saveAnchor('purchases',key,before?.id??null,orderSrc,before);
     continue;
    }else{
     order.financeId=null; (next.local.purchases??=[]).push(order);
     saveAnchor('purchases',key,order.id,orderSrc,order);
    }
   }else{
    const tx=financeRows.get(order.financeId||'expense-'+order.id);
    const alreadyLinked=tx&&(next.local.purchases??[]).some(row=>row.financeId===tx.id||'expense-'+row.id===tx.id);
    order.financeId=tx?.type==='expense'&&Math.round(tx.amount*100)===order.totalCents&&!alreadyLinked?tx.id:null;
    (next.local.purchases??=[]).push(order);
    entry('purchases',key,null,order,'added',[],'只合并健康入库及批次。财务不变。');
    saveAnchor('purchases',key,order.id,orderSrc,order);
   }
  }
  const sourceSkus=new Map(incomingInventory.map(row=>[row.id,row]));
  const targetSkus=new Map([...next.legacy.inventory,...(next.local.inventory??[])].map(row=>[row.id,row]));
  const unitsDiffer=(sourceId,targetId)=>sourceSkus.has(sourceId)&&targetSkus.has(targetId)&&
   sourceSkus.get(sourceId).unit!==targetSkus.get(targetId).unit;
  const covered=new Set(incoming.local.stockMoves.filter(move=>move.linkedFoodId&&!ignoredOrders.has(ownedLots.get(move.batchId))&&
   !suppressed.has(move.linkedFoodId)&&!unitsDiffer(move.foodId,ids.get(move.foodId)??move.foodId))
   .map(move=>ids.get(move.linkedFoodId)??move.linkedFoodId));
  const priorFoodIds=new Set(events(current,'foods').map(row=>row.id));
  if(covered.size)next.local.stockMoves=next.local.stockMoves.filter(move=>!covered.has(move.linkedFoodId)||!changedNative.has(move.linkedFoodId));
  // A corrected order was already replayed via revisePurchase; do not replay
  // its receipts or cost allocations from the source's copy of the graph.
  for(const kind of ['batches','stockMoves','templates','shoppingList']){
   const local=next.local[kind]??=[];
   const index=new Map(local.map(row=>[keyFor(kind,row),row]));
   const byContent=new Map(local.map(row=>[hash(stable({...row,id:undefined,createdAt:undefined})),row]));
   for(const row of incoming.local[kind]??[]){
    if(suppressed.has(row.foodId)||suppressed.has(row.linkedFoodId))continue;
    const lotId=kind==='batches'?row.id:row.batchId??row.parent;
    const owner=ownedLots.get(lotId);
    if(ignoredOrders.has(owner)||(ignoredLots.has(lotId)&&(kind==='batches'||kind==='stockMoves'&&row.delta>0)))continue;
    if(kind==='batches'&&ignoredLots.has(row.parent)&&!ids.has(row.parent))continue;
    const copy=clone(row),keyValue=keyFor(kind,row);
    if(!safeKey(keyValue))throw Error('同步记录缺少有效 ID');
    for(const field of ['foodId','batchId','parent','linkedFoodId'])if(copy[field])copy[field]=ids.get(copy[field])??copy[field];
    if(kind==='templates')copy.items.forEach(item=>{if(item.foodId)item.foodId=ids.get(item.foodId)??item.foodId;});
    if(kind==='batches'&&ids.has(row.id))copy.id=ids.get(row.id);
    const key=hash(keyValue),target=keyFor(kind,copy),old=oldMatch(kind,key);
    const before=index.get(old?.target??target)??byContent.get(hash(stable({...copy,id:undefined,createdAt:undefined})));
    const linkedExisting=kind==='stockMoves'&&copy.linkedFoodId&&priorFoodIds.has(copy.linkedFoodId);
    if(linkedExisting&&!changedNative.has(copy.linkedFoodId))continue;
    if((kind==='stockMoves'||kind==='batches')&&unitsDiffer(row.foodId,copy.foodId)){
     const beforeUnit=sourceSkus.get(row.foodId).unit,afterUnit=targetSkus.get(copy.foodId).unit;
     const reason='来源单位 '+beforeUnit+'，本机单位 '+afterUnit+'。无法直接套用数量。';
     const unitKey=key+'-unit';
     const stockRef={...copy,sourceUnit:beforeUnit,targetUnit:afterUnit};
     if(oldMatch(kind,unitKey)?.incoming===hash(stable(stockRef)))continue;
     const issue=entry(kind,unitKey,null,stockRef,'suspect',
      [{value:'keep',label:'保留本机库存，暂缓合并该流水或批次'}],reason);
     if(issue.chosen){
      saveAnchor(kind,unitKey,null,stockRef,null);
      if(copy.linkedFoodId&&!linkedExisting){
       const food=events(next,'foods').find(item=>item.id===copy.linkedFoodId);
       if(food&&changedNative.has(food.id))food.stockQty=null;
      }
     }
     continue;
    }
    const equal=same(before,copy)||before&&same({...before,id:undefined,createdAt:undefined},{...copy,id:undefined,createdAt:undefined});
    const status=equal?'same':old?.incoming===hash(stable(row))?'existing':!before?'added':
     old&&old.accepted===hash(stable(before))?'corrected':'conflict';
    const change=entry(kind,key,before,copy,status,status==='conflict'?review:[],'保留记录和关联 ID，库存与成本随流水计算');
    const take=['added','corrected'].includes(status)||change.chosen==='take';
    if(!change.options.length||change.chosen){
     if(take){
      const id=before?keyFor(kind,before):target;
      if(before&&kind!=='shoppingList')copy.id=id;
      upsert(local,value=>keyFor(kind,value),copy,id);index.set(id,copy);
      if(kind==='batches')ids.set(row.id,id);
     }
     saveAnchor(kind,key,before?keyFor(kind,before):target,row,take?copy:before);
    }
   }
  }
  const syncedFoods=[...next.local.foods,...Object.values(next.local.edits?.foods??{}).filter(Boolean)];
  for(const row of syncedFoods)
   if(changedNative.has(row.id)&&row.batchId&&ids.has(row.batchId))row.batchId=ids.get(row.batchId);
 }else{
  for(const lot of incoming.local.batches??[]){
   if(!newSkus.has(lot.foodId)||!lot.openingPortion)continue;
   const target=ids.get(lot.foodId),id='sync-opening-'+hash(sourceId+target+lot.id);
   if(!(next.local.batches??=[]).some(row=>row.id===id))next.local.batches.push({...lot,id,foodId:target});
  }
 }

 // A weighed bottle without a verified net capacity can retain its food
 // record, but cannot create a fractional stock movement.
 const skus=new Map(inventoryWithMoves(next).map(row=>[row.id,row]));
 const linkedFoods=new Set(next.local.stockMoves.map(row=>row.linkedFoodId).filter(Boolean));
 const pending=[];const priorPending=new Map((sync.pendingStock??[]).map(row=>[row.id,row]));
 for(const food of events(next,'foods')){
  const sku=skus.get(food.foodId);
  if(!actualFood(food)||!food.weighing||!sku||food.stockQty!=null||linkedFoods.has(food.id)||
   quantityInUnit(sku,1,'g',sku.unit)!==null)continue;
  const detail={id:food.id,foodId:sku.id,date:food.date,name:food.name,portion:food.portion,stockUnit:sku.unit,
   weighing:food.weighing,reason:'缺少可核实的单位换算'};
  // Also surface records already on this device when first merging.
  const prior=priorPending.get(food.id);
  if(!same(prior,detail))entry('stockLinks',hash(food.id),prior,detail,'suspect',
   [{value:'keep',label:'保留饮食，待核对包装资料'}],'保留份量和营养，不自动改变库存数量');
  pending.push(detail);
 }
 if(pending.length||sync.pendingStock)sync.pendingStock=pending;

 const incomingBase=baselines(incoming);
 for(const date of newActualDates){
  if(currentBase[date]&&!incomingBase[date])incomingBase[date]={
   nutrition:{},unresolved:[],baseTdee:currentBase[date].baseTdee,note:'',status:''};
 }
 for(const [date,base] of Object.entries(incomingBase)){
  const before=currentBase[date],key=hash(date),old=oldMatch('baselines',key);
  const relevant=value=>value&&{nutrition:Object.fromEntries(Object.entries(value.nutrition).filter(([,q])=>q!==0)),baseTdee:value.baseTdee};
  const meaningful=Object.values(base.nutrition).some(n=>n>0)||base.baseTdee!==null;
  const hasEvents=EVENT_TYPES.some(type=>events(current,type).some(row=>row.date===date));
  const sameData=same(relevant(before),relevant(base));
  const residualOverlap=newActualDates.has(date)&&Object.values(before?.nutrition??{}).some(value=>value>0);
  const conflicts=residualOverlap||!sameData&&meaningful&&(!!before||hasEvents);
  const exactlySame=same(current.legacy.daily[date],incoming.legacy.daily[date])&&
   same(current.legacy.energy[date],incoming.legacy.energy[date]);
  const status=residualOverlap?'conflict':old?.incoming===hash(stable(base))?'existing':exactlySame?'same':base.unresolved.length?'suspect':
   sameData?'same':conflicts||sameEdition&&!!before?'conflict':'added';
  const options=residualOverlap?[{value:'take',label:'采用来源的基线差额'}]:
   status==='conflict'?review:status==='suspect'?[{value:'keep',label:'保留本机，来源汇总只供核对'}]:[];
  const row=entry('baselines',key,before&&{date,...before},{date,...base},status,options,
   '只合并没有被原始事件覆盖的差额与消耗基线，绝不叠加两边的已记录摄入');
  if((status==='added'&&meaningful)||row.chosen==='take'){
   baselineChoices[date]=base;dates.add(date);authorization.baselines.push(date);
  }
  if(!options.length||row.chosen)saveAnchor('baselines',key,date,base,baselineChoices[date]??before??null);
 }
 chooseBaseline(current,next,baselineChoices,new Set([...newLegacyDates,...Object.keys(baselineChoices)]));

 const settingFields=['calorieTarget','proteinMin','proteinMax','fatMin','sodiumTarget','baselineTdee','cycleDays','cycleTarget','cycleAnchor','preferences'];
 for(const field of settingFields){
  const value=incoming.settings[field],before=current.settings[field];
  if(value===undefined||same(value,before))continue;
  const key=hash(field),old=oldMatch('settings',key),changed=old?.incoming!==hash(stable(value));
  const row=entry('settings',key,{[field]:before},{[field]:value},changed?'conflict':'existing',changed?review:[],'采用后重新计算未来页面的目标或周期');
  if(row.chosen==='take'){next.settings[field]=value;authorization.settings.push(field);}
  if(!row.options.length||row.chosen)saveAnchor('settings',key,field,value,next.settings[field]);
 }
 const stockChanges=changedRows(current.local.stockMoves,next.local.stockMoves,row=>row.id);
 authorization.stockMoves=stockChanges.map(([id])=>id);
 authorization.stockSkus=[...new Set(stockChanges.flatMap(([,old,row])=>[old?.foodId,row?.foodId]).filter(Boolean))];
 const problems=failures.concat(verifyGraph(next,current),verifyMergeConsistency(current,next,authorization));
 if(next.settings.proteinMin>next.settings.proteinMax)problems.push('蛋白质下限大于上限');
 if(!validateAppState(next))problems.push('合并后的账本格式无效');
 const unresolved=rows.filter(row=>row.options.length&&!row.chosen);
 const changes=rows.filter(row=>['added','corrected'].includes(row.status)||row.chosen)
  .map(({kind,id,status,chosen,before,after})=>({type:kind,id,action:chosen??status,before,after}));
 const prior=sources[sourceId];
 if(!prior||prior.version!==source.version||!same(prior.anchors,anchors)||prior.sourceRevision!==newRevision||changes.length){
  sources[sourceId]={version:source.version,anchors,...(Number.isSafeInteger(newRevision)?{sourceRevision:newRevision}:{}),
   ...(raw?{file:source.label}:{}),...(changes.length?{changes}:prior?.changes?{changes:prior.changes}:{})};
 }
 const impact=[...dates].sort().map(date=>({date,before:dayIntake(current,date).totals,after:dayIntake(next,date).totals,
  tdeeBefore:energyForDay(current,date,date).tdee,tdeeAfter:energyForDay(next,date,date).tdee}));
 return {next,rows,unresolved,problems,impact,authorization,changed:!same(next,current)};
}
