import {allocateStock,batchBalances,inventoryWithMoves,isOnHand,isStockReference,makeId,numeric,NUTRIENTS,round,validDate} from './core.mjs';

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

// The stored unit keeps historical movements and prices meaningful.
export function stockMeasure(sku) {
  const unit=sku?.unit??'';
  if(!['包','盒','袋','瓶'].includes(unit))return {unit,factor:1};
  const specs=[sku.standard,sku.unitDescription].join(' ').normalize('NFKC');
  const counts=new Set();
  for(const match of specs.matchAll(/(\d+)\s*个\s*\/\s*([包盒袋瓶])|每\s*([包盒袋瓶])\s*(\d+)\s*个/g)){
    if((match[2]??match[3])===unit)counts.add(Number(match[1]??match[4]));
  }
  const factor=sku.piecesPerPack===undefined?(counts.size===1?[...counts][0]:null):sku.piecesPerPack;
  return Number.isSafeInteger(factor)&&factor>0?{unit:'个',factor}:{unit,factor:1};
}

export function displayStockQuantity(sku,quantity) {
  const {factor}=stockMeasure(sku);
  return quantity==null?null:factor===1?quantity:round(quantity*factor,4);
}

export function storedStockQuantity(sku,quantity) {
  const value=numeric(quantity);
  return value===null?null:value/stockMeasure(sku).factor;
}

export function matchingSku(state,name,unit){
 const key=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
 const candidates=[...state.legacy.inventory,...(state.local.inventory??[])].filter(row=>row.unit===unit&&key(row.name)===key(name));
 if(candidates.some(row=>!row.active)&&!candidates.some(row=>row.active))throw Error('此食品已停用，请核对正式使用的同款食品');
 return candidates.length===1?candidates[0]:null;
}

export function saveSku(state,fields) {
  const {id,name,unit,basisUnit,source='',quality='label',stage='raw',stockStage='raw'}=fields;
  const quantity=numeric(fields.basisAmount), price=numeric(fields.price), minimum=numeric(fields.minimum), packageSize=numeric(fields.packageSize);
  if(!name?.trim()||!unit||!basisUnit||!(quantity>0)||[price,minimum,packageSize].some(v=>v!==null&&v<0))
    throw Error('请检查食品名称、单位和营养基准');
  const legacy=state.legacy.inventory, local=state.local.inventory??=[];
  const previous=id?[...legacy,...local].find(s=>s.id===id):matchingSku(state,name,unit);
  if (previous && previous.unit!==unit)throw Error('请用原库存单位。不同单位可新增食品');
  const pieces=Object.hasOwn(fields,'piecesPerPack')?numeric(fields.piecesPerPack):
    (previous?.piecesPerPack??(previous&&stockMeasure(previous).unit!==unit?stockMeasure(previous).factor:null));
  if(pieces!==null&&(!Number.isSafeInteger(pieces)||pieces<1||!['包','盒','袋','瓶'].includes(unit)))throw Error('请核对每包装的件数');
  const nutrition=Object.fromEntries(NUTRIENTS.map(k=>[k,numeric(fields[k])]));
  if(Object.values(nutrition).some(v=>v!==null&&v<0))throw Error('营养数值不能为负');
  const density=Object.hasOwn(fields,'densityGramsPerMl')?numeric(fields.densityGramsPerMl):previous?.densityGramsPerMl;
  if(density!=null&&density<=0)throw Error('请核对食品密度');
  const preservePrice=price===null&&previous?.priceBasis&&previous.priceBasis!==unit;
  const row={...previous,id:previous?.id||id||makeId('sku'),name:name.trim(),unit,basisUnit,basisAmount:quantity,stage,stockStage,
    packageSize,packageUnit:packageSize?fields.packageUnit:null,pack:packageSize?unit:null,piecesPerPack:pieces,
    ...(Object.hasOwn(fields,'packageKind')?{packageKind:fields.packageKind||null}:{}),
    densityGramsPerMl:density??null,nutritionBasis:'custom',standard:quantity+' '+basisUnit,qty:previous?previous.qty:0,
    pricePerUnit:preservePrice?previous.pricePerUnit:price,priceBasis:preservePrice?previous.priceBasis:unit,minimum,source,quality,nutrition,active:true};
  if(previous)Object.assign(previous,row);else local.push(row);
  return row;
}

export function addBatch(state,{id=makeId('batch'),foodId,date,time,quantity,costCents=null,expires=null,raw=null,cooked=null,reason='采购',parent=null,portion=false,estimated=false,packageSpec=null,receiptLine}) {
  quantity=numeric(quantity);
  if(!validDate(date) || !(quantity>0) || expires&&!validDate(expires) || !inventoryWithMoves(state).some(s=>s.id===foodId))
    throw Error('请检查批次数量、食品和日期');
  if(costCents!==null && (!Number.isSafeInteger(costCents)||costCents<0))throw Error('价格须精确到分');
  const batches=state.local.batches??=[];
  if(batches.some(b=>b.id===id))throw Error('此批次已入库');
  const batch={id,foodId,date,quantity,costCents,expires,raw,cooked,parent,...(packageSpec?{packageSpec}:{}),...(receiptLine!=null?{receiptLine}:{}),...(portion?{portion,...(estimated?{estimated}:{})}: {})};
  batches.push(batch);
  state.local.stockMoves.push({id:makeId('stock'),batchId:id,foodId,date,...(time?{time}:{}),delta:quantity,reason,createdAt:new Date().toISOString()});
  return batch;
}

export function portionSources(state,sku,date){
  if(!sku||!isOnHand(sku))return [];
  const batches=batchBalances(state,sku.id);
  const loose=round(sku.qty-batches.reduce((total,batch)=>total+batch.remaining,0),6);
  return [...(loose>0?[{id:'',remaining:loose}]:[]),...batches.filter(batch=>batch.remaining>0&&batch.date<=date)];
}

export function registerPortions(state,{foodId,batchId='',date,quantities,estimated=false,id=makeId('split')}){
  const sku=inventoryWithMoves(state).find(row=>row.id===foodId);
  const source=portionSources(state,sku,date).find(part=>part.id===batchId);
  const invalid=()=>Error('请核对各份数量与原库存余量');
  if(!source||!validDate(date)||!quantities.length||quantities.some(quantity=>!Number.isFinite(quantity)||quantity<0.000001))throw invalid();
  const portions=quantities.map(quantity=>round(quantity,6));
  const total=round(portions.reduce((sum,quantity)=>sum+quantity,0),6);
  if(total>source.remaining||total>sku.qty)throw invalid();
  const [{costCents}]=allocateStock(state,foodId,total,batchId,date);
  state.local.stockMoves.push({id,batchId:batchId||null,foodId,date,delta:-total,costCents,reason:'分装转出',createdAt:new Date().toISOString()});
  let cumulative=0,assigned=0;
  return portions.map((quantity,i)=>{
   cumulative+=quantity;
   const next=costCents===null?0:Math.round(cumulative/total*costCents);
   const batch=addBatch(state,{...source,id:id+'-'+i,foodId,date,quantity,parent:batchId||null,portion:true,estimated,
    costCents:costCents===null?null:next-assigned,reason:'分装转入'});
   assigned=next;
   return batch;
  });
}

// Equal portions use the same bookkeeping as individually weighed portions.
export function splitBatch(state,{batchId,date,quantity,count}) {
  const batch=(state.local.batches??[]).find(b=>b.id===batchId);
  const part=numeric(quantity), parts=numeric(count);
  if(!batch || !(part>0)||!Number.isInteger(parts)||parts<1||parts>100)
    throw Error('请检查分装数量和原批次余量（一次最多 100 份）');
  return registerPortions(state,{foodId:batch.foodId,batchId,date,quantities:Array(parts).fill(part)});
}

export function stockAlerts(state,today) {
  const low=inventoryWithMoves(state).filter(s=>s.active&&!isStockReference(s)&&s.minimum!=null&&s.qty!==null&&s.qty<=s.minimum);
  const expiry=batchBalances(state).filter(b=>b.remaining>0 && b.expires &&
    new Date(b.expires+'T00:00:00Z')-new Date(today+'T00:00:00Z')<=3*86400000);
  return {low,expiry};
}
