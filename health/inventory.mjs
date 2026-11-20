import {allocateStock,batchBalances,inventoryWithMoves,makeId,numeric,NUTRIENTS,round,validDate,zero} from './core.mjs';

export function measuredGrams({before='',after='',tare=''}) {
  const gross=numeric(before), leftover=numeric(after), packageWeight=numeric(tare);
  if ([gross,leftover,packageWeight].every(x=>x===null)) return null;
  if (gross===null || leftover!==null && packageWeight!==null || (leftover??packageWeight??-1)<0 || gross<=(leftover??packageWeight))
    throw Error('请填写称重前后两次毛重，或填写毛重和空包装重');
  return round(gross-(leftover??packageWeight),3);
}

export function convertCookingWeight(value,from,to,raw,cooked) {
  if(from===to)return value;
  if (!(raw>0&&cooked>0) || !['raw','cooked'].includes(from) || !['raw','cooked'].includes(to))
    throw Error('请记录同批食材生重及熟重');
  return round(value*(to==='raw'?raw/cooked:cooked/raw),6);
}

export function saveSku(state,fields) {
  const {id,name,unit,basisUnit,source='',quality='label',stage='raw',stockStage='raw'}=fields;
  const quantity=numeric(fields.basisAmount), price=numeric(fields.price), minimum=numeric(fields.minimum), packageSize=numeric(fields.packageSize);
  if(!name?.trim()||!unit||!basisUnit||!(quantity>0)||[price,minimum,packageSize].some(v=>v!==null&&v<0))
    throw Error('请检查食品名称、单位和营养基准');
  const legacy=state.legacy.inventory, local=state.local.inventory??=[];
  const previous=[...legacy,...local].find(s=>s.id===id);
  if (previous && previous.unit!==unit)throw Error('请用原库存单位。不同单位可新增食品');
  const nutrition=Object.fromEntries(NUTRIENTS.map(k=>[k,numeric(fields[k])]));
  if(Object.values(nutrition).some(v=>v!==null&&v<0))throw Error('营养数值不能为负');
  const row={...previous,id:id||makeId('sku'),name:name.trim(),unit,basisUnit,basisAmount:quantity,stage,stockStage,
    packageSize,packageUnit:packageSize?fields.packageUnit:null,pack:packageSize?unit:null,
    nutritionBasis:'custom',standard:quantity+' '+basisUnit,qty:previous?previous.qty:0,
    pricePerUnit:price,priceBasis:unit,minimum,source,quality,nutrition,active:true};
  if(previous)Object.assign(previous,row);else local.push(row);
  return row;
}

export function addBatch(state,{id=makeId('batch'),foodId,date,time,quantity,costCents=null,expires=null,raw=null,cooked=null,reason='采购',parent=null}) {
  quantity=numeric(quantity);
  if(!validDate(date) || !(quantity>0) || expires&&!validDate(expires) || !inventoryWithMoves(state).some(s=>s.id===foodId))
    throw Error('请检查批次数量、食品和日期');
  if(costCents!==null && (!Number.isSafeInteger(costCents)||costCents<0))throw Error('价格须精确到分');
  const batches=state.local.batches??=[];
  if(batches.some(b=>b.id===id))throw Error('此批次已入库');
  const batch={id,foodId,date,quantity,costCents,expires,raw,cooked,parent};
  batches.push(batch);
  state.local.stockMoves.push({id:makeId('stock'),batchId:id,foodId,date,...(time?{time}:{}),delta:quantity,reason,createdAt:new Date().toISOString()});
  return batch;
}

// Split in the SKU's storage unit. A serving may have a different cooked weight.
export function splitBatch(state,{batchId,date,quantity,count}) {
  const batch=batchBalances(state).find(b=>b.id===batchId);
  const part=numeric(quantity), parts=numeric(count);
  const total=round(part*parts,6);
  if(!batch || !validDate(date) || !(part>0)||!Number.isInteger(parts)||parts<1||parts>100||total>batch.remaining+1e-6)
    throw Error('请检查分装数量和原批次余量（一次最多 100 份）');
  const [{costCents}]=allocateStock(state,batch.foodId,total,batchId,date);
  const actionId=makeId('split');
  state.local.stockMoves.push({id:actionId,batchId,foodId:batch.foodId,date,delta:-total,costCents,reason:'分装转出',createdAt:new Date().toISOString()});
  return Array.from({length:parts},(_,i)=>addBatch(state,{...batch,id:actionId+'-'+i,date,quantity:part,parent:batchId,
    costCents:costCents===null?null:Math.round((i+1)*costCents/parts)-Math.round(i*costCents/parts),reason:'分装转入'}));
}

export function stockAlerts(state,today) {
  const low=inventoryWithMoves(state).filter(s=>s.active && s.minimum!=null && s.qty!==null && s.qty<=s.minimum);
  const expiry=batchBalances(state).filter(b=>b.remaining>0 && b.expires &&
    new Date(b.expires+'T00:00:00Z')-new Date(today+'T00:00:00Z')<=3*86400000);
  return {low,expiry};
}
