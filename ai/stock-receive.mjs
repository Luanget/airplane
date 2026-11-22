import {fillSkuFoodGroup} from '../health/food-categories.mjs';
import {normalizeClock} from '../calendar.mjs';
import {inventoryWithMoves,isStockReference,round,validDate} from '../health/core.mjs';
import {quantityInUnit} from '../health/candidates.mjs';
import {confirmPackageAction,ensureContainers,packagesFor} from '../health/containers.mjs';
import {registerPortions,saveSku} from '../health/inventory.mjs';
import {cents,orderBatchId,recordPurchase,revisePurchase} from '../health/purchases.mjs';
import {hash,stable} from '../health/sync-source.mjs';
import {amountSupported} from './evidence.mjs';

const nameKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
const packageUnits=new Set(['袋','盒','瓶','包']);

export function prepareStockReceipt(current,{date,lines,note},{id,today,time,evidence,transcript=[]}){
 if(!validDate(date)||date>today||!lines.length)throw Error('请选择今天或更早的采购日期和食品。');
 const next=structuredClone(current),stock=inventoryWithMoves(next).filter(row=>!isStockReference(row));
 const photographic=evidence.sources.some(row=>row.kind==='attachment');
 const at=normalizeClock(time),parts=[],items=[],reused=new Set();
 for(const line of lines){
  const {name,skuId,amount,unit,packAmount,packUnit,portions,label,cost}=line;
  const aliases=row=>[row.name,...(row.aliases??[])].map(nameKey);
  const term=nameKey(name),exact=stock.filter(row=>aliases(row).includes(term));
  const possible=exact.length?exact:stock.filter(row=>row.active&&aliases(row).some(label=>label.includes(term)||term.includes(label)));
  let sku=skuId?stock.find(row=>row.id===skuId):possible.length===1?possible[0]:null;
  if(skuId&&!sku||!skuId&&possible.length>1)throw Error('请先核对「'+name+'」的唯一 SKU。');
  if(skuId&&sku&&![sku.name,...(sku.aliases??[])].map(nameKey).some(key=>key.includes(nameKey(name))||nameKey(name).includes(key)))
   throw Error('所选 SKU 与「'+name+'」名称不一致，请用包装标签核对。');
  if(sku&&!sku.active)throw Error('「'+sku.name+'」已停用，请核对后再恢复。');
  if(label&&!photographic&&!evidence.owner)throw Error('录入营养标签前请提供对应的标签照片；仍可按未知营养入库。');
  if(cost!==null&&!photographic&&!evidence.owner&&!amountSupported(evidence.texts,cost,'元',sku)){
   // Money entered as an isolated explicit value also needs a separate expenditure action.
   throw Error('该批成本缺少可核对的原始金额。可以将成本留空继续入库。');
  }
  if(!sku){
   const stockUnit=packageUnits.has(unit)&&packAmount&&packUnit?packUnit:portions[0]?.unit??unit;
   if(!stockUnit)throw Error('新食品缺少库存计量单位。');
   sku=saveSku(next,{id:'sku-stock-'+hash(nameKey(name)),name,unit:stockUnit,basisUnit:label?.unit??stockUnit,
    basisAmount:label?.amount??1,packageKind:packageUnits.has(unit)?unit:null,packageSize:packAmount,packageUnit:packUnit,
    ...(label?.nutrition??{}),quality:label?'label':'unknown',
    source:label?(photographic?'用户提供的包装标签照片':'用户申报营养值'):'用户申报入库'});
   stock.push(sku);
  }
  fillSkuFoodGroup(next,sku.id,line);
  const conversion=packAmount&&packUnit&&packageUnits.has(unit)?{...sku,standard:'',pack:unit,packageSize:packAmount,packageUnit:packUnit}:sku;
  const convert=(value,from)=>quantityInUnit(conversion,value,from,sku.unit);
  const weights=portions.map(portion=>{
   if(portion.status==='open'&&portion.gross!=null&&(!(portion.gross>0)||!photographic&&!evidence.owner&&!amountSupported(evidence.texts,portion.gross,'g',sku)))
    throw Error('开封分装需要可核对的当前毛重。');
   if(sku.unit!=='g')throw Error('独立净重分装需要按克管理的食品。整盒食品可直接填写盒数和规格。');
   if(!photographic&&!evidence.owner&&!amountSupported(evidence.texts,portion.amount,portion.unit,sku))throw Error('缺少分装重量依据：'+portion.amount+' '+portion.unit);
   const value=convert(portion.amount,portion.unit);
   if(!(value>0))throw Error('分装净重无法换算。');
   return value;
  });
  const split=round(weights.reduce((sum,value)=>sum+value,0),6);
  const count=unit==='份'&&weights.length===amount;
  const quantity=round(amount==null||count?split:convert(amount,unit),6);
  if(!(quantity>0)||quantity<split-1e-6)throw Error('「'+name+'」的采购量与分装不一致，请核对。');
  if(amount!=null&&!photographic&&!evidence.owner&&!(weights.length&&quantity===split&&(!count||amountSupported(evidence.texts,amount,unit,sku)))&&
   !amountSupported(evidence.texts,amount,unit,conversion))throw Error('「'+name+'」的入库数量缺少可核对的消息或照片。');
  const associated=transcript.filter(turn=>[term,...aliases(sku)].some(alias=>alias&&nameKey(turn.text).includes(alias))&&
   (amount!=null&&amountSupported([turn.text],amount,unit,conversion)||weights.some(value=>amountSupported([turn.text],value,sku.unit,sku)))).slice(-1);
  const audited=[...evidence.sources,...associated.filter(turn=>!evidence.sources.some(source=>source.id===turn.id))
   .map(turn=>({kind:'message',id:turn.id}))];
  const exactPrice=cost==null?null:cents(cost);
  const earlier=(current.local.purchases??[]).find(order=>order.date===date&&order.status!=='cancelled'&&order.stockOnly&&order.items.some(item=>
   item.foodId===sku.id&&item.quantity===quantity&&(exactPrice==null||item.costCents===exactPrice)&&
   (item.sourceEvidence??order.sourceEvidence)?.some(old=>old.id&&audited.some(source=>source.id===old.id&&source.kind===old.kind))));
  if(earlier){reused.add(earlier.id);continue;}
  parts.push({foodId:sku.id,weights,portions});
  items.push({foodId:sku.id,quantity,costCents:exactPrice,expires:null,receiptLine:items.length,sourceEvidence:audited,
   ...(packAmount&&packUnit&&packageUnits.has(unit)?{packageSpec:{size:packAmount,unit:packUnit,kind:unit}}:{})});
 }
 if(!items.length&&reused.size)return {existing:[...reused]};
 const signature=hash(stable([date,items.map(({foodId,quantity,costCents},i)=>[foodId,quantity,costCents,parts[i].weights]).map(stable).sort()]));
 const prior=(current.local.purchases??[]).find(row=>row.stockSignature===signature&&row.status!=='cancelled'&&
  row.sourceEvidence?.some(old=>old.id&&evidence.sources.some(source=>source.id===old.id&&source.kind===old.kind)));
 if(prior)return {existing:[prior.id]};
 const saved=recordPurchase(next,{id,date,time:at,items,stockOnly:true,note:note?.trim()||'助手采购入库',stockSignature:signature,
  sourceEvidence:evidence.sources,totalCents:items.every(row=>row.costCents!==null)?items.reduce((sum,row)=>sum+row.costCents,0):null});
 const batchIds=items.map((item,index)=>orderBatchId(saved,item,index)),subLots=[];
 for(const [index,part] of parts.entries()){
  if(!part.weights.length)continue;
  const split=registerPortions(next,{foodId:part.foodId,batchId:batchIds[index],date,quantities:part.weights,id:id+':split:'+index});
  split.forEach((lot,i)=>subLots.push({...part.portions[i],id:lot.id,foodId:part.foodId}));
 }
 let staged=ensureContainers(next);
 const openings=[];
 for(const part of subLots.filter(row=>row.status==='open'&&row.gross!=null)){
  const box=packagesFor(staged,part.foodId).find(row=>row.batchId===part.id);
  const result=confirmPackageAction(staged,{id:part.id+':opening',date,time:at,action:'baseline',containerId:box?.id,
   expectedHead:box?.head,gross:part.gross});
  openings.push(result.event.id);staged=result.next;
 }
 return {next:staged,receipt:{purchaseId:saved.id,batchIds,portionBatchIds:subLots.map(row=>row.id),items:saved.items,totalCents:saved.totalCents,
  reusedPurchaseIds:[...reused],unmeasuredOpenPortions:subLots.filter(row=>row.status==='open'&&row.gross==null).map(row=>row.id)},
  undo:{kind:'stock_receipt',id,openings}};
}

export async function undoStockReceipt(workspace,token){
 const current=await workspace.readHealth(),next=structuredClone(current);
 const order=next.local.purchases?.find(row=>row.id===token.id);
 if(!order||order.status==='cancelled')throw Error('入库已撤销或原记录不可用。');
 if(order.receiptId||order.financeId)throw Error('该入库已关联财务，请从关联订单核对后撤销。');
 const openings=new Set(token.openings??[]),events=next.local.containerEvents??[];
 const touched=new Set(events.filter(event=>openings.has(event.id)).map(event=>event.containerId));
 if(events.some(event=>touched.has(event.containerId)&&!openings.has(event.id)))throw Error('包装已有后续用量或称重，请先核对这些记录。');
 if(openings.size){
  order.stockOpeningAudit=events.filter(event=>openings.has(event.id));
  next.local.containerEvents=events.filter(event=>!openings.has(event.id));
 }
 const {next:revised}=revisePurchase(next,order.id,null);
 await workspace.saveHealth(revised,current.revision??0);
 if(!(await workspace.readHealth()).local.purchases.find(row=>row.id===order.id&&row.status==='cancelled'))
  throw Error('撤销回执待核对，请重新读取。');
 return '已撤销这次入库。';
}
