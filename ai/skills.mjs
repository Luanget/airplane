// Legacy preference storage stays readable for the one-time memory migration.
export const SKILLS_KEY='airplane-ai-skills-v2';
const legacyWorkflows=[
 ['l-data','L · 数据与纠错规范',true,['correction','sync']],
 ['l-record','L · 记录与纠错',true,['intake','correction']],
 ['l-meals','L · 配餐与营养',true,['meals']],
 ['l-stock','L · 库存与采购',true,['stock','receipts','weighing']],
 ['l-progress','L · 运动与周期',true,['exercise','progress']],
 ['l-food-preferences','L · 餐食偏好',false,['meals']],
];
const legacyTopics=new Map(legacyWorkflows.map(([id,,,topics])=>[id,topics]));

export function migratedPreferences(store,legacyKey='airplane-ai-skill-v1'){
 if(storedSkills(store))return [];
 const text=store.getItem(legacyKey)?.trim();
 return text?[{id:'legacy-preference',name:'原有个人偏好',text,enabled:true}]:[];
}

// Copies made by the older memory migration can stay on disk without being applied twice.
export function migratedSkillIds(store){
 const personal=storedSkills(store)?.personal;
 return new Set([...legacyTopics.keys(),...(Array.isArray(personal)?personal.map(row=>row?.id):[])]);
}

// These definitions are data. Only the application's scoped operations run.
const define=(id,name,pattern,tools,actions,steps,checks,output)=>Object.freeze({
 id,name,version:2,pattern,tools:Object.freeze(tools),actions:Object.freeze(actions),steps,checks,output
});
export const HEALTH_SKILLS=Object.freeze([
 define('intake','饮食记录',/吃|喝|早餐|午餐|晚餐|营养|续粉|饮食|外食/,
  ['read_health_report','read_packages'],['eat'],'定位餐次和食品，区分实吃与计划，按证据匹配SKU和份量。','实际才入账；同一食物或照片不能重记。','逐项营养、餐次及全天。'),
 define('meals','餐单规划',/安排|配餐|计划|下一餐|吃什么|恢复|晚饭|食谱/,
  ['planning_facts','evaluate_meal_plan','write_meal_plan'],['next_meal'],'核对目标日期的实际摄入、未完成计划、库存分装、运动和本机习惯。用全天试算反馈调整餐单。','仅在用户要求安排或保存时写入计划。计划不计实际摄入或扣库。尊重用户指定份量。','列逐项、分餐和全天预计营养、差距及估算依据。'),
 define('stock','库存、采购与分装',/库存|采购|入库|补货|分装|剩余|丢弃|扔掉|用了多少|还有多少/,
  ['read_packages','read_ledger'],['split','discard','purchase','inventory'],'匹配SKU和原批次；采购使用现有采购工具。','保留价格未知和原批次，联动财务按原权限。','数量、来源、损耗和成本。'),
 define('weighing','包装称重',/称重|毛重|空瓶|瓶重|现在.{0,18}(?:克|g)|剩.{0,18}(?:克|g)/i,
  ['read_packages'],['weigh'],'先核包装和最近一次实称，再比较同一包装。','拒绝跨瓶、增长和没有依据的换算。','重量差及最新毛重。'),
 define('exercise','运动和 TDEE',/运动|骑|跑步|通勤|散步|训练|手表|watch|tdee|消耗/i,
  ['read_health_report','read_ledger'],['activity','correct_activity'],'区分通勤、专项和设备全天数据，核对重叠。','按本机能量政策计算，不重复累计。','运动口径、计入消耗和周期。'),
 define('progress','晨重和六天周期',/体重|晨重|均重|周期|缺口|减脂|趋势|全天|封账|待补/,
  ['read_cycle_report','read_health_report'],['weight','cycle','correct_weight','day_status'],'用账本结果分析逐日营养、缺口与最近有效晨重。周期结束后在首次相关互动简要复盘。','可用实际摄入纳入账面缺口，缺报记未知，可能未记全时标记缺口可能高估。','七次窗口、当前账面缺口、进度和理论脂肪当量。'),
 define('correction','历史补报和纠错',/补报|补记|漏了|更正|改成|少算|多算|昨天|前天|原记录/,
  ['read_food_history','read_health_report','read_packages'],['correct'],'定位日期、餐次、原记录和关联库存。','更正原事件，新补报才新增。','改前改后、影响日期和重新计算。'),
 define('sync','文件同步',/同步|备份|外部主账|sqlite|library|合并导入|导出/i,
  ['read_file_status'],[],'读取账本来源、已导出的回执与冲突状态，使用现有文件流程。','禁止把本机保存或文件导出描述为外部主账已同步。','本机保存、同步包生成、外部确认三个状态。'),
 define('photos','餐食多图识别',/多图|照片|截图|标签|续粉|剩菜/,
  ['read_packages'],['photo_meal'],'将同餐各图作为同一份证据，分离实吃、续份、剩余和包装标签。','同一道菜不同角度合并；无明确实吃授权只预览。','逐项来源和不确定性。'),
 define('receipts','采购截图',/截图|订单|购物|实付|退款|采购/,
  ['read_stock_receipts','write_receipt'],['receipt_order'],'合并同一订单的附件，提取付款状态、价格、商品和规格。有订单号则使用，也可用已有证据核对去重。','校验实付与分类金额，食品入库，使用待同步日志联动账本。','支出分类、库存、分摊待补及退款。'),
 define('medical','个人健康档案',/体检|化验|检查报告|症状|健康档案|指标趋势|临床|就诊/,
  ['read_medical','write_medical_report','write_medical_symptom'],['medical_read','medical_extract','medical_symptom'],'从本机查指定档案，或转录本轮明确选择的 PDF 和照片。',
  '按各次参考范围显示，保留证据；医学解释只读，医生诊断须人工录入。',
  '体检证据、待核对项目和本机保存回执。'),
 define('finance','日常收支',/记账|记帐|支出|收入|花了|付款|报销|消费/,
  ['read_ledger','read_expense_summary'],['finance_write'],'按本机启用分类校验本轮明确的一笔收支。','使用现有授权和业务校验。更正按原交易 ID 操作。','金额、分类和撤销。')
]);

// Built-in upgrades are computed at read time. The persisted user delta is
// deliberately version-neutral so rollback can read the same SKILLS_KEY.
export function storedSkills(store){
 try{
  const value=JSON.parse(store.getItem(SKILLS_KEY));
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null;}
}
const object=row=>row&&typeof row==='object'&&!Array.isArray(row);
export function skillCatalog(store){
 const saved=storedSkills(store),builtIds=new Set(HEALTH_SKILLS.map(row=>row.id));
 const legacy=legacyWorkflows.flatMap(([id,name,enabled])=>object(saved?.overrides?.[id])?
  [{id,name,enabled,version:1}]:[]);
 const custom=(Array.isArray(saved?.personal)?saved.personal:[]).filter(row=>
  typeof row?.id==='string'&&typeof row.name==='string'&&!builtIds.has(row.id));
 const rows=new Map([...HEALTH_SKILLS,...legacy,...custom].map(row=>[row.id,row]));
 return [...rows.values()].map(row=>{
  const override=object(saved?.overrides?.[row.id])?saved.overrides[row.id]:{};
  const combined={...row,...override,id:row.id,pattern:row.pattern,customized:!builtIds.has(row.id)||Object.keys(override).length>0};
  if(builtIds.has(row.id))combined.version=row.version;
  if(!builtIds.has(row.id)){
   const topics=legacyTopics.get(row.id)??(Array.isArray(combined.relatedTo)?combined.relatedTo:
    HEALTH_SKILLS.filter(skill=>skill.pattern.test(combined.name)).map(skill=>skill.id));
   combined.relatedTo=topics;
  }
  if(typeof override.text==='string'&&!Object.hasOwn(override,'steps'))combined.steps=override.text;
  combined.steps??=combined.text??'';
  for(const key of ['tools','actions'])combined[key]=Array.isArray(combined[key])?combined[key]:[];
  for(const key of ['checks','output'])combined[key]??='';
  combined.enabled=saved?.runtime?.[row.id]??override.enabled??row.enabled??true;
  return combined;
 });
}
export function setSkillEnabled(store,id,enabled){
 if(!skillCatalog(store).some(row=>row.id===id)||typeof enabled!=='boolean')throw Error('找不到 Skill');
 const old=storedSkills(store)??{};
 store.setItem(SKILLS_KEY,JSON.stringify({personal:[],overrides:{},...old,runtime:{...old.runtime,[id]:enabled}}));
}
export function selectSkills(catalog,{text='',photos=false,previousText=''}={}){
 const cue=/^(?:那|这|刚才|继续|然后)/.test(text)?previousText:'';
 const matches=skill=>skill?.pattern?.test(text+' '+cue)||photos&&['photos','intake','receipts'].includes(skill?.id);
 return catalog.filter(skill=>skill.enabled&&(matches(skill)||skill.customized&&text.includes(skill.name)||
  Array.isArray(skill.relatedTo)&&skill.relatedTo.some(id=>matches(HEALTH_SKILLS.find(builtIn=>builtIn.id===id)))));
}

// Archives fill missing preferences; settings already edited on this device win.
export function mergeSkillSettings(incoming,local){
 if(!local)return incoming;
 const map=key=>({...incoming[key],...local[key]});
 const records=key=>[...new Map([...(incoming[key]??[]),...(local[key]??[])].map(row=>[row.id,row])).values()];
 const overrides=map('overrides');
 for(const id of Object.keys(overrides))overrides[id]={...incoming.overrides?.[id],...local.overrides?.[id]};
 return {...incoming,...local,overrides,runtime:map('runtime'),personal:records('personal'),folders:records('folders')};
}
