import {displayDay,normalizeClock} from '../calendar.mjs';
import {HEALTH_STEP_LIMIT,healthActionSchema,matches} from '../health/contract.mjs';
import {actualFood,addDays,addFood,allocateStock,cycleForDate,dayIntake,events,inventoryWithMoves,isStockReference,
 recordEvent,round,setDayCompleteness,suggestNutritionByInventory,validDate} from '../health/core.mjs';
import {confirmPackageAction,ensureContainers,packagesFor,revisePackageFood,revisePackageIntake,selectPackage} from '../health/containers.mjs';
import {managedFoodPackage,onShelf} from '../health/container-ledger.mjs';
import {basis,quantityInUnit} from '../health/candidates.mjs';
import {recordedPortion,reviseFoodPortion} from '../health/food-history.mjs';
import {portionSources,registerPortions} from '../health/inventory.mjs';
import {activityPolicy,duplicateActivity} from '../health/agent-rules.mjs';
import {assertSkillAction} from './skills.mjs';
import {healthReport,inventoryDiff,renderHealthReport,renderInventoryDiff} from './health-report.mjs';
import {same} from '../health/sync-source.mjs';

const ACCESS='airplane-ai-health-auto-v1';
export const hasHealthAuto=store=>store.getItem(ACCESS)==='yes';
export function setHealthAuto(store,value){if(value)store.setItem(ACCESS,'yes');else store.removeItem(ACCESS);}
export const READ_LIMIT=6;
const HISTORY_SIZE=24;
const REPLAY_WINDOW=5*60*1000;
const reads=new Set(['cycle','next_meal']);
const mealAt=time=>Number(time.slice(0,2))<10?'早餐':Number(time.slice(0,2))<15?'午餐':Number(time.slice(0,2))<17?'加餐':'晚餐';
const normal=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s，。！？、,.!?（）()]/g,'');
const key=value=>normal(value).replace(/牛肉辣椒酱/g,'牛肉酱').replace(/鸡胸肉/g,'鸡胸');
const names=sku=>[sku.name,...(sku.aliases??[])].map(key).filter(Boolean);
const home=state=>inventoryWithMoves(state).filter(row=>row.active&&!isStockReference(row));
const packageKinds=new Set(['瓶','盒','袋','包','份','个']);
const operationList=state=>state.local.assistantActions??[];

function skuFor(stock,step){
 if(step.skuId){
  const named=stock.find(row=>row.id===step.skuId);
  if(!named||!names(named).some(name=>name.includes(key(step.name))||key(step.name).includes(name)))
   throw Error('库存与食品名称对不上，请核对「'+step.name+'」。');
  return named;
 }
 const t=key(step.name);
 const exact=stock.filter(sku=>names(sku).includes(t));
 const options=exact.length?exact:stock.filter(sku=>names(sku).some(name=>name.includes(t)||t.includes(name)));
 const available=options.filter(row=>row.qty>0);
 if(options.length===1)return options[0];
 if(available.length===1)return available[0];
 if(options.length)throw Error('「'+step.name+'」对应多个食品，请说具体品名。');
 return null;
}

function viewPackages(state,stock,{query='',skuId=null,containerId=null,includeClosed='no'}={}){
 const t=key(query),lots=new Map((state.local.batches??[]).map(row=>[row.id,row]));
 return stock.filter(sku=>(!skuId||sku.id===skuId)&&(!t||names(sku).some(name=>name.includes(t)||t.includes(name)))).flatMap(sku=>{
  const items=packagesFor(state,sku.id).filter(row=>(includeClosed==='yes'||onShelf(row))&&(!containerId||row.id===containerId));
  if(containerId&&!items.length)return [];
  return [{
   sku:sku.id,name:sku.name,quantity:sku.qty,unit:sku.unit,
   packages:items.map(row=>({containerId:row.id,number:row.number,status:row.status,kind:row.kind,
    netGrams:row.net,estimated:row.estimated,latestGrossGrams:row.gross,consumedSinceWeighingGrams:row.unweighedGrams,
    nominal:row.nominal??null,batchId:row.batchId,batchDate:lots.get(row.batchId)?.date??null,
    batchCostCents:row.costCents??null,foodRecordIds:row.foodIds}))
  }];
 });
}
export const readPackages=(state,args)=>({revision:state.revision??0,stock:viewPackages(state,home(state),args)});

function plausible(text,sku){
 const raw=key(text);
 if(names(sku).some(name=>raw.includes(name)))return true;
 if(/牛肉酱/.test(raw)&&/牛肉酱/.test(key(sku.name)))return true;
 for(const term of ['牛奶','鸡胸','芹菜','荞麦面','辣椒酱','牛肉酱','酸奶','水饺','面包','方便面']){
  if(raw.includes(term)&&key(sku.name).includes(term))return true;
 }
 return /包面/.test(raw)&&/(?:面条|荞麦面|方便面|面饼|拉面)/.test(sku.name);
}
function hasWriteLanguage(text){
 return /吃|喝|毛重|剩.*(?:克|g)|现在.{0,18}(?:克|g)|记|称|克|丢|扔|分装|晨重|体重|跑|骑|走|运动|消耗|手表|更正|改|错|少算|多算|公斤|封账|全天|缺报|待补|kg/i.test(text);
}
function statedDate(text,today){
 if(/前天/.test(text))return addDays(today,-2);
 if(/昨天|昨日/.test(text))return addDays(today,-1);
 if(/今天|今日/.test(text))return today;
 const named=text.match(/(\d{4}-\d{2}-\d{2})|(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/);
 if(!named)return null;
 const padded=value=>String(value).padStart(2,'0');
 return named[1]??(named[2]??today.slice(0,4))+'-'+padded(named[3])+'-'+padded(named[4]);
}
export function healthContext(state,input,reference){
 const text=input.text,today=input.date;
 const correction=/昨天|前天|更正|改|少算|多算|纠正|错了|那条/.test(text);
 const ref=reference?.date;
 const date=statedDate(text,today)??(/那条|刚才|上次/.test(text)&&validDate(ref)?ref:today);
 const stock=home(state).filter(row=>plausible(text,row)||/这瓶|那瓶|这盒|那盒|刚才那份/.test(text)&&reference?.skuId===row.id);
 const history=correction?events(state,'foods').filter(row=>row.date===date&&actualFood(row)&&
  (stock.some(sku=>sku.id===row.foodId)||key(row.name).length&&key(text).includes(key(row.name))||
   /那条|刚才/.test(text)&&reference?.recordId===row.id))
  .map(row=>({id:row.id,date:row.date,meal:row.meal,name:row.name,portion:row.portion,foodId:row.foodId})):[];
 const bodyHistory=correction?['weights','activities'].flatMap(kind=>{
  const relevant=kind==='weights'?/晨重|体重/.test(text):/运动|骑|跑|走|游泳|训练/.test(text);
  return relevant?events(state,kind).filter(row=>row.date===date).map(({id,date,time,kg,name,minutes,kcal,km})=>
   ({kind,id,date,time,kg,name,minutes,kcal,km})):[];
 }):[];
 return {revision:state.revision??0,...(stock.length?{stock:viewPackages(state,stock)}:{}),...(history.length?{history}:{}),
  ...(bodyHistory.length?{bodyHistory}:{}),
  ...(reference&&(stock.some(sku=>sku.id===reference.skuId)||/这[瓶条盒份]|那[瓶条盒份]|刚才|上面/.test(text))?{reference}:{}),
  ...(correction?{referenceDate:date}:{})};
}

function dateFor(step,today,reference){
 const {evidence}=step;
 const explicit=statedDate(evidence,today);
 const date=explicit??step.date??(step.kind.startsWith('correct')?reference?.date:null)??today;
 if(!validDate(date)||date>today)throw Error('请提供今天或更早的有效记录日期。');
 return date;
}
function chooseContainer(state,sku,step,reference,{whole=false}={}){
 const shelf=packagesFor(state,sku.id).filter(onShelf);
 if(!shelf.length)throw Error('「'+sku.name+'」没有可用包装。');
 if(step.containerId&&reference?.containerId&&reference.skuId===sku.id&&
  /这瓶|那瓶|刚才那/.test(step.evidence)&&reference.containerId!==step.containerId)
  throw Error('包装和对话中指定的不是同一个，请确认是哪一瓶或盒。');
 const named=step.evidence.normalize('NFKC').match(/第?\s*([一二三四五六七八九十\d]+)\s*号\s*(?:瓶|份|盒|袋)|第\s*([一二三四五六七八九十\d]+)\s*(?:瓶|份|盒|袋)|\b([A-Z])\s*(?:瓶|盒|袋)|(?:瓶|盒|袋)\s*([A-Z])\b/i);
 const position=named&&(named[1]||named[2]?numberFromText(named[1]??named[2]):(named[3]??named[4]).toUpperCase().charCodeAt(0)-64);
 const physical=position&&shelf.find(row=>row.number===position);
 const byReference=reference?.skuId===sku.id&&shelf.find(row=>row.id===reference.containerId);
 const byId=step.containerId&&shelf.find(row=>row.id===step.containerId);
 if(step.containerId&&!byId)throw Error('指定包装已用尽或不在当前食品下。');
 if(position){
  if(!physical||byId&&byId.id!==physical.id)throw Error('这条指令和包装编号不一致，请核对。');
  return physical;
 }
 if(byReference&&(!byId||byReference.id===byId.id)&&(!whole||byReference.status==='sealed'))return byReference;
 const open=shelf.filter(row=>row.status==='open');
 if(!whole){
  if(open.length===1){if(byId&&byId.id!==open[0].id)throw Error('给出的包装和唯一已开包装不一致，请指明。');return open[0];}
  if(shelf.length===1)return shelf[0];
  // Weight can positively identify an individually weighed serving.
  const weighted=step.unit==='g'&&step.amount!=null?shelf.filter(row=>row.net!=null&&!row.estimated&&Math.abs(row.net-step.amount)<=.05):[];
  if(weighted.length===1)return weighted[0];
  throw Error('「'+sku.name+'」有多个可用包装，请说瓶号、盒号或实称重量。');
 }
 if(open.length&&!/新开|未开封|新的一盒|新的一瓶|新的一袋/.test(step.evidence)){
  if(open.length===1&&open[0].stockMode==='portion'&&open[0].net>0)return open[0];
  throw Error('「'+sku.name+'」有已开包装。请说明是新开一个，还是吃完已有包装的剩余量。');
 }
 const sealed=shelf.filter(row=>row.status==='sealed');
 if(!sealed.length)throw Error('没有未开封的「'+sku.name+'」。');
 if(sealed.some(row=>row.stockMode==='portion'||row.stockMode==='estimated')&&sealed.length>1){
  const weighed=sealed.filter(row=>row.net!=null&&!row.estimated);
  const matches=step.amount!=null&&step.unit==='g'?weighed.filter(row=>Math.abs(row.net-step.amount)<=.05):[];
  if(matches.length===1&&(!byId||matches[0].id===byId.id))return matches[0];
  const weights=weighed.map(row=>row.net);
  if(!weights.length||Math.max(...weights)-Math.min(...weights)>Math.max(5,Math.min(...weights)*.03))
   throw Error('各份「'+sku.name+'」重量不同，请说是哪一份或具体克数。');
 }
 const lots=new Map((state.local.batches??[]).map(row=>[row.id,row]));
 return sealed.sort((a,b)=>(lots.get(a.batchId)?.date??'').localeCompare(lots.get(b.batchId)?.date??'')||a.number-b.number)[0];
}

function savePackage(state,container,fields){
 return confirmPackageAction(state,{...fields,containerId:container.id,expectedHead:container.head});
}
function nutritionFor(sku,amount,unit){
 const label=quantityInUnit(sku,amount,unit,basis(sku)[1]);
 return label==null?{}:suggestNutritionByInventory(sku,label)??{};
}
const itemText=row=>row.name+' '+row.portion;
function recordEating(state,step,when,reference){
 const {date,meal,time,id}=when;
 const statedOff=when.fromPhoto||/外食|外卖|餐厅|食堂|餐馆|外面吃|店里买|现买|单买|路上买|一次性|不是库存/.test(step.evidence);
 const stock=home(state);
 const customary=when.habits?.buckwheatDefault&&/^(面|面条|一包面)$/.test(key(step.name))&&/一包面|1\s*包面/.test(step.evidence)?
  stock.filter(row=>row.qty>0&&/荞麦面/.test(row.name)):[];
 const matched=statedOff?null:customary.length===1&&!step.skuId?customary[0]:skuFor(stock,step);
 const oneOff=statedOff||!matched&&step.source==='one_off';
 const sku=oneOff?null:matched;
 if(!oneOff&&!sku)throw Error('没有找到库存里的「'+step.name+'」。如果是外食或本次单买，请补充来源。');
 const {amount,unit}=step,whole=step.whole==='yes';
 if(sku){
  if(!(sku.qty>0))throw Error('「'+sku.name+'」库存不足。');
  const shelf=packagesFor(state,sku.id).filter(onShelf);
  if(shelf.length){
   // A household serving in grams stays independent of nominal wrapper size.
   const allocation=whole&&packageKinds.has(unit)?amount??1:1;
   if(!Number.isInteger(allocation)||allocation<1||allocation>HEALTH_STEP_LIMIT)throw Error('请给出本次完整包装数。');
   if(allocation>1&&step.containerId)throw Error('需要分别指定多个包装，或按包装数量录入。');
   const items=[];
   for(let i=0;i<allocation;i++){
    const target=chooseContainer(state,sku,step,i===0?reference:null,{whole});
    const part=target.stockMode!=='whole';
    const grams=whole&&part?target.net:unit==='g'?amount:null;
    const result=whole&&!part?savePackage(state,target,{id:id+':'+i,action:'whole',date,meal,time}):
     !(grams>0)?null:savePackage(state,target,{id:id+':'+i,action:'net',grams,date,meal,time});
    if(!result?.event?.foodId)throw Error('请补充该包装实际吃的克数。');
    state=result.next;
    items.push({row:events(state,'foods').find(row=>row.id===result.event.foodId),containerId:target.id});
   }
   return {state,items};
  }
 }
 if(!(amount>0)||!unit)throw Error('请补充「'+step.name+'」的份量。');
 const stockQty=sku?quantityInUnit(sku,amount,unit,sku.unit):null;
 if(sku&&!(stockQty>0))throw Error('「'+sku.name+'」的库存单位无法可靠换算。');
 const row=addFood(state,{name:sku?.name??step.name,date,meal,time,amount,amountUnit:unit,portion:amount+' '+unit,
  foodId:sku?.id,stockQty,...(sku?nutritionFor(sku,amount,unit):step.nutrition??{}),
  quality:sku?'label':'estimated',uncertainty:sku?'':'本次外食或单买；未提供的营养记为未知'},undefined,'food:'+id);
 return {state,items:[{row,containerId:null}]};
}

function findOriginal(state,step,date,reference){
 const term=key(step.name);
 const candidates=events(state,'foods').filter(row=>row.date===date&&actualFood(row)&&
  (!step.meal||row.meal===step.meal)&&(!step.time||normalizeClock(row.time)===step.time)&&
  (key(row.name).includes(term)||term.includes(key(row.name))||step.name==='那条'&&row.id===reference?.recordId));
 if(step.recordId){
  const hit=candidates.find(row=>row.id===step.recordId);
  if(hit&&(candidates.length===1||step.meal||step.time||reference?.recordId===hit.id||/这[条笔]|那[条笔]/.test(step.evidence)))
   return hit;
 }
 if(candidates.length===1)return candidates[0];
 if(candidates.length>1)throw Error('找到多条原饮食，请说明餐次或时间。');
 throw Error('在 '+displayDay(date)+' 找不到要更正的原饮食。');
}

export function buildMealPlan(state,step,today,habits={},reserved=[]){
 const {totals}=dayIntake(state,today),target=state.settings.calorieTarget,meal=step.meal??'晚餐';
 const gap=totals.kcal==null?null:round(target-totals.kcal,1);
 const preferences=step.preferences.map(key).filter(Boolean);
 const requested=term=>preferences.some(value=>value.includes(term))||step.evidence.includes(term);
 const weekend=[0,6].includes(new Date(today+'T12:00:00Z').getUTCDay());
 const eaten=events(state,'foods').filter(row=>row.date===today&&actualFood(row));
 const chickenUsed=[...eaten,...reserved].filter(row=>/鸡胸/.test(row.name)).length;
 const stock=home(state).filter(row=>row.qty>0&&!/酱|食用油|盐|饮料|料酒/.test(row.name)&&
  !(habits.avoidTurkey&&!weekend&&!requested('火鸡')&&/火鸡/.test(row.name))&&
  !(habits.optionalNuts&&!requested('坚果')&&/坚果|腰果|核桃|杏仁/.test(row.name))&&
  !(habits.chickenLimit!=null&&chickenUsed>=habits.chickenLimit&&!requested('鸡胸')&&/鸡胸/.test(row.name)));
 const plan=stock.map(sku=>{
  const vegetable=/菜|瓜|笋|番茄|西兰花/.test(sku.name),celery=/芹菜/.test(sku.name);
  const skuReserved=reserved.filter(row=>row.foodId===sku.id);
  const allocated=skuReserved.reduce((sum,row)=>sum+row.stockAmount,0);
  const free=round(sku.qty-allocated,6);
  if(free<=0)return null;
  const shelf=packagesFor(state,sku.id).filter(onShelf);
  const usedIn=container=>skuReserved.filter(row=>row.containerId===container.id).reduce((sum,row)=>sum+row.amount,0);
  const portion=shelf.find(row=>row.net>usedIn(row)&&(!row.estimated||vegetable));
  const sealed=shelf.find(row=>row.status==='sealed'&&row.nominal&&!usedIn(row));
  const left=portion?round(portion.net-usedIn(portion),3):null;
  const partial=celery&&habits.celerySameDay&&portion&&!usedIn(portion)&&
   (portion.status==='sealed'||!eaten.some(row=>row.meal==='午餐'&&row.foodId===sku.id));
  const amount=portion?(partial?round(left/2,1):vegetable&&!habits.wholeVegetable&&!usedIn(portion)?Math.min(left,250):left):
   sealed?sealed.nominal.value:sku.unit==='g'?Math.min(free,150):sku.unit==='mL'?Math.min(free,200):Math.min(free,1);
  const unit=portion?'g':sealed?sealed.nominal.unit:sku.unit;
  const quantity=sealed?sealed.stockAmount:quantityInUnit(sku,amount,unit,sku.unit);
  if(!(amount>0)||quantity!=null&&quantity>free+1e-6)return null;
  let cents=null;
  if(portion?.costCents!=null&&portion.net>0)cents=Math.min(portion.costCents,Math.round(portion.costCents*amount/(portion.actualNetGrams??portion.net)));
  else if(sealed?.costCents!=null)cents=sealed.costCents;
  else if(quantity>0&&sku.priceBasis===sku.unit&&sku.pricePerUnit!=null)cents=Math.round(quantity*sku.pricePerUnit*100);
  const nutrition=Object.fromEntries(['kcal','protein','carbs','fat','sodium'].map(key=>[key,nutritionFor(sku,amount,unit)[key]??null]));
  return {id:'recommend:'+sku.id,foodId:sku.id,name:sku.name,amount,unit,meal,portion:amount+' '+unit,
   nutrition,cost:cents==null?null:cents/100,status:'plan',stockAmount:quantity??0,containerId:portion?.id??sealed?.id??null,
   uncertainty:[portion?.estimated?'分装重量为估算':sealed?'按包装标称规格':null,partial?'此份芹菜余量优先安排在今天另一餐':null].filter(Boolean).join('；'),
   score:Number(preferences.some(term=>names(sku).some(name=>name.includes(term))))*4+Number(!!portion)*2+
    Number(vegetable&&habits.wholeVegetable)*2+Number(/鸡胸/.test(sku.name)&&habits.chickenLimit!=null)*2+
    Number(sku.nutrition.protein>5),group:/鸡|牛肉|鱼|蛋|虾|豆腐/.test(sku.name)?'protein':vegetable?'vegetable':'other'};
 }).filter(Boolean);
 const chosen=[],groups=new Set();
 let energy=0;
 // An already high intake does not turn the next meal into a skipped meal.
  const training=/长骑|训练补给|运动恢复/.test(step.evidence);
 const usualLimit=habits.lighterDinner?(meal==='晚餐'?.50:.62)*target:Infinity;
 const mealBudget=training?Infinity:gap!==null&&gap>250?Math.min(gap+75,usualLimit):
  gap!==null&&gap<=0?Math.max(450,target*.50):usualLimit;
 for(const row of plan.sort((a,b)=>b.score-a.score)){
  if(groups.has(row.group)||row.nutrition.kcal!==null&&energy+row.nutrition.kcal>mealBudget)continue;
  groups.add(row.group);chosen.push(row);energy+=row.nutrition.kcal??0;
  if(chosen.length===3)break;
 }
 const actualGap=gap===null?'今日热量数据待补':gap<0?'当前已超过日参考 '+Math.abs(gap)+' kcal':'距日参考 '+gap+' kcal';
 const list=chosen.map(row=>row.name+' '+row.portion+(row.nutrition.kcal===null?'（热量待补）':'')).join('、');
 return {items:chosen,reply:'下一餐建议'+(list?'：'+list:'：现有库存缺少合适搭配')+'。'+actualGap+
  (gap!==null&&gap<0?'。下一餐正常吃，按日常口径饮水和活动':'')+'，仅为计划。'};
}

function planRequest(state,step,date,habits){
 if(!/午晚餐|午餐.{0,10}晚餐|两餐|全天/.test(step.evidence))return buildMealPlan(state,step,date,habits);
 const done=new Set(events(state,'foods').filter(row=>row.date===date&&actualFood(row)).map(row=>row.meal));
 const meals=['午餐','晚餐'].filter(meal=>!done.has(meal));
 const items=[],lines=[];
 for(const meal of meals){
  const next=buildMealPlan(state,{...step,meal},date,habits,items);
  items.push(...next.items);
  lines.push(next.reply.replace('下一餐建议',meal+'建议'));
 }
 return {items,reply:lines.join('\n')||'午餐和晚餐已有实际记录，可查看当天报告。'};
}

function localPlan(state,plan,{id,text,today,clock,reference={},foodDate,skills,habits,photoSteps={}}){
 let next=ensureContainers(structuredClone(state));
 const messages=[],queryMessages=[],touched=new Set();
 let resultReference=null;
 for(let [index,step] of plan.steps.entries()){
  if(skills)assertSkillAction(skills,step.kind);
  const operationId='health:'+id+':'+index;
  const date=dateFor(step,today,{date:reference.date??foodDate});
  const time=normalizeClock(step.time)||clock;
  const meal=step.meal||(/早餐|早饭/.test(step.evidence)?'早餐':/午餐|午饭/.test(step.evidence)?'午餐':
   /晚餐|晚饭/.test(step.evidence)?'晚餐':/加餐/.test(step.evidence)?'加餐':mealAt(time));
  if(step.kind==='cycle'||step.kind==='next_meal'){
   queryMessages.push({step,date});continue;
  }
  touched.add(date);
  const ref=resultReference??reference;
  if(['eat','weigh','discard','split','correct'].includes(step.kind)&&
   !photoSteps[index]&&!plausible(step.evidence,{name:step.name})&&!(/这[瓶条盒份]|那[瓶条盒份]|刚才|上面/.test(step.evidence)&&
   (step.recordId&&step.recordId===ref.recordId||ref.skuId&&home(next).some(sku=>sku.id===ref.skuId&&plausible(step.name,sku)))))
   throw Error('建议的食品和本轮原话对不上，账本未更改。');
  if(step.kind==='eat'){
   const result=recordEating(next,step,{date,meal,time,id:operationId,fromPhoto:!!photoSteps[index],habits},ref);
   const photo=photoSteps[index];
   if(photo)for(const {row} of result.items){row.agentEvidence=photo;row.uncertainty=photo.uncertainty;row.quality='estimated';}
   next=result.state;
   for(const {row,containerId} of result.items){
    messages.push(itemText(row));
    resultReference={date,recordId:row.id,containerId,skuId:row.foodId};
   }
  }else if(step.kind==='weigh'||step.kind==='discard'){
   const sku=skuFor(home(next),step);
   if(!sku)throw Error('没有找到「'+step.name+'」的库存包装。');
   let container=chooseContainer(next,sku,step,ref);
   if(step.kind==='weigh'&&container.gross==null&&step.initialGross!=null){
    const start=savePackage(next,container,{id:operationId+':initial',action:'baseline',gross:step.initialGross,date,time});
    next=start.next;container=selectPackage(next,{foodId:sku.id,containerId:container.id});
   }
   if(step.kind==='weigh'&&step.initialGross!=null&&step.initialGross!==container.gross)
    throw Error('这次所说的前次毛重与该包装的最新实称不同，请核对包装。');
   const result=step.kind==='discard'?
    savePackage(next,container,{id:operationId,action:'discard',tare:step.tare,date,time}):
    savePackage(next,container,{id:operationId,action:'eat',gross:step.gross,volumeMl:step.volumeMl,date,time,meal});
   next=result.next;
   if(result.duplicate)messages.push('毛重相同，未重复记录');
   else if(step.kind==='discard')messages.push(sku.name+' 第'+container.number+container.kind+'已丢弃'+
    (result.event.grams==null?'，损耗重量未知':'，损耗 '+result.event.grams+' g'));
   else {
    const row=events(next,'foods').find(entry=>entry.id===result.event.foodId);
    messages.push(itemText(row)+'，最新毛重 '+step.gross+' g');
    resultReference={date,recordId:row.id,containerId:container.id,skuId:sku.id};
   }
  }else if(step.kind==='split'){
   const sku=skuFor(home(next),step);
   if(!sku||sku.unit!=='g')throw Error('分装需要可按克计算的库存。');
   const total=step.weights.reduce((a,b)=>a+b,0),sources=portionSources(next,sku,date).filter(row=>row.remaining+1e-6>=total);
   const selected=step.batchId&&sources.find(row=>row.id===step.batchId);
   if(step.batchId&&!selected||!selected&&sources.length!==1)throw Error('请选择一批足够分装的原料。');
   registerPortions(next,{foodId:sku.id,batchId:(selected||sources[0]).id,date,quantities:step.weights,
    estimated:step.estimated==='yes',id:operationId});
   ensureContainers(next);messages.push(sku.name+'分为 '+step.weights.join('、')+' g');
  }else if(step.kind==='day_status'){
   if(step.status==='complete'&&!dayIntake(next,date).reported)throw Error('没有当天的实际摄入记录可以确认。');
   setDayCompleteness(next,date,step.status);
   messages.push(displayDay(date)+(step.status==='complete'?' 全天记录已确认':' 标记为全天待补'));
  }else if(step.kind==='weight'){
   const prior=events(next,'weights').filter(row=>row.date===date&&(row.isMorning===true||/^(是|纳入)/.test(row.trendStatus??'')));
   if(step.morning==='yes'&&prior.length){
    if(prior.length===1&&prior[0].kg===step.kg){messages.push('该日晨重已记录');continue;}
    throw Error('该日已有晨重。请明确是更正还是另一次称重。');
   }
   recordEvent(next,'weights',{date,time,kg:step.kg,isMorning:step.morning==='yes'},undefined,operationId);
   messages.push((step.morning==='yes'?'晨重 ':'体重 ')+step.kg+' kg');
  }else if(step.kind==='activity'){
   if(step.energyKind==='total'&&!/全天|总消耗|每日总/.test(step.evidence))throw Error('需明确是设备全天总消耗，才能按总量记账。');
   const raw={date,time,name:step.name,km:step.km,minutes:step.minutes,kcal:step.kcal,
    energyKind:step.energyKind,quality:step.quality,uncertainty:step.uncertainty};
   if(duplicateActivity(events(next,'activities'),raw,!!step.time)){
    messages.push('同一日已有匹配的'+step.name+'，未重复累计');continue;
   }
   const flags=activityPolicy(next.settings,{...raw,evidence:step.evidence,includedInBase:step.includedInBase==='yes'&&/计入|基础/.test(step.evidence)});
   recordEvent(next,'activities',{...raw,...flags},undefined,operationId);
   messages.push(step.name+(step.kcal==null?'':' '+step.kcal+' kcal')+
    (flags.excludedFromEnergy?'（设备读数保留为参考）':flags.includedInBase?'（已含在基础消耗）':''));
  }else if(step.kind==='correct_weight'||step.kind==='correct_activity'){
   const weight=step.kind==='correct_weight',kind=weight?'weights':'activities';
   const candidates=events(next,kind).filter(row=>row.date===date&&(!step.time||normalizeClock(row.time)===step.time)&&
    (weight?(!/晨重/.test(step.evidence)||row.isMorning===true||/^(是|纳入)/.test(row.trendStatus??'')):
     key(row.name).includes(key(step.name))));
   if(candidates.length!==1||step.recordId&&step.recordId!==candidates[0].id)
    throw Error('请指明要更正的原'+(weight?'称重':'运动')+'记录或时间。');
   const row=candidates[0];
   const update=weight?{kg:step.kg}:Object.fromEntries(['km','minutes','kcal'].filter(key=>step[key]!==null).map(key=>[key,step[key]]));
   if(!Object.keys(update).length)throw Error('请补充更正后的数值。');
   const edited=recordEvent(next,kind,{...row,...update},row.id);
   // Imported morning weights retain their recognized morning status.
   if(weight&&row.source==='legacy')edited.isMorning=/^(是|纳入|暂定)/.test(row.trendStatus??'')&&
    !/不纳入|排除/.test(row.trendStatus??'');
   messages.push('已更正 '+displayDay(date)+(weight?'体重 '+step.kg+' kg':row.name));
  }else if(step.kind==='correct'){
   const previous=findOriginal(next,step,date,ref);
   const link=managedFoodPackage(next,previous.id);
   if(step.amount!==null&&step.delta!==null)throw Error('更正请选一个最终份量或一个增减量。');
   if(step.delta!==null&&!step.unit)throw Error('请补充更正单位。');
   let amount=step.amount;
   if(step.delta!=null){
    const original=recordedPortion(previous);
    const sku=home(next).find(row=>row.id===previous.foodId);
    const delta=quantityInUnit(sku,step.delta,step.unit,original.unit);
    if(delta===null)throw Error('请使用原饮食份量单位。');
    amount=round(original.amount+delta,3);
    step={...step,unit:original.unit};
   }
   if(amount!=null&&amount<=0)throw Error('更正后份量必须为正。删除需要单独核对。');
   if(link&&step.gross!=null)next=revisePackageFood(next,{foodId:previous.id,id:operationId,gross:step.gross,date,meal:step.newMeal||previous.meal}).next;
   else if(link&&amount!=null)next=revisePackageIntake(next,{foodId:previous.id,id:operationId,amount,unit:step.unit,meal:step.newMeal});
   else if(step.gross!=null)throw Error('原记录没有对应的独立包装，无法更正毛重。');
   else next=reviseFoodPortion(next,{id:previous.id,date,amount,unit:step.unit,newMeal:step.newMeal}).next;
   const after=events(next,'foods').find(row=>row.id===previous.id);
   messages.push('更正 '+displayDay(date)+' '+itemText(after));
   resultReference={date,recordId:after.id,containerId:link?.container?.id??null,skuId:after.foodId};
  }
 }
 return {next,messages,queryMessages,touched:[...touched],reference:resultReference, id,text,today,habits};
}

const patches=['foods','weights','activities','stockMoves','batches','containers','containerEvents','dayCompleteness'];
function changesFrom(before,after){
 const changes={};
 for(const key of patches){
  const old=before.local[key]??[],now=after.local[key]??[];
  const original=new Map(old.map((row,index)=>[row.id,{row,index}]));
  const live=new Map(now.map(row=>[row.id,row]));
  const updates=[...new Set([...original.keys(),...live.keys()])].filter(id=>!same(original.get(id)?.row,live.get(id)))
   .map(id=>[id,original.get(id)??null]);
  if(updates.length)changes[key]=updates;
 }
 for(const kind of ['foods','weights','activities']){
  const active=after.local.edits?.[kind]??{},previous=before.local.edits?.[kind]??{};
  const touched=[...new Set([...Object.keys(active),...Object.keys(previous)])]
   .filter(id=>!same(active[id],previous[id])).map(id=>[id,Object.hasOwn(previous,id),previous[id]??null]);
  if(touched.length)(changes.edits??={})[kind]=touched;
 }
 return changes;
}
function summarize(prepared,state){
 const {messages,queryMessages,today,touched}=prepared;
 const reads=queryMessages.map(({step,date})=>{
  if(step.kind==='next_meal')return planRequest(state,step,date,prepared.habits).reply;
  const cycle=cycleForDate(state,date,today);
  return '周期 '+displayDay(cycle.start)+'至'+displayDay(cycle.end)+' · 已结算 '+cycle.closedDays+' 天 · 缺口 '+cycle.deficit+' kcal。';
 });
 const nutrition=touched.map(date=>{
  const energy=dayIntake(state,date).totals.kcal;
  if(energy==null)return null;
  const cycle=cycleForDate(state,date,today);
  return displayDay(date)+'实际摄入 '+energy+' kcal'+(date<today&&cycle.closedDays?' · 本周期已结算缺口 '+cycle.deficit+' kcal':'');
 }).filter(Boolean);
 return [messages.length?messages.join('；')+'。':'',nutrition.length?nutrition.join(' · ')+'。':'',...reads].filter(Boolean).join('\n');
}

function reportSource(prepared,before,after){
 const dates=new Set([...prepared.touched,...prepared.queryMessages.map(row=>row.date)]);
 if(!dates.size)return null;
 const reports=[...dates].map(date=>{
  const menu=prepared.queryMessages.find(entry=>entry.date===date&&entry.step.kind==='next_meal');
  const proposed=menu?planRequest(after,menu.step,date,prepared.habits).items:[];
  return renderHealthReport(healthReport(after,date,prepared.today,{proposed}));
 });
 const stock=renderInventoryDiff(inventoryDiff(before,after));
 return {label:'营养、库存与进度明细',text:[...reports,stock].filter(Boolean).join('\n\n')};
}

const chineseDigits='零一二三四五六七八九';
function numberFromText(text){
 if(/^\d+(?:\.\d+)?$/.test(text))return Number(text);
 const str=text.replace(/两/g,'二');
 if(str.includes('十')){
  const [tens,ones]=str.split('十');
  return (tens?chineseDigits.indexOf(tens):1)*10+(ones?chineseDigits.indexOf(ones):0);
 }
 if(str.includes('百')){
  const [hundreds,remainder]=str.split('百');
  return (hundreds?chineseDigits.indexOf(hundreds):1)*100+(remainder?numberFromText(remainder.replace(/^零/,'')):0);
 }
 return str.length===1?chineseDigits.indexOf(str):Number.NaN;
}
function statedNumber(evidence,amount){
 const literal=evidence.normalize('NFKC').match(/\d+(?:\.\d+)?|[零一二两三四五六七八九十百]+/g)??[];
 return literal.some(text=>numberFromText(text)===Math.abs(amount));
}
function verifyValues(step){
 const fields={eat:['amount'],weigh:['gross','initialGross','volumeMl'],discard:['tare'],
  weight:['kg'],activity:['km','minutes','kcal'],correct:['amount','delta','gross'],
  correct_weight:['kg'],correct_activity:['km','minutes','kcal']};
 const numbers=(fields[step.kind]??[]).flatMap(field=>step[field]==null?[]:[step[field]]);
 if(step.kind==='split')numbers.push(...step.weights);
 if(numbers.some(value=>!statedNumber(step.evidence,value)))
  throw Error('建议的数值和本轮原话对不上，账本未更改。');
 if(step.kind==='eat'&&step.whole==='yes'){
  const explicit=/吃完|喝完|全部吃|全部喝|整[瓶盒袋包份]|(?:\d+|[一二两三四五六七八九十]+)\s*[瓶盒袋包份]/.test(step.evidence);
  if(!explicit||/一半|半[瓶盒袋包份]/.test(step.evidence))
   throw Error('没有明确吃完整包装，账本未更改。');
 }
 if(step.kind==='correct'&&step.delta!=null){
  if(/少算|漏算|漏记|补上|多了?吃/.test(step.evidence)&&step.delta<0||
     /多算|重复算|多记|减去|扣掉/.test(step.evidence)&&step.delta>0)
   throw Error('建议的更正方向和原话不一致，账本未更改。');
 }
}
const interpretedWrite=step=>!reads.has(step.kind);
function validatePlan(plan,text,photoSteps={}){
 if(!matches(healthActionSchema,plan)||!text.trim())throw Error('模型返回的健康操作格式无效，账本未更改。');
 const writes=plan.steps.filter(interpretedWrite);
 if(writes.length&&!Object.keys(photoSteps).length&&!hasWriteLanguage(text))throw Error('这条消息没有可核对的记录指令。');
 const noSave=/不要(?:记录|记账|保存|扣库|写入|自动)|先(?:看看|预览|别记录|不要记录)|只(?:看看|问|算|预览)|假如|如果我|举个例子/.test(text);
 for(const [index,step] of plan.steps.entries()){
  if(!step.evidence.trim()||!text.includes(step.evidence))throw Error('有操作缺少本轮原话依据，账本未更改。');
  if(!photoSteps[index])verifyValues(step);
  if(step.kind==='day_status'){
   const partial=/待补|没记全|未记全|未完整|没有记全|没录全|未录全|缺报|不完整/;
   const complete=/已记录|已记全|记完|已报完|已齐|确认.*全天|全天.*完整|封账/;
   if(!/全天|日终|封账|缺报/.test(step.evidence)||
     (step.status==='partial'?!partial.test(step.evidence):partial.test(step.evidence)||!complete.test(step.evidence)))
    throw Error('请明确是否确认当天所有饮食已记录。');
  }
  if(step.kind==='discard'&&!/丢弃|扔掉|扔了|倒掉|过期.*扔/.test(step.evidence))
   throw Error('丢弃操作需要本轮明确说要丢弃。');
  if(step.kind==='discard'&&/全部|所有|一并|都扔/.test(step.evidence))
   throw Error('批量丢弃需要逐个核对包装。');
  if(step.kind.startsWith('correct')&&!/更正|少算|多算|改|纠正|错|补上/.test(step.evidence))
   throw Error('更正需要本轮明确指明。');
 }
 return plan.intent==='execute'&&writes.length>0&&!noSave;
}

export function healthActionPreview(state,plan,options){
 const execute=validatePlan(plan,options.text,options.photoSteps);
 const prepared=localPlan(state,plan,options);
 return {execute,prepared,preview:summarize(prepared,prepared.next),
  source:reportSource(prepared,state,prepared.next)};
}

export function healthActionReceipt(base,{id,text,today,mediaKey='',now=Date.now()}){
 const own=operationList(base).find(row=>row.id===id);
 if(own)return {text:own.undone?'这条记录已撤销。':own.text,source:own.undone?null:own.source,record:own,duplicate:true};
 const signature=today+'\n'+normal(text)+'\n'+(mediaKey||'');
 const recent=(!!mediaKey||!/又|再|另|重新|第二次|第三次/.test(text))&&operationList(base).findLast(record=>
  !record.undone&&(record.signature===signature||!mediaKey&&record.signature===signature.slice(0,-1))&&now>=record.at&&now-record.at<=REPLAY_WINDOW);
 return recent?{text:'这条请求刚已保存，未重复入账。',record:recent,duplicate:true}:null;
}
export async function executeHealthAction(workspace,base,plan,options){
 const {id,text,today,clock,guard,mediaKey='',confirmed=false,now=Date.now()}=options;
 if(typeof id!=='string'||!id)throw Error('缺少健康操作 ID，账本未更改。');
 const check=()=>{options.signal?.throwIfAborted();guard?.();};
 const expected=base.revision??0;
 const duplicate=healthActionReceipt(base,options);
 if(duplicate)return duplicate;
 const {execute,prepared,preview,source}=healthActionPreview(base,plan,{...options,id,text,today,clock});
 if(!execute||!confirmed&&!options.auto)return {text:preview,source,preview:execute?'confirm':'readonly'};
 if(!Object.keys(changesFrom(base,prepared.next)).length)return {text:preview,source};
 const signature=today+'\n'+normal(text)+'\n'+(mediaKey||'');
 check();
 const changes=changesFrom(base,prepared.next);
 const independent=Object.keys(changes).every(key=>['weights','activities','dayCompleteness'].includes(key))?
  changesFrom(prepared.next,base):null;
 const record={id,signature,at:now,expectedRevision:expected,revision:expected+1,changes,independent,
  reference:prepared.reference,text:'已保存。'+preview,source};
 prepared.next.local.assistantActions=[...operationList(prepared.next).slice(-(HISTORY_SIZE-1)),record];
 await workspace.saveHealth(prepared.next,expected,check);
 const stored=await workspace.readHealth();
 const persisted=operationList(stored).find(row=>row.id===id&&!row.undone);
 if(!persisted)throw Error('本机未能验证保存回执，请用原消息重试。');
 if(stored.revision===record.revision){
  const different=patches.some(key=>{
   const expectedRows=new Map((prepared.next.local[key]??[]).map(row=>[row.id,row]));
   const actualRows=new Map((stored.local[key]??[]).map(row=>[row.id,row]));
   return (record.changes[key]??[]).some(([id])=>!same(expectedRows.get(id),actualRows.get(id)));
  });
  if(different||!same(prepared.next.local.edits,stored.local.edits))
   throw Error('保存回执与当前记录不一致，请核对账本。');
 }
 const checked=summarize(prepared,stored);
 return {text:'已保存。'+checked,record:persisted,source:reportSource(prepared,base,stored)};
}
export async function undoHealthAction(workspace,id){
 const state=await workspace.readHealth(),expected=state.revision??0;
 const record=operationList(state).find(row=>row.id===id);
 if(!record||record.undone)throw Error('这笔操作已撤销或无法定位。');
 if(record.revision!==expected){
  const unchanged=record.independent&&Object.entries(record.independent).every(([key,rows])=>
   rows.every(([id,post])=>same((state.local[key]??[]).find(row=>row.id===id),post?.row)));
  if(!unchanged)throw Error('之后已有相关账本更新，请通过对话更正具体记录。');
 }
 const next=structuredClone(state);
 for(const key of patches){
  const items=record.changes[key];if(!items)continue;
  const ids=new Set(items.map(([id])=>id));
  const added=(next.local[key]??[]).filter(row=>ids.has(row.id)&&!items.find(([id])=>row.id===id)?.[1]);
  const keep=(next.local[key]??[]).filter(row=>!ids.has(row.id));
  for(const item of items.map(([,prior])=>prior).filter(Boolean).sort((a,b)=>a.index-b.index))
   keep.splice(item.index,0,item.row);
  next.local[key]=keep;
  if(['foods','weights','activities'].includes(key)){
   const tombstones=(next.sync??={}).tombstones??=[];
   for(const row of added)if(!tombstones.some(item=>item.id===row.id&&item.type===key))
    tombstones.push({type:key,id:row.id,before:row});
  }
 }
 const edits=record.changes.edits??(record.changes.foodEdits?{foods:record.changes.foodEdits}:{});
 for(const [kind,touched] of Object.entries(edits)){
  const table=((next.local.edits??={})[kind]??={});
  for(const [id,exists,row] of touched)if(exists)table[id]=row;else delete table[id];
 }
 const receipt=operationList(next).find(row=>row.id===id);
 receipt.undone=true;delete receipt.changes;delete receipt.independent;
 await workspace.saveHealth(next,expected);
 const stored=await workspace.readHealth();
 if(!operationList(stored).find(row=>row.id===id)?.undone)throw Error('未能验证撤销，请重新查询。');
 return '已撤销这次健康记录。';
}
