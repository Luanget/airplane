import {inventoryWithMoves,round} from '../health/core.mjs';
import {quantityInUnit} from '../health/candidates.mjs';
import {packagesFor} from '../health/containers.mjs';

const clean=value=>String(value??'').normalize('NFKC').replace(/\s/g,'');
export const currentSources=run=>run.userSources??(run.messages??[]).filter(Boolean).map((text,index)=>({id:run.id+':message:'+index,text,current:true}));

export function resolveEvidence(run,refs=[],quote=''){
 const turns=currentSources(run),fragment=clean(quote);
 const quoted=fragment?turns.filter(turn=>clean(turn.text).includes(fragment)).at(-1):null;
 const requested=[...refs];
 if(quoted&&!requested.some(row=>row.kind==='message'&&row.id===quoted.id))requested.push({kind:'message',id:quoted.id,note:null});
 const sources=[],texts=[];
 for(const {kind,id,note} of requested){
  if(kind==='message'){
   const turn=turns.find(row=>row.id===id);
   if(!turn)throw Error('消息依据 '+id+' 不可用。请先调用 read_conversation_evidence 核对本对话。');
   texts.push(quoted?.id===id?quote:turn.text);sources.push({kind,id});
  }else if(kind==='attachment'){
   if(!run.attachments.some(row=>row.id===id))throw Error('附件 '+id+' 尚未提供给模型。请先用 read_conversation_evidence 获取该附件。');
   sources.push({kind,id});
  }else if(kind==='estimate'){
   if(!note?.trim())throw Error('估算需要简短注明依据。');
   sources.push({kind,note:note.trim()});
  }else if(id)sources.push({kind,id});
 }
 if(!sources.some(row=>['message','attachment'].includes(row.kind)))
  throw Error('请提供来自本轮或相关前文的用户消息或附件 ID。库存数据和估算不能单独表示用户意图。');
 return {sources,texts};
}

const digits='零一二三四五六七八九';
function numberOf(value){
 if(/^\d/.test(value))return Number(value);
 const normalized=value.replaceAll('两','二');
 if(!normalized.includes('十'))return digits.indexOf(normalized);
 const [a,b]=normalized.split('十');
 return (a?digits.indexOf(a):1)*10+(b?digits.indexOf(b):0);
}
const units={克:'g',g:'g',公斤:'kg',千克:'kg',kg:'kg',斤:'斤',毫升:'mL',ml:'mL',升:'L',l:'L',分钟:'min',min:'min',小时:'h',
 公里:'km',km:'km',千卡:'kcal',大卡:'kcal',kcal:'kcal',块钱:'元',块:'元',元:'元'};
const scales={kg:['g',1000],斤:['g',500],L:['mL',1000],h:['min',60]};
const common=(amount,unit)=>scales[unit]?[amount*scales[unit][1],scales[unit][0]]:[amount,unit];
const measurePattern=/(?:(\d+(?:\.\d+)?|[零一二两三四五六七八九十]{1,3})\s*|(?=整))/giu;
const measurement=/^(?:整\s*(?=[盒袋瓶包份]))?(kcal|kg|km|ml|min|千克|公斤|毫升|分钟|小时|公里|千卡|大卡|块钱|块|元|克|斤|升|g|l|包|袋|盒|瓶|份|个)(?![a-z])/iu;
export function quantities(text){
 const normalized=text.normalize('NFKC');
 return Array.from(normalized.matchAll(measurePattern)).flatMap(match=>{
  const suffix=normalized.slice(match.index+match[0].length).match(measurement);
  if(!suffix)return [];
  const unit=units[suffix[1].toLowerCase()]??suffix[1];
  const [amount,canonical]=common(numberOf(match[1]??'1'),unit);
  return amount>=0?[{amount,unit:canonical}]:[];
 });
}

export function amountSupported(texts,amount,unit,sku){
 if(amount==null)return true;
 const [want,target]=common(Math.abs(amount),unit);
 return texts.some(text=>quantities(text).some(value=>{
  if(target===value.unit)return Math.abs(value.amount-want)<1e-6;
  const converted=quantityInUnit(sku,value.amount,value.unit,target);
  return converted!=null&&Math.abs(converted-want)<1e-6;
 }));
}

const fieldsFor={eat:[['amount','unit']],weigh:[['gross','g'],['initialGross','g'],['volumeMl','mL']],discard:[['tare','g']],
 weight:[['kg','kg']],activity:[['km','km'],['minutes','min'],['kcal','kcal']],correct:[['amount','unit'],['delta','unit'],['gross','g']],
 correct_weight:[['kg','kg']],correct_activity:[['km','km'],['minutes','min'],['kcal','kcal']]};

export function verifyNativeStep(state,step,resolved,matchedSku){
 const {sources,texts}=resolved;
 const catalog=inventoryWithMoves(state);
 const sku=matchedSku??catalog.find(row=>row.id===step.skuId||!step.skuId&&clean(row.name)===clean(step.name));
 const container=step.containerId&&sku&&packagesFor(state,sku.id).find(row=>row.id===step.containerId);
 const photo=sources.some(row=>row.kind==='attachment');
 const estimated=sources.some(row=>row.kind==='estimate');
 const declaredUnit=fields=>fields==='unit'?step.unit:fields;
 for(const row of sources){
  if(['sku','label'].includes(row.kind)&&!catalog.some(s=>s.id===row.id))throw Error('食品或标签 '+row.id+' 已不可用，请先查询 SKU。');
  if(row.kind==='package'&&(!container||container.id!==row.id))throw Error('包装依据与当前食品不一致，请重新查询包装。');
 }
 const values=(fieldsFor[step.kind]??[]).map(([field,unit])=>[field,step[field],declaredUnit(unit)]);
 if(step.kind==='split')for(const amount of step.weights)values.push(['weights',amount,sku?.unit??'g']);
 const unmatched=values.find(([field,amount,unit])=>amount!=null&&
  !amountSupported(texts,amount,unit,sku)&&
  !(field==='initialGross'&&container?.gross===amount)&&
  !(field==='amount'&&step.whole==='yes'&&container?.net!=null&&unit==='g'&&round(container.net,3)===amount&&
    sources.some(row=>row.kind==='package'&&row.id===container.id))&&
  !(photo&&(step.kind==='eat'||step.kind==='weigh'||step.kind==='split'))&&
  !(estimated&&step.kind==='eat'&&field==='amount'));
 if(unmatched)throw Error('缺少 '+unmatched[1]+' '+(unmatched[2]??'')+' 的可核对依据。请读取原消息、包装或照片；不确定份量可标记估算。');
 if(step.kind==='eat'&&step.whole==='no'&&step.unit==='g'&&texts.some(value=>{
  const reading=value.normalize('NFKC').match(/(?:毛重|复称|现在|还剩)\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)\s*(?:g|克)/i);
  return reading&&Number(reading[1])===step.amount;
 }))throw Error('这个数是当前毛重。请查询同一包装，执行 weigh；程序会计算前后差值。');
}
