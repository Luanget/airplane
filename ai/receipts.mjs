import {normalizeClock} from '../calendar.mjs';
import {freshData,readFinance} from '../finance-storage.mjs';
import {matches,orderReceiptSchema} from '../health/contract.mjs';
import {inventoryWithMoves,isStockReference,round,validDate} from '../health/core.mjs';
import {quantityInUnit} from '../health/candidates.mjs';
import {saveSku} from '../health/inventory.mjs';
import {cents,recordPurchase,revisePurchase} from '../health/purchases.mjs';
import {resumeReceiptUpdate,updateReceiptLedgers} from '../health/purchase-sync.mjs';
import {hash,same,stable} from '../health/sync-source.mjs';
import {chooseFinanceCategory,financeEntry} from './finance.mjs';

const key=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const money=value=>'¥'+(value/100).toFixed(2);
const notPaid=/待付款|未付款|购物车|待支付|支付失败|待结算|未支付|付款中|\bunpaid\b|\bpayment pending\b|\bshopping cart\b|\bnot paid\b/i;
const success=/支付成功|已支付|已付款|付款成功|交易成功|\bpaid\b|\bpayment successful\b/i;
const refundPending=/退款中|退款审核|退款申请|正在退款/;
const refunded=/退款成功|已退款|退款完成|退回原账户|\brefunded\b/i;
const household=/清洁剂|洗衣液|护肤|湿厕纸|数据线|充电线|收纳|拖把|牙线|毛巾|洗衣球|洗衣粉|洗洁精|纸巾|湿巾|卫生纸|卫生巾|洗发|沐浴露|垃圾袋|牙刷|牙膏|宠物|猫粮|狗粮|餐具|保鲜袋|抹布|充电器|手机壳/;
const safeOrder=value=>{
 const clean=String(value??'').normalize('NFKC').trim().replace(/\s+/g,'').toLowerCase();
 return /^[a-z0-9][a-z0-9_-]{3,119}$/.test(clean)&&!/[x*]{3}/i.test(clean)?clean:null;
};
const receiptWindow=30*60*1000;
const repeatedPurchase=text=>/又买|再买|另外(?:一笔|一单)|新(?:订单|下单)|第二次|第[二三四五六七八九十]笔|另[付购]|不同.{0,5}订单/.test(text??'');
const fingerprint=lines=>hash(stable(lines.map(line=>[
 productName(line.name)||key(line.name),line.quantity,key(line.unit),line.packAmount??null,key(line.packUnit)
]).map(stable).sort()));
const rowsFor=(state,receiptKey)=>state.local.agentReceipts?.find(row=>row.id===receiptKey);
const blocked=reason=>({state:'blocked',reason});
const preview=(reason,text)=>({state:'review',reason,detail:text});
const skuNames=sku=>[sku.name,...(sku.aliases??[])].map(key).filter(Boolean);
const productName=value=>key(value.normalize('NFKC').replace(/['"（( ]*\d+(?:\.\d+)?\s*(?:公斤|毫升|千克|kg|ml|g|克|升|l)(?:\s*[x×*]\s*\d+\s*[袋盒瓶包]?)?[）)]?$/i,''));

function amountQuoted(evidence,amount){
 if(!evidence)return false;
 const text=evidence.normalize('NFKC').replace(/(?<=\d)[,，](?=\d{3}(?!\d))/g,'');
 const numbers=text.match(/\d+(?:\.\d+)?/g)??[];
 return numbers.some(value=>Number(value)===amount);
}

function skuMatch(state,line){
 const t=key(line.name),all=inventoryWithMoves(state).filter(row=>!isStockReference(row));
 const product=productName(line.name);
 const exact=all.filter(row=>skuNames(row).includes(t)||product.length>=3&&
  [row.name,...(row.aliases??[])].some(name=>productName(name)===product));
 const similar=all.filter(row=>skuNames(row).some(name=>t.length>=3&&(t.includes(name)||name.includes(t))));
 const active=(exact.length?exact:similar).filter(row=>row.active);
 if(line.skuId){
  const match=active.find(row=>row.id===line.skuId);
  if(active.length!==1||!match)throw Error('「'+line.name+'」与现有 SKU 无法唯一匹配。');
  return match;
 }
 if(active.length>1)throw Error('「'+line.name+'」匹配多个食品，请说明具体 SKU。');
 if(!active.length&&exact.length)throw Error('「'+line.name+'」的同名 SKU 已停用，请先核对。');
 return active[0]??null;
}
function quantityOf(sku,line){
 const pack=!!line.packAmount&&!!line.packUnit&&!['g','mL'].includes(line.unit);
 if(pack&&['g','mL'].includes(sku.unit)){
  // The purchased lot can have a different package weight from older lots.
  return quantityInUnit(sku,line.quantity*line.packAmount,line.packUnit,sku.unit);
 }
 return quantityInUnit(sku,line.quantity,line.unit,sku.unit);
}
function allocation(receipt,paid){
 const {lines}=receipt;
 const known=lines.map(row=>row.net!==null?cents(row.net):null);
 const discount=receipt.discount===null?null:cents(receipt.discount);
 const shipping=receipt.shipping===null?null:cents(receipt.shipping);
 const gross=lines.length&&lines.every(row=>row.gross!==null)?lines.reduce((n,row)=>n+cents(row.gross),0):null;
 const sum=values=>values.reduce((n,row)=>n+(row??0),0);
 if(known.some((value,i)=>value!==null&&lines[i].gross!==null&&value>cents(lines[i].gross)))
  throw Error('商品实付金额高于原价，需核对明细。');
 if(gross!==null&&discount!==null&&shipping!==null&&gross-discount+shipping!==paid)
  throw Error('商品小计、优惠、运费与实付金额对不上。');
 if(discount===0&&shipping!==null&&gross!==null&&gross+shipping===paid){
  for(let i=0;i<lines.length;i++){
   const stated=cents(lines[i].gross);
   if(known[i]!==null&&known[i]!==stated)throw Error('商品金额与无优惠订单的实付明细冲突。');
   known[i]=stated;
  }
 }
 const left=paid-sum(known)-(shipping??0);
 if(left<0)throw Error('可核实的分类金额和运费超过实付。');
 if(lines.length&&known.every(value=>value!==null)&&shipping!==null&&left!==0)
  throw Error('已识别的商品实付和运费加总不等于订单实付。');
 return {known,shipping,left,discount};
}

function verifyReceiptRecord(workspace,state,id){
 const record=rowsFor(state,id);
 if(!record)return null;
 const ledger=readFinance(workspace.finance).payload;
 if(record.cancelled)return {state:'skipped',text:'这张订单已经撤销，未重新写入。',receipt:{orderId:id,cancelled:true}};
 const txs=record.financeIds.map(id=>ledger?.transactions.find(row=>row.id===id));
 const total=txs.reduce((sum,row)=>sum+(row?cents(row.amount):0),0);
 if(txs.some(row=>!row||row.receiptKey!==record.id||row.type!==(record.refundOf?'income':'expense')||row.date!==record.date)||total!==record.total)
  throw Error('截图订单与财务回执不一致，请先核对两个账本。');
 const purchase=record.purchaseId&&state.local.purchases?.find(row=>row.id===record.purchaseId);
 if(record.purchaseId&&(!purchase||purchase.status==='cancelled'||!same(purchase.financeIds,record.financeIds)))
  throw Error('截图订单的库存回执缺失，请核对待同步状态。');
 const products=new Map(purchase?inventoryWithMoves(state).map(row=>[row.id,row]):[]);
 const lines=txs.map(row=>row.categoryName+' '+money(cents(row.amount))+(row.receiptUnallocated?'（未分摊）':''));
 return {state:'done',text:(record.refundOf?'已登记退款 ':'已记支出 ')+money(total)+' · '+record.merchant,
  detail:[...lines,...(purchase?purchase.items.map(row=>{
   const sku=products.get(row.foodId);
   return '入库 '+(sku?.name??row.foodId)+' '+row.quantity+' '+(sku?.unit??'')+
    (row.costCents===null?' · 成本未知':' · 成本 '+money(row.costCents));
  }):[]),...(record.discount!=null?['优惠 '+money(record.discount)]:[]),...(record.shipping!=null?['运费 '+money(record.shipping)]:[]),
  ...(record.refundOf?['退款保留原采购，实物退回需另行核对。']:[])].join('\n'),receipt:{orderId:id,transactionIds:record.financeIds,purchaseId:record.purchaseId,revision:state.revision??0,source:'receipt'},undo:{kind:'receipt',id}};
}

export async function executeReceipt(workspace,receipt,options){
 const {id:operation,today,clock,mediaKey='',grant,confirmed=false,guard}=options;
 if(!matches(orderReceiptSchema,receipt))return blocked('截图订单候选格式无效。');
 const attachmentKeys=options.attachmentKeys??[mediaKey].filter(Boolean);
 const evidenceKeys=[...new Set(receipt.images.map(index=>attachmentKeys[index-1]))];
 if(!evidenceKeys.length||evidenceKeys.includes(undefined))return blocked('截图采购需要可以定位的本轮附件作为凭据。');
 // An existing journal can be resumed without requiring a second model call.
 await (workspace.resumeReceipt??resumeReceiptUpdate)(workspace.account,operation);
 const state=await workspace.readHealth(),finance=readFinance(workspace.finance),ledger=finance.payload??freshData();
 const orderNo=safeOrder(receipt.orderNo);
 const merchant=receipt.merchant?.trim();
 const status=receipt.state;
 if(status==='unpaid'&&notPaid.test(receipt.paymentEvidence??''))
  return {state:'skipped',reason:'截图仍是未付款订单或购物车，未记账。'};
 if(!merchant||!validDate(receipt.date)||receipt.date>today||receipt.currency!=='CNY')
  return blocked('请核对截图中的商家、人民币币种和付款或退款日期。');
 const refund=['refunded','partial_refund'].includes(status);
 const amount=refund?receipt.refund:receipt.paid;
 if(!['paid','refunded','partial_refund'].includes(status)||
   !receipt.paymentEvidence||notPaid.test(receipt.paymentEvidence)||refundPending.test(receipt.paymentEvidence)||
   !(refund?refunded:success).test(receipt.paymentEvidence))
  return blocked('付款或退款状态无法核对，请补充支付成功或退款完成的记录。');
 if(!(amount>0)||!amountQuoted(receipt.totalEvidence,amount))
  return blocked('请核对截图上的实付或实退金额。');
 const total=cents(amount);
 const rows=state.local.agentReceipts??[];
 const signature=fingerprint(receipt.lines);
 const retry=rows.find(row=>row.operation===operation);
 if(retry){
  if((retry.orderNo??null)!==orderNo)return blocked('同次操作的订单号不一致，请核对原始截图。');
  if(retry.merchantKey!==key(merchant)||retry.date!==receipt.date||retry.total!==total||!!retry.refundOf!==refund||retry.signature!==signature)
   return blocked('同次操作的商品或付款信息不一致，请核对原始截图。');
  return verifyReceiptRecord(workspace,state,retry.id);
 }
 const merchantKey=key(merchant);
 const recent=row=>Number.isFinite(row.recordedAt)&&Date.now()-row.recordedAt<=receiptWindow;
 const sameProof=row=>(row.evidenceKeys??[]).some(item=>evidenceKeys.includes(item))||
  row.mediaKey===mediaKey&&attachmentKeys.length===1;
 const sameProducts=row=>(row.signature??fingerprint(row.lines??[]))===signature;
 const repeat=repeatedPurchase(options.text);
 const refundNo=safeOrder(receipt.refundNo);
 const originalMatches=refund&&!orderNo&&receipt.lines.length?rows.filter(row=>!row.cancelled&&!row.refundOf&&
  row.merchantKey===merchantKey&&row.date<=receipt.date&&row.total>=total&&sameProducts(row)):[];
 const originalKey=orderNo?'receipt-'+hash(stable(['order',orderNo])):originalMatches.length===1?originalMatches[0].id:null;
 if(refund&&!originalKey)return blocked('未找到唯一匹配的已付款原订单，需核对退款归属。');
 const id=refund?'refund-'+hash(stable([originalKey,refundNo??operation])):
  orderNo?originalKey:'receipt-'+hash(stable(['operation',operation,merchantKey,receipt.date,total,signature]));
 const old=rowsFor(state,id);
 if(old){
  if(old.merchantKey!==merchantKey||old.total!==total||old.date!==receipt.date)
   return blocked('同一订单号的商家、金额或日期与原账不一致，需核对原单。');
  const verified=verifyReceiptRecord(workspace,state,id);
  return {...verified,text:old.cancelled?verified.text:verified.text+' · 已有记录，未重复写入'};
 }
 const duplicate=rows.find(row=>!!row.refundOf===refund&&(!row.cancelled||sameProof(row))&&
  row.merchantKey===merchantKey&&row.date===receipt.date&&row.total===total&&
  (refund?row.refundOf===originalKey&&(!refundNo||!row.refundNo)&&(sameProof(row)||recent(row)):
   (!orderNo||!row.orderNo)&&sameProducts(row)&&(sameProof(row)||recent(row))));
 if(duplicate&&!(!refund&&repeat&&!orderNo)){
  const verified=verifyReceiptRecord(workspace,state,duplicate.id);
  return {...verified,text:verified.text+' · 疑似重复，未再次写入'};
 }
 const conflictingPhoto=rows.some(row=>!!row.refundOf===refund&&!row.cancelled&&sameProof(row)&&
  (row.merchantKey!==merchantKey||row.total!==total||orderNo&&row.orderNo&&row.orderNo!==orderNo||!sameProducts(row)));
 if(conflictingPhoto)return blocked('相同截图的付款信息与原账冲突，请核对。');
 if(ledger.transactions.some(row=>row.receiptKey===id||row.id.startsWith(id+':')))
  return blocked('财务已有对应截图条目，库存回执未关联。请核对原账。');

 const eligible=!refund?ledger.transactions.filter(row=>row.type==='expense'&&row.date===receipt.date&&
  !row.receiptKey&&cents(Number(row.amount))===total&&key(row.note).includes(key(merchant))):[];
 if(!repeat&&eligible.length)return blocked('财务中已有同商家同日同金额的支出，请核对后关联，未创建重复支出。');

 let units,groups,allocationResult;
 const next=structuredClone(state);
 if(refund){
  const original=rowsFor(state,originalKey);
  if(!original||original.cancelled||original.refundOf||original.merchantKey!==key(merchant)||receipt.date<original.date)
   return blocked('未找到匹配的已付款原订单，需先核对退款归属。');
  verifyReceiptRecord(workspace,state,originalKey);
  const refunds=(state.local.agentReceipts??[]).filter(row=>row.refundOf===originalKey&&!row.cancelled);
  for(const entry of refunds)verifyReceiptRecord(workspace,state,entry.id);
  if(refunds.reduce((sum,row)=>sum+row.total,0)+total>original.total)
   return blocked('累计退款超过原订单实付，请核对。');
  const category=chooseFinanceCategory(ledger,{type:'income',merchant,kind:'refund'});
  if(!category)return blocked('请启用或选择退款收入分类。');
  groups=[{category,sum:total,kind:'refund',names:[]}];units=[];
 }else{
  try{allocationResult=allocation(receipt,total);}catch(err){return blocked(err.message);}
  if(!confirmed&&!receipt.lines.length&&!orderNo)return preview('商品明细不可见。确认后可按实付只记财务。',money(total));
  const kinds=receipt.lines.map(line=>household.test(line.name)?'nonfood':line.kind);
  if(kinds.includes('unknown'))return blocked('有商品无法确认是食品或日用品，请核对后再保存。');
  units=[];
  let unknownSku=false;
  const mapped=new Map();
  for(const [index,line] of receipt.lines.entries()){
   if(kinds[index]!=='food')continue;
   if(!(line.quantity>0)||!line.unit)return blocked('食品「'+line.name+'」缺少可入库的数量与单位。');
   let sku;
   try{sku=skuMatch(next,line);}catch(err){return blocked(err.message);}
   if(!sku){
    if(!confirmed&&(!line.specification||(!line.packAmount&&!['g','mL'].includes(line.unit)))){
     unknownSku=true;
     continue;
    }
    const newId='sku-receipt-'+hash(key(line.name)+':'+line.unit);
    sku=saveSku(next,{id:newId,name:line.name,unit:line.unit,basisUnit:line.unit,basisAmount:1,
     packageSize:line.packAmount,packageUnit:line.packUnit,quality:'unknown',source:'核对采购截图规格'});
   }
   const quantity=quantityOf(sku,line);
   if(!(quantity>0))return blocked('「'+line.name+'」的截图规格与库存单位无法可靠换算。');
   units.push({foodId:sku.id,quantity:round(quantity,6),costCents:allocationResult.known[index],expires:null,
    batchId:id+':lot:'+index,receiptLine:index,specification:line.specification,
    ...(line.packAmount&&line.packUnit&&!['g','mL'].includes(line.unit)?{packageSpec:{size:line.packAmount,unit:line.packUnit,kind:line.unit}}:{})});
   mapped.set(index,sku.id);
  }
  if(unknownSku&&!confirmed)
   return preview('有食品尚无匹配 SKU，核对商品规格后可建档，营养待补。',
    receipt.lines.filter((line,i)=>kinds[i]==='food'&&!mapped.has(i)).map(line=>line.name+' '+line.quantity+' '+line.unit).join('\n'));
  const byCategory=new Map();
  const add=(category,sum,kind,name,unallocated=false)=>{
   if(!sum)return;
   const stamp=category.id+':'+(unallocated?'unknown':kind);
   const row=byCategory.get(stamp)??{category,sum:0,kind,names:[],unallocated};
   row.sum+=sum;if(name)row.names.push(name);byCategory.set(stamp,row);
  };
  const categoryFor=(line,index)=>chooseFinanceCategory(ledger,{type:'expense',hint:line.category??'',merchant,name:line.name,kind:kinds[index]});
  const categoryRows=receipt.lines.map(categoryFor);
  for(const [i,line] of receipt.lines.entries()){
   const net=allocationResult.known[i],cat=categoryRows[i];
   if(net>0&&!cat)return blocked('找不到「'+line.name+'」对应的已启用支出分类。');
   if(net>0)add(cat,net,kinds[i],line.name);
  }
  const fallback=chooseFinanceCategory(ledger,{type:'expense',kind:'unallocated'});
  const shipping=allocationResult.shipping??0;
  if(shipping>0){
   const cat=chooseFinanceCategory(ledger,{type:'expense',kind:'shipping'})??fallback;
   if(!cat)return blocked('需要一个可用的运费或待分类支出分类。');
   add(cat,shipping,'shipping','运费');
  }
  if(allocationResult.left){
   const unanimous=categoryRows.length&&categoryRows[0]&&categoryRows.every(row=>row?.id===categoryRows[0].id);
   const cat=unanimous?categoryRows[0]:fallback;
   if(!cat)return blocked('金额未分摊，请启用可用的待分类支出分类。');
   add(cat,allocationResult.left,unanimous&&new Set(kinds).size===1?kinds[0]:'unallocated',null,true);
  }
  groups=[...byCategory.values()];
 }
 if(!groups.length||groups.reduce((sum,row)=>sum+row.sum,0)!==total)
  return blocked('分类之和与订单实付或实退不一致。');

 const detail=groups.map(row=>row.category.name+' '+money(row.sum)+(row.unallocated?'（未分摊）':'')).join('\n');
 if(!confirmed&&/只(?:识别|看看|预览)|先(?:识别|预览|别记)|(?:不要|别)(?:记账|记录|入库|保存)/.test(options.text??''))
  return preview('已按本轮要求预览。',detail);
 if(!confirmed&&(!grant?.enabled||total>grant.limitCents))
  return preview(!grant?.enabled?'日常财务自动执行未开启。':'订单超过日常财务单笔上限。',detail);
 if(!confirmed&&units.length&&!options.healthAuto)
  return preview('本单含食品，自动入库还需要健康授权。',detail);

 const start=normalizeClock(clock);
 const entries=groups.map((row,i)=>financeEntry({id:id+':'+i,type:refund?'income':'expense',date:receipt.date,time:start,
  amount:row.sum/100,category:row.category,note:(merchant+' · '+(row.names.join('、')||'实付未分摊')).slice(0,200),
  budgetSync:refund?false:undefined,receiptKey:id,receiptMerchant:merchant,receiptKind:row.kind,
  receiptProducts:row.names,receiptUnallocated:!!row.unallocated,createdAt:new Date().toISOString()}));
 const purchaseId=units.length?id+':purchase':null,financeIds=entries.map(row=>row.id);
 if(purchaseId)recordPurchase(next,{id:purchaseId,date:receipt.date,time:start,items:units,
  totalCents:units.reduce((sum,row)=>sum+(row.costCents??0),0),note:merchant+' · 截图采购',receiptId:id,financeIds},entries);
 const record={id,merchant,merchantKey:key(merchant),orderNo,refundNo,signature,operation,recordedAt:Date.now(),date:receipt.date,total,financeIds,purchaseId,
  refundOf:refund?originalKey:null,discount:allocationResult?.discount??null,shipping:allocationResult?.shipping??null,mediaKey,evidenceKeys,
  lines:receipt.lines.map((line,i)=>({...line,kind:!refund&&household.test(line.name)?'nonfood':line.kind,
   net:allocationResult?.known[i]==null?null:allocationResult.known[i]/100}))};
 (next.local.agentReceipts??=[]).push(record);
 await (workspace.updateReceipt??updateReceiptLedgers)(workspace.account,next,state.revision??0,finance.primary,
  {id,operation,pairs:entries.map(entry=>({id:entry.id,before:null,after:entry}))},()=>guard?.({total,health:units.length>0}));
 return verifyReceiptRecord(workspace,await workspace.readHealth(),id)??blocked('尚未验证两个账本的保存回执。');
}

export async function undoReceipt(workspace,id){
 const operation='undo:'+id;
 await (workspace.resumeReceipt??resumeReceiptUpdate)(workspace.account,operation);
 const state=await workspace.readHealth(),finance=readFinance(workspace.finance);
 const record=rowsFor(state,id);
 if(!record||record.cancelled)return '这张截图订单已撤销。';
 if(state.local.agentReceipts.some(row=>row.refundOf===id&&!row.cancelled))
  throw Error('该订单已有退款关联，请先核对退款。');
 verifyReceiptRecord(workspace,state,id);
 const next=record.purchaseId?revisePurchase(state,record.purchaseId,null,{receiptUndo:true}).next:structuredClone(state);
 rowsFor(next,id).cancelled=true;
 const pairs=record.financeIds.map(id=>({id,before:finance.payload.transactions.find(row=>row.id===id),after:null}));
 await (workspace.updateReceipt??updateReceiptLedgers)(workspace.account,next,state.revision??0,finance.primary,{id,operation,pairs});
 const saved=await workspace.readHealth();
 if(!rowsFor(saved,id)?.cancelled||readFinance(workspace.finance).payload?.transactions.some(row=>record.financeIds.includes(row.id)))
  throw Error('撤销回执仍待核对。');
 return '已撤销整张截图订单的关联收支'+(record.purchaseId?'和未消耗的入库批次':'')+'。';
}
