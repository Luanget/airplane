// Only supported fields are extracted. Imported prose is evidence, not executable instructions.
export const PROFILE_ID='airplane-health-profile-metadata';
export const CORE_RULES=Object.freeze({
 '01_canonical_sync':'只以实际回执报告本机保存和文件导出；外部状态须有独立凭据。',
 '02_actual_and_inventory':'计划独立；实际消耗、赠送和丢弃按各自原因记流水。',
 '03_food_nutrition_cost':'明确数据依据；营养和价格未知保留未知。',
 '04_diet_targets_preferences':'按可用库存和已启用习惯规划，与实际摄入分开。',
 '05_exercise_and_tdee':'通勤、专项和设备合计去重；计入规则由本机执行。',
 '06_six_day_cycle':'有实际摄入且可计算热量的日期参与账面缺口；缺报未知，可能未记全时标记缺口可能高估。',
 '07_weight_trend':'显示有效晨重及最近七次窗口；不把单日波动等同于脂肪变化。',
 '08_recovery_and_safety':'高热量外食后恢复正常用餐、饮水和日常活动。'
});
const keys=Object.keys(CORE_RULES);
const habits=[
 ['chicken-one','熟鸡胸每天一袋','优先按一袋实称熟鸡胸规划；同一天已安排或吃过一袋时不主动再安排。',
  /一天.{0,12}(?:1袋|一袋).{0,18}鸡胸|一天.{0,12}鸡胸.{0,12}(?:1袋|一袋)/],
 ['celery-day','芹菜同日分餐','有整份芹菜时，优先在同一天午、晚餐各用约半份。',
  /芹菜.{0,65}(?:250\s*g\s*[+＋]\s*250|分(?:成)?两餐|午.{0,12}晚)/i],
 ['whole-vegetable','整份蔬菜','优先用一份实称或已标明估重的在库蔬菜；不虚构分装。',
  /每餐优先一种主要蔬菜|蔬菜.{0,12}整份|完整独立包装/],
 ['lunch-more','午多晚少','一般午餐稍多、晚餐稍少；当天午餐吃多仍正常安排晚餐。',
  /午多晚少|午餐稍多.{0,5}晚餐稍少|午餐.{0,4}稍多.{0,10}晚餐.{0,4}稍少/],
 ['turkey-weekend','常规日避开高热量火鸡面','普通工作日不主动安排高热量火鸡面；周末或明确点名可安排。',
  /火鸡.{0,15}拌面.{0,25}不安排普通工作日|普通日.{0,40}火鸡|常规日.{0,15}火鸡/],
 ['nuts-optional','坚果按需','默认餐单不加入坚果，用户明确想吃时可以安排。',
  /坚果.{0,12}不默认|不默认.{0,12}坚果/],
 ['buckwheat-default','单包主食偏好','只说一包面时优先检查已确认、仍在库的荞麦面 SKU。',
  /一包面.{0,45}荞麦面/]
];
export const profileVersion=value=>String(value??'').match(/(?:^|[^\d])(\d{6,8}\.\d+)(?=$|[^\d])/)?.[1]??'';
const versionParts=version=>version.split('.').map(Number);
export function compareProfileVersion(a,b){
 const [day,rev]=versionParts(a),[other,n]=versionParts(b);return day-other||rev-n;
}
const inactive=/历史归档|已废弃|过期规则|已停用|superseded|inactive|deprecated/i;
function activeRules(input){
 const list=input?.tables?.rules??input?.legacy?.rules??[];
 if(!Array.isArray(list))return [];
 return list.flatMap(row=>{
  const id=row?.Key??row?.key,status=row?.['状态']??row?.status;
  if(!keys.includes(id)||(status!=null&&status!=='active')||input?.tables&&status!=='active')return [];
  return [{id,text:[row?.['说明']??row?.desc,row?.['当前值']??row?.value].filter(value=>typeof value==='string').join(' ')}];
 });
}
function readMarkdown(text,filename){
 const sections=text.split(/(?=^#{1,4}\s)/m);
 const onlyCurrent=sections.filter(part=>!inactive.test(part.split('\n')[0])).join('');
 const version=profileVersion(filename)||profileVersion(text.split('\n').slice(0,12).join('\n'));
 const recognized=keys.filter(id=>onlyCurrent.includes(id));
 const obsoleteLines=onlyCurrent.split('\n').filter(line=>!inactive.test(line));
 return {version,recognized,text:obsoleteLines.join('\n')};
}
function number(text,pattern){
 const m=text.match(pattern),value=m&&Number(m[1]);
 return value>0?value:null;
}
function calculations(text){
 const protein=text.match(/蛋白(?:质)?[^\d\n]{0,14}(\d+)\s*[–—~～-]\s*(\d+)\s*g/i);
 const baseline=number(text,/(?:TDEE基线|TDEE暂按|TDEE\s*基线|基线)\s*(?:约|≈|为|=|暂按)?\s*(\d{4})\s*kcal/i);
 const calories=number(text,/普通日(?:参考)?[^\d\n]{0,12}(\d{4})\s*kcal/i);
 const target=number(text,/(?:缺口|每6天)\s*(?:\*\*)?\s*(\d{4,5})\s*kcal/i);
 const fat=number(text,/脂肪[^\d\n]{0,12}(\d+)\s*(?:[–—~～-]\s*\d+\s*)?g/i);
 const sodium=number(text,/钠[^\d\n]{0,14}(\d+)\s*mg/i);
 return {
  ...(baseline>0&&baseline<=9000?{baselineTdee:baseline}:{}),...(calories>=500&&calories<=8000?{calorieTarget:calories}:{}),
  ...(protein&&+protein[1]>0&&+protein[2]<=1000&&+protein[1]<=+protein[2]?{proteinMin:+protein[1],proteinMax:+protein[2]}:{}),
  ...(fat&&fat<=1000?{fatMin:fat}:{}),...(sodium&&sodium<=50000?{sodiumTarget:sodium}:{}),
  ...(target&&target<=30000&&/6\s*天|六天/.test(text)?{cycleDays:6,cycleTarget:target}:{}),
  ...(/通勤/.test(text)&&/已含|已包含|包含通勤|基线.*含通勤/.test(text)?{commuteIncluded:true}:{}),
  ...(/(?:Watch|手表).{0,45}(?:仍在校准|须去重|不能直接替换|去重)/i.test(text)?{watchReference:true}:{})
 };
}
export function prepareHealthProfile(files,state,{previousVersion='',now=new Date().toISOString()}={}){
 const currentVersion=profileVersion(state?.importInfo?.sourceVersion);
 const candidates=[];
 if(currentVersion)candidates.push({version:currentVersion,rules:activeRules(state),source:'本机主账',rank:3,text:''});
 for(const {name,text} of files){
  if(/\.json$/i.test(name)){
   const ledger=JSON.parse(text);
   const version=profileVersion(ledger.handoff_version??ledger.importInfo?.sourceVersion);
   if(!version||!activeRules(ledger).length)throw Error('所选 JSON 没有可识别的现行规则版本。');
   candidates.push({version,rules:activeRules(ledger),source:name,rank:3,text:''});
  }else if(/^(HEALTH_WORKFLOW_AND_STORAGE|CORE_RULES)(?:_|\.)/i.test(name)&&/\.md$/i.test(name)){
   const part=readMarkdown(text,name);
   if(!part.version)throw Error('工作规范缺少版本号。');
   candidates.push({...part,source:name,rank:/^CORE_RULES/i.test(name)?2:1});
  }else throw Error('请选择带版本号的健康工作规范、核心规则或主账 JSON。');
 }
 const version=candidates.map(row=>row.version).sort(compareProfileVersion).at(-1);
 if(!version)throw Error('未找到可识别的健康配置版本。');
 if(previousVersion&&compareProfileVersion(version,previousVersion)<0)throw Error('选定的规则版本早于已启用配置。');
 const matching=candidates.filter(row=>row.version===version).sort((a,b)=>b.rank-a.rank);
 // JSON rules are authoritative for the list; same-version workflow may add details.
 const ledger=matching.find(row=>row.rules?.length),verified=new Set(ledger?ledger.rules.map(row=>row.id):matching.flatMap(row=>row.recognized??[]));
 const detail=matching.map(row=>row.rules?.map(rule=>rule.text).join('\n')??row.text).join('\n');
 const ruleIds=keys.filter(id=>verified.has(id));
 if(!ruleIds.length)throw Error('未找到可识别的现行核心规则。');
 const entries=habits.filter(([, , ,pattern])=>pattern.test(detail)).map(([topic,name,text])=>
  ({id:'profile:'+topic,topic,name,text,enabled:true,priority:30,updatedAt:now,origin:'health-profile',sourceVersion:version}));
 return {version,ruleIds,entries,settings:calculations(detail),sources:matching.map(row=>row.source),ignored:candidates.length-matching.length};
}

export function preferenceTopic(text){
 const checks={'chicken-one':/鸡胸.*(?:袋|每天|一天)|(?:袋|每天|一天).*鸡胸/,
  'celery-day':/芹菜.*(?:午|晚|同日|同一天|两餐|分餐)/,'whole-vegetable':/蔬菜.*整份|整份.*蔬菜/,
  'lunch-more':/午.*晚.*(?:多|少)|午多晚少/,'turkey-weekend':/火鸡面|火鸡味拌面/,
  'nuts-optional':/坚果.*(?:默认|不吃|少吃)/,'buckwheat-default':/一包面.*荞麦|荞麦.*主食偏好/};
 return Object.keys(checks).find(key=>checks[key].test(text))??null;
}
export function habitPolicy(rows){
 const live=new Map();
 for(const row of rows.filter(item=>item.enabled&&item.topic).sort((a,b)=>
  (b.priority??0)-(a.priority??0)||String(b.updatedAt??'').localeCompare(String(a.updatedAt??''))))
  if(!live.has(row.topic))live.set(row.topic,row.text);
 const matches=(id,pattern)=>pattern.test(live.get(id)??'');
 const chicken=live.get('chicken-one')??'';
 const max=chicken.match(/(?:每天|一天|每天最多|一天通常)[^\d一二两三四]{0,12}([\d一二两三四])\s*袋/);
 return {
  chickenLimit:chicken?max?Number(max[1])||({一:1,二:2,两:2,三:3,四:4}[max[1]]??1):1:null,
  celerySameDay:matches('celery-day',/同日|同一天|同一日|两餐|午.*晚/)&&!matches('celery-day',/不再|不用|允许跨日/),
  wholeVegetable:matches('whole-vegetable',/整份|一份/)&&!matches('whole-vegetable',/不再|不用/),
  lighterDinner:matches('lunch-more',/午.*多.*晚.*少|晚餐稍少/),
  avoidTurkey:matches('turkey-weekend',/避开|不主动|不安排|周末/)&&!matches('turkey-weekend',/(工作日|平日|普通日).{0,8}(可以|允许|也安排)/),
  optionalNuts:matches('nuts-optional',/不加入|不默认|不吃/),
  buckwheatDefault:matches('buckwheat-default',/荞麦/)
 };
}

export function applyProfileSettings(current,settings,date){
 const next=structuredClone(current);
 const {commuteIncluded,watchReference,...numeric}=settings;
 const prior=next.settings;
 if(numeric.baselineTdee!==undefined&&numeric.baselineTdee!==prior.baselineTdee){
  const previous=prior.energyBaselineChanges??[],transitions=previous.filter(row=>row.from!==date);
  transitions.push({from:date,before:previous.find(row=>row.from===date)?.before??prior.baselineTdee});
  prior.energyBaselineChanges=transitions.sort((a,b)=>a.from.localeCompare(b.from));
 }
 Object.assign(prior,numeric);
 prior.agentEnergy={...prior.agentEnergy,...(commuteIncluded?{commuteIncluded}:{}),...(watchReference?{watchReference}:{})};
 if(numeric.calorieTarget!=null)prior.dietCustomized=true;
 return next;
}
