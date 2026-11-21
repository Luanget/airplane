import {matches,groupedMealSchema,healthSteps,HEALTH_STEP_LIMIT} from '../health/contract.mjs';
import {NUTRIENTS,round} from '../health/core.mjs';

const clean=text=>String(text).normalize('NFKC').toLowerCase().replace(/[\s，。、,.()（）]/g,'');
const rank={measured:3,label:2,estimated:1};
const scalar=value=>Number.isFinite(value);
const samePortion=(a,b)=>a.unit===b.unit&&a.amount===b.amount;
const labels={measured:'实称',label:'包装标签',estimated:'照片估算'};
const take=(rows,role)=>rows.filter(row=>row.role===role).sort((a,b)=>rank[b.confidence]-rank[a.confidence])[0];

export function groupMealPhotos(result,text,count){
 if(!matches(groupedMealSchema,result)||!Number.isSafeInteger(count)||count<1)throw Error('多图识别的结构无效，账本未更改。');
 const byDish=new Map(),nameKeys=new Map();
 const sameMealRefill=/续粉|加粉/.test(text);
 const withoutRefill=value=>clean(value).replace(/续粉|加粉|额外一份|加份|加量/g,'');
 const labelsByName=new Map(result.observations.filter(row=>row.role==='label'&&row.nutrition)
  .map(row=>[withoutRefill(row.name),row]));
 for(const observation of result.observations){
  if(observation.images.some(i=>!Number.isInteger(i)||i>count))throw Error('照片编号与实际附件不符。');
  const key=clean(observation.dishKey),name=clean(observation.name);
  const existing=nameKeys.get(name);
  if(existing&&existing!==key&&observation.role!=='extra'){
   const previous=byDish.get(existing);
   previous.push(observation);continue;
  }
  const rows=byDish.get(key)??[];
  rows.push(observation);
  byDish.set(key,rows);nameKeys.set(name,key);
 }
 const evidence=text.trim()||'同餐照片预览';
 const steps=[],photoSteps={},notes=[];
 const actual=/已经(?:吃|喝)|吃了|喝了|实吃|吃完|喝完|实报|实际|记(?:录|账|入账)|就记|保存/.test(text)&&
  !/不要(?:记录|写入|保存)|先(?:预览|看看)|只(?:看看|识别)|假如|如果我/.test(text);
 let requireReview=false,usedStatedLabel=false;
 const quantities=[...text.normalize('NFKC').matchAll(/(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)(?![a-z])/gi)];
 const statedLabelPortion=actual&&byDish.size===1&&quantities.length===1&&
  /吃完|喝完|吃了|喝了|已经吃|已经喝/.test(text)&&!/剩|没吃|没喝|还没|一半|估计|大概/.test(text)?quantities[0]:null;
 for(const [dish,rows] of byDish){
  const extra=take(rows,'extra'),leftover=take(rows,'leftover');
  const weight=take(rows,'weight'),label=take(rows,'label');
  let served=take(rows,'served');
  if(!served&&!extra&&!leftover&&statedLabelPortion&&label?.nutrition&&clean(label.name).length>=2&&clean(text).includes(clean(label.name))){
   const unit=/^ml$|毫升/i.test(statedLabelPortion[2])?'mL':'g';
   if(label.basisUnit===unit&&Number(statedLabelPortion[1])>0){
    served={...label,amount:Number(statedLabelPortion[1]),unit,confidence:'label'};
    usedStatedLabel=true;
   }
  }
  if(!served&&!extra)continue;
  const extras=rows.filter(row=>row.role==='extra');
  const additions=extra&&/续粉|加粉|续(?:了|一|两|份)|又加|额外|再来一份|加了一份/.test(text)?[extra]:[];
  if(extras.length>additions.length){
   notes.push('续份需有清楚依据，已隔开存疑的续份证据。');
   requireReview ||= !additions.length;
  }
  const primary=served?(weight&&weight.confidence==='measured'&&weight.amount>0&&weight.unit?{...served,
   amount:weight.amount,unit:weight.unit,confidence:'measured'}:served):null;
  for(const [part,view] of [...(primary?[['served',primary]]:[]),...additions.map(row=>['extra',row])]){
   const consumed=part==='served'&&leftover;
   let quantity=view.amount;
   if(consumed){
    const ambiguous=rows.filter(row=>row.role==='leftover').some(row=>!samePortion(row,leftover));
    if(ambiguous||leftover.unit!==view.unit||!scalar(leftover.amount)||!scalar(quantity)||leftover.amount>quantity){
     notes.push(view.name+'的余量尚不明确，暂未纳入。');
     requireReview=true;continue;
    }
    quantity=round(quantity-leftover.amount,3);
   }
   if(!scalar(quantity)||quantity<0||!view.unit){
    notes.push(view.name+'没有可用份量。');requireReview=true;continue;
   }
   if(quantity===0)continue;
   const basis=label?.nutrition?label:sameMealRefill?
    labelsByName.get(withoutRefill(view.name))??view:view;
   const nutrition=basis.nutrition&&basis.basisUnit===view.unit&&basis.basisAmount>0?
    Object.fromEntries(NUTRIENTS.map(key=>[key,basis.nutrition[key]===null?null:round(basis.nutrition[key]*quantity/basis.basisAmount,2)])):null;
   const photos=[...new Set(rows.flatMap(row=>row.images))].sort((a,b)=>a-b);
   const uncertainty=[...(part==='extra'?['续份独立计入']:[]),labels[view.confidence],
    '依据第 '+photos.join('、')+' 张照片',view.uncertainty,
    ...(consumed?['已扣除余量 '+leftover.amount+' '+leftover.unit]:[])].filter(Boolean).join('；');
   const step={kind:'eat',evidence,name:view.name,skuId:null,containerId:null,date:result.date,meal:result.meal??(/早餐|早饭/.test(text)?'早餐':/中午|午餐|午饭/.test(text)?'午餐':
    /晚餐|晚饭|晚上/.test(text)?'晚餐':null),time:null,
    source:'one_off',amount:quantity,unit:view.unit,whole:'no',nutrition};
   if(!matches(healthSteps.eat,step))throw Error('有照片估算的字段超出可记录范围。');
   photoSteps[steps.length]={dish,part,images:photos,confidence:view.confidence,uncertainty};
   steps.push(step);
  }
 }
 // The same food recognised in photos and transcribed in the text can only write once.
 for(const step of result.steps){
  if(step.kind==='eat'&&steps.some(row=>clean(row.name)===clean(step.name)))continue;
  steps.push(step);
 }
 if(steps.length>HEALTH_STEP_LIMIT)throw Error('同餐有多项记录，请分组处理以便核对。');
 return {plan:{intent:actual&&(result.intent==='execute'||usedStatedLabel)?'execute':'preview',steps},
  photoSteps,review:requireReview,notes};
}
