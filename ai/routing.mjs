import {healthSteps} from '../health/contract.mjs';
import {freshData,readFinance} from '../finance-storage.mjs';
import {validDate,addDays} from '../health/core.mjs';
import {chooseFinanceCategory} from './finance.mjs';
import {CHAT_MODELS} from './responses.mjs';
import {manualChatModel} from './models.mjs';

const finance=/余额|收入|支出|花了|消费|报销|(?:财务|银行|账户|信用卡).{0,12}(?:账|钱|交易)|预算|账单|账本|(?:记|付|花|报销).{0,10}\d+(?:\.\d+)?\s*(?:元|块)/;
const purchase=/截图|订单|采购|退款|实付|购物车|付款|配送费/;
const action=/记|查|更正|改|统计|安排|配餐|汇总|录入|记录|入库|规划|称|吃到|喝到|食用|用了|少算|多算|漏算|补报|漏记/;
const raw=/直接|原始|完整数据|备份|设置|覆盖|清除|删除|清空|导出|恢复|(?:添加|修改|去掉).*分类|余额调整|余额修正|对话|记忆|记住|忘记|习惯|规则|预算同步|全部|(?:周期|TDEE|目标|预算|分类).{0,12}(?:改|设置|调整)|(?:更改|设置|调整).{0,12}(?:周期|TDEE|目标|预算|分类)/i;
const healthMode=/晨重|体重|吃了|喝了|牛奶|毛重|称重|饮食|早餐|午餐|晚餐|运动|库存|分装|周期|配餐|缺口/;
const step=(kind,evidence,fields)=>{
 const defaults=Object.fromEntries(Object.entries(healthSteps[kind].properties).map(([key,schema])=>[key,
  schema.type==='array'?[]:schema.enum?.[0]??null]));
 return {...defaults,kind,evidence,...fields};
};
const healthAction=step=>({mode:'health_action',date:null,result:{intent:'execute',steps:[step]}});

function separateReceiptTurn(text,today){
 if(!today)return null;
 const parts=text.trim().split(/[，,；;。]/).map(value=>value.trim()).filter(Boolean);
 const weights=[],orders=[],plans=[];
 for(const part of parts){
  const route=localAgentCommand(null,{text:part,today});
  const goal=route?.proposal?.result.steps[0];
  if(goal?.kind==='weight'){weights.push(goal);continue;}
  if(/^(?:再|然后|并)?\s*(?:安排|规划|搭配)(早餐|午餐|晚餐|加餐)$/.test(part)){
   const meal=part.match(/早餐|午餐|晚餐|加餐/)[0];
   plans.push(step('next_meal',part,{meal,preferences:[]}));
  }else if(/^(?:请)?(?:识别|处理|记录|核对|报销).{0,18}(?:订单|付款|购物|采购|支付|截图)(?:截图|照片)?$/.test(part)||
    /^(?:食品|食材|能吃的|吃的)(?:先)?(?:入库|记进库存)$/.test(part))orders.push(part);
  else return null;
 }
 if(!orders.some(part=>/识别|处理|记录|核对|报销/.test(part))||weights.length>1||plans.length>2||(!weights.length&&!plans.length))return null;
 return {weights,plans,wireText:orders.join('，')};
}
export const separateAttachmentRequests=text=>
 /逐张|每张|独立识别|分别(?:处理|记|入账|识别)/.test(text)&&!/同一|同个|合计|不重复|只记一次|续粉/.test(text);
export function routeAgent(store,{text='',photos=0,medical=null,allowRead=true,legacy=false,today}={}){
 const own=manualChatModel(store);
 const isHealth=healthMode.test(text),isFinance=finance.test(text);
 const isReceipt=purchase.test(text)&&Boolean(photos);
 const mixed=(isHealth&&(isFinance||isReceipt)&&action.test(text))||
  /分别|一起|一并|顺便|然后|同时/.test(text)&&isHealth&&isFinance;
 const decomposed=!legacy&&allowRead&&isReceipt&&mixed&&!medical?separateReceiptTurn(text,today):null;
 let profile='general';
 if(!legacy&&allowRead){
  if(medical)profile='medical';
  else if(decomposed)profile='receipt';
  else if(photos){
   if(!separateAttachmentRequests(text)||isReceipt)profile=mixed?'mixed':isReceipt&&!isHealth?'receipt':'vision';
  }else if(!raw.test(text)){
   if(mixed)profile='mixed';
   else if(isFinance&&!isHealth)profile='finance';
   else if(isHealth&&!isFinance&&action.test(text))profile='health';
  }
 }
 const visual=Boolean(photos)||medical==='extract';
 const model=own??CHAT_MODELS[mixed&&!decomposed?2:visual?1:0];
 return {profile,model:model.id,manual:!!own,visual,mixed,decomposed};
}

export function localAgentCommand(workspace,{text,today,allowRead=true,files=0,reference}){
 if(!allowRead||files||!text.trim())return null;
 const source=text.trim(),normalized=source.normalize('NFKC').replace(/[。！？!?]$/,'').trim();
 if(/^(?:(?:帮我|请|想)查(?:一下)?|我想知道)?(?:我(?:的)?|目前|现在|当前|本机|总)*\s*(?:账本)?(?:总)?余额(?:是)?多少$/.test(normalized)||
    /^(?:查|查看|查一下)(?:当前|我的|现在)?(?:总)?余额$/.test(normalized))
  return {query:{scope:'balance',query:''}};
 const reads=[
  [/^(?:查|查看|显示)(?:今天|今日)收支$/, 'expenses'],
  [/^(?:查|查看|显示)(?:本月|当前)(?:月)?预算(?:进度|余额|剩余)?$/, 'budget'],
  [/^(?:查|查看|显示)(?:当前|本次|本轮|本)?(?:减脂)?周期(?:缺口|进度)?$/, 'cycle'],
  [/^(?:查|查看|显示)(?:最近|近)(?:七|7)次晨重(?:趋势|均值)?$/, 'weight'],
  [/^(?:查|查看|显示)(?:今天|今日)的?(?:实际)?(?:摄入|营养)(?:热量|汇总)?$/, 'nutrition']
 ];
 const exact=reads.find(([pattern])=>pattern.test(normalized));
 if(exact)return {query:{scope:exact[1],query:''}};
 const intake=normalized.match(/^(?:回顾(?:一下|下)?|查(?:一下|下)?|查看|看看)?(?:我)?(今天|昨天|前天|\d{4}-\d{2}-\d{2})(?:我)?(?:的)?(早餐|午餐|晚餐|加餐)?(?:都)?(?:吃了什么|有哪些实际饮食|饮食记录有哪些)$/);
 if(intake){
  const date={今天:today,昨天:addDays(today,-1),前天:addDays(today,-2)}[intake[1]]??intake[1];
  if(validDate(date)&&date<=today)return {query:{scope:'foods',date,query:''},...(intake[2]?{meal:intake[2]}:{})};
 }
 const morning=normalized.match(/^(?:(今天|昨天|前天)\s*)?(?:记录|记下|记一下|记)?\s*(?:晨重|早晨体重)\s*(?:是|为|:)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:kg|公斤|千克)$/i);
 if(morning&&Number(morning[2])>=1&&Number(morning[2])<=650){
  const date={昨天:addDays(today,-1),前天:addDays(today,-2)}[morning[1]]??null;
  return {proposal:healthAction(step('weight',source,{date,kg:Number(morning[2]),morning:'yes'}))};
 }
 const weighed=normalized.match(/(\d{1,3}(?:\.\d+)?)\s*(?:kg|公斤|千克)/gi);
 if(weighed?.length===1&&/(?:起床|早上|晨重|早起)/.test(normalized)&&/空腹|体重|称了/.test(normalized)&&
  /留档|记录|记上|补上|记下来/.test(normalized)&&!/如果|大概|也记|同时|顺便|另外|再记|修正|更正|改|除了|计划|不是/.test(normalized)){
  const kg=Number(weighed[0].match(/\d+(?:\.\d+)?/)[0]);
  if(kg>=1&&kg<=650){
   const day=/前天/.test(normalized)?addDays(today,-2):/昨天|昨日/.test(normalized)?addDays(today,-1):null;
   return {proposal:healthAction(step('weight',source,{date:day,kg,morning:'yes'}))};
  }
 }
 const weight=normalized.match(/^([\p{L}][\p{L}\p{N} ]{1,30}?)(?:现在|最新毛重|剩余毛重)\s*(?:是|为|:)?\s*(\d{1,5}(?:\.\d{1,3})?)\s*(?:g|克)$/iu);
 if(weight&&!/[a-z0-9]\s*[瓶盒袋包]$/i.test(weight[1])&&!/可能|大概|应该|如果|比如|不是|不确定|昨天|今天|前天|上次|刚才|称错|更正|全部|合计|计划|体重|餐|已经吃|用了|买/.test(weight[1])&&Number(weight[2])>0){
  return {proposal:healthAction(step('weigh',source,{name:weight[1].trim(),gross:Number(weight[2])}))};
 }
 const unit=term=>/^ml$/i.test(term)||term==='毫升'?'mL':'g';
 const relative=reference?.recordId&&/这[条笔道]|那[条笔道]|刚(?:记|才)|上一条/.test(normalized)&&
  !/如果|不要|先看看|多个|全部|昨天|前天|另一/.test(normalized)&&
  normalized.match(/改成\s*(\d+(?:\.\d{1,3})?)\s*(g|克|mL|毫升)(?:[，,、\s]|$)/iu);
 if(relative&&Number(relative[1])>0){
  const meal=normalized.match(/(?:留在|改到|移到)\s*(早餐|午餐|晚餐|加餐)/)?.[1]??null;
  return {proposal:healthAction(step('correct',source,{name:'那条',recordId:reference.recordId,
   date:reference.date,amount:Number(relative[1]),unit:unit(relative[2]),newMeal:meal}))};
 }
 const correction=normalized.match(/^(昨天|前天|今天)(?:的)?([\p{L}][\p{L}\p{N} ]{1,22}?)(?:记录)?(少算|多算|漏记)\s*(\d{1,5}(?:\.\d{1,3})?)\s*(g|克|mL|毫升)$/iu);
 if(correction&&!/或|估|好像|可能|应该|这条|那条|原来/.test(correction[2])&&Number(correction[4])>0)
  return {proposal:healthAction(step('correct',source,{name:correction[2],unit:unit(correction[5]),
   delta:Number(correction[4])*(correction[3]==='多算'?-1:1)}))};
 const eating=normalized.match(/^(?:(早餐|午餐|晚餐|加餐)\s*)?(?:我)?(?:吃了|喝了)\s*(\d{1,5}(?:\.\d{1,3})?)\s*(g|克|mL|毫升)\s*([\p{L}][\p{L}\p{N} ]{1,26})$/iu);
 if(eating&&Number(eating[2])>0&&!/估|可能|大约|大概|再|又|好像|或者|和|另|还|外卖|外食|试吃/.test(eating[4]))
  return {needsStock:true,proposal:healthAction(step('eat',source,{name:eating[4],amount:Number(eating[2]),unit:unit(eating[3]),
   meal:eating[1]??null,source:'auto',whole:'no'}))};
 if(!workspace)return null;
 const money=normalized.match(/^(?:记(?:录|下|一笔|账)?\s*)(支出|收入)\s+([^ :：]{1,30})\s+(?:¥\s*)?(\d{1,7}(?:\.\d{1,2})?)(?:\s*(?:元|块))?(?:\s+(.{1,120}))?$/);
 if(money){
  const type=money[1]==='支出'?'expense':'income';
  const ledger=readFinance(workspace.finance).payload??freshData();
  const active=ledger.categories.filter(row=>row.type===type&&!row.hidden&&row.name===money[2]);
  const category=active.length===1?chooseFinanceCategory(ledger,{type,hint:active[0].id,explicit:true}):null;
  if(category&&Number(money[3])>0)return {proposal:{mode:'agent_task',date:null,result:{steps:[{
   id:'finance',dependsOn:[],kind:'finance',evidence:source,
   entry:{type,amount:Number(money[3]),date:today,categoryId:category.id,note:money[4]??''}
  }]}}};
 }
 return null;
}

export function routedSkills(skills,profile){
 const domains={health:['intake','meals','stock','weighing','exercise','progress','correction','sync'],
  finance:['finance'],receipt:['receipts'],vision:['receipts','photos','intake','weighing'],medical:['medical']};
 return domains[profile]?skills.filter(skill=>domains[profile].includes(skill.id)):skills;
}

export function scopedHistory(profile,text,current){
 const recent=current.turns.slice(-24);
 const terms=new Set((text.match(/[a-z0-9_-]{3,}|[\p{Script=Han}]{2}/giu)??[]).map(word=>word.toLowerCase()));
 const earlier=current.turns.slice(0,Math.max(0,current.turns.length-24))
  .filter(row=>[...terms].some(term=>row.text.toLowerCase().includes(term))).slice(-6);
 return {...current,turns:[...earlier,...recent]};
}

const unknownReceipt={merchant:null,orderNo:null,date:null,state:'unknown',currency:null,paid:null,discount:null,shipping:null,
 paymentEvidence:null,totalEvidence:null,refund:null,refundNo:null,images:[1],lines:[]};
export function combineReceiptTurn(prepared,candidate){
 const incoming=candidate?.mode==='agent_task'?candidate.result.steps:[];
 // Output validation already restricts an order request to receipt steps.
 const receipts=incoming.length?incoming.map((row,index)=>({...row,id:'receipt-'+(index+1),dependsOn:[]})):
  [{id:'receipt-1',kind:'receipt',dependsOn:[],receipt:unknownReceipt}];
 if(receipts.length+prepared.weights.length+prepared.plans.length>8)return null;
 const health=(id,action,dependsOn)=>({id,kind:'health',dependsOn,action:{intent:'execute',steps:[action]}});
 const weights=prepared.weights.map((row,index)=>health('local-weight-'+(index+1),row,[]));
 const dependsOn=[...receipts,...weights].map(row=>row.id);
 const meals=prepared.plans.map((row,index)=>health('local-plan-'+(index+1),row,dependsOn));
 return {mode:'agent_task',date:null,result:{steps:[...receipts,...weights,...meals]}};
}
