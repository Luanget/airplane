import {apportionedCost} from './package-price.mjs';
// The journal keeps physical observations even when an associated food is corrected.
export const containerTypes=['baseline','eat','net','loss','refill','reweigh','portion','empty','discard','correct','void'];
export const onShelf=container=>container.status==='sealed'||container.status==='open';
const rounded=n=>Number(n.toFixed(6));

export function packageJournal(state,id){
 return (state.local.containerEvents??[]).filter(event=>event.containerId===id);
}

export function packageReading(container,rows){
 let status='sealed',initialGross=null,gross=null,tare=container.tare??null,net=container.actualNetGrams??container.estimatedNetGrams??null;
 let estimated=container.actualNetGrams==null&&container.estimatedNetGrams!=null;
 const revisions=new Map(rows.filter(row=>row.type==='correct').map(row=>[row.target,row]));
 const voids=new Map(rows.filter(row=>row.type==='void').map(row=>[row.target,row]));
 const measurements=[],foodIds=[],unassigned=[];
 let unweighedGrams=0;
 let eaten=0,volumeMl=0,lost=0,spent=0,lossCost=0,unknownCost=false,unknownLoss=false;
 for(const row of rows){
  if(row.type==='correct'||row.type==='void'){
   if(row.tare!=null)tare=row.tare;
   continue;
  }
  if(row.derivedFrom&&voids.has(row.derivedFrom))continue;
  const revision=revisions.get(row.id),voided=voids.get(row.id);
  if(voided&&!voided.keepGross)continue;
  const event=revision?.type==='correct'?{...row,...revision.values}:row;
  if(event.tare!=null)tare=event.tare;
  if(event.type==='baseline'){
   initialGross??=event.gross;
   status='open';
  }
  if(event.gross!=null){gross=event.gross;unweighedGrams=0;}
  if(event.type==='portion'){net=event.grams;estimated=event.estimated===true;}
  if(event.type==='eat'||event.type==='net'){
   status='open';
   if(net!=null)net=rounded(net-event.grams);
   if(event.type==='net'&&event.gross==null)unweighedGrams=rounded(unweighedGrams+(event.grams??0));
   if(voided)unassigned.push(row.id);
   else {
    eaten+=event.grams??0;
    volumeMl+=event.volumeMl??0;
    if(event.foodId)foodIds.push(event.foodId);
    const estimatedCost=event.source==='migration'&&container.costEstimated?apportionedCost(container.costCents,
     container.nominal?.unit==='mL'?event.volumeMl:event.grams,container.actualNetGrams??container.nominal?.value,spent+lossCost):null;
    const cost=event.costCents??estimatedCost;
    if(cost==null)unknownCost=true;
    else spent+=cost;
   }
  }
  if(event.type==='loss'||event.type==='discard'){
   if(event.grams==null)unknownLoss=true;
   else {
    lost+=event.grams;
    if(net!=null)net=rounded(net-event.grams);
   }
   if(event.costCents!=null)lossCost+=event.costCents;
  }
  if(event.type==='refill'&&net!=null)net=rounded(net+event.grams);
  if(event.type==='empty')lossCost+=event.costCents??0;
  if(event.type==='empty'||event.type==='discard')status=event.type==='empty'?'empty':'discarded';
  if(event.gross!=null)measurements.push({id:row.id,date:event.date,gross:event.gross,type:event.type,revised:!!revision});
 }
 if(tare!=null&&gross!=null)net=rounded(gross-tare-unweighedGrams),estimated=false;
 if(net!==null&&net<0)net=null;
 if(!onShelf({status}))net=0,estimated=false;
 return {...container,status,initialGross,gross,unweighedGrams,tare,net,estimated,measurements,
  eaten:rounded(eaten),volumeMl:rounded(volumeMl),lost:rounded(lost),unknownLoss,spent,lossCost,unknownCost,foodIds,unassigned,head:rows.at(-1)?.id??null};
}

export function managedFoodPackage(state,id){
 const rows=state.local.containerEvents??[];
 const voids=new Set(rows.filter(row=>row.type==='void').map(row=>row.target));
 const event=rows.find(row=>row.foodId===id&&(row.type==='eat'||row.type==='net')&&!voids.has(row.id));
 if(!event)return null;
 return {event,container:state.local.containers?.find(row=>row.id===event.containerId),journal:packageJournal(state,event.containerId)};
}

export const hasLaterPackageReading=(journal,event)=>
 journal.slice(journal.indexOf(event)+1).some(row=>row.type!=='correct'&&row.type!=='void'&&row.derivedFrom!==event.id);

export function voidPackageFood(state,id,date){
 const linked=managedFoodPackage(state,id);
 if(!linked||linked.journal.some(row=>row.type==='void'&&row.target===linked.event.id))return;
 const {event,journal}=linked,last=journal.at(-1);
 const retained=hasLaterPackageReading(journal,event);
 const correction={id:'void:'+event.id,containerId:event.containerId,previousId:last.id,target:event.id,
  type:'void',date,keepGross:retained,reason:'关联饮食撤销'};
 state.local.containerEvents.push(correction);
 const closed=journal.find(row=>row.derivedFrom===event.id&&row.stockMoveId);
 if(closed&&!retained)state.local.stockMoves=state.local.stockMoves.filter(row=>row.id!==closed.stockMoveId);
 if(retained)for(const move of state.local.stockMoves.filter(row=>row.linkedFoodId===id)){
  delete move.linkedFoodId;
  move.reason='称重差待核对';
 }
}

export function validContainerTables(local,validDate){
 const containers=local.containers??[],journal=local.containerEvents??[];
 if(!Array.isArray(containers)||!Array.isArray(journal))return false;
 const id=value=>typeof value==='string'&&value.length>0&&!['__proto__','constructor','prototype'].includes(value);
 const amount=value=>value==null||Number.isFinite(value)&&value>=0;
 const unique=rows=>new Set(rows.map(row=>row.id)).size===rows.length;
 if(!containers.every(c=>c&&id(c.id)&&id(c.foodId)&&id(c.batchId)&&typeof c.kind==='string'&&
  [c.actualNetGrams,c.estimatedNetGrams,c.tare,c.nominal?.value,c.stockAmount,c.costCents].every(amount)))return false;
 const heads=new Map(containers.map(row=>[row.id,null])),seen=new Map();
 return unique(containers)&&journal.every(row=>{
  if(!row||!id(row.id)||seen.has(row.id)||!heads.has(row.containerId)||heads.get(row.containerId)!==(row.previousId??null)||
   !containerTypes.includes(row.type)||!validDate(row.date)||![row.gross,row.grams,row.tare,row.volumeMl,row.costCents].every(amount))return false;
  if(row.derivedFrom&&seen.get(row.derivedFrom)?.containerId!==row.containerId)return false;
  if(row.type==='correct'||row.type==='void'){
   if(seen.get(row.target)?.containerId!==row.containerId)return false;
   if(row.type==='correct'&&(!row.values||![row.values.gross,row.values.grams,row.values.volumeMl,row.values.costCents].every(amount)))return false;
  }
  seen.set(row.id,row);heads.set(row.containerId,row.id);
  return true;
 });
}
