// Legacy preference storage stays readable for the one-time memory migration.
export const SKILLS_KEY='airplane-ai-skills-v2';
const builtInNames=[
 ['l-data','L · 数据与纠错规范',true],
 ['l-record','L · 记录与纠错',true],
 ['l-meals','L · 配餐与营养',true],
 ['l-stock','L · 库存与采购',true],
 ['l-progress','L · 运动与周期',true],
 ['l-food-preferences','L · 餐食偏好',false],
];
export function migratedPreferences(store,legacyKey='airplane-ai-skill-v1'){
 let previous;
 try{previous=JSON.parse(store.getItem(SKILLS_KEY));}catch{}
 if(previous&&Array.isArray(previous.personal)){
  const customized=builtInNames.flatMap(([id,name,enabled])=>{
   const row=previous.overrides?.[id];
   return typeof row?.text==='string'?[{id,name,text:row.text,enabled:row.enabled??enabled}]:[];
  });
  return [...customized,...previous.personal].filter(row=>typeof row?.id==='string'&&typeof row.name==='string'&&typeof row.text==='string')
   .map(({id,name,text,enabled})=>({id,name,text,enabled:enabled!==false}));
 }
 const text=store.getItem(legacyKey)?.trim();
 return text?[{id:'legacy-preference',name:'原有个人偏好',text,enabled:true}]:[];
}

// These definitions are data. Only the application's scoped operations run.
const define=(id,name,pattern,tools,actions,steps,checks,output)=>Object.freeze({
 id,name,version:1,pattern,tools:Object.freeze(tools),actions:Object.freeze(actions),steps,checks,output
});
export const HEALTH_SKILLS=Object.freeze([
 define('intake','饮食记录',/吃|喝|早餐|午餐|晚餐|营养|续粉|饮食|外食/,
  ['read_health_report','read_packages'],['eat'],'定位餐次和食品，区分实吃与计划，按证据匹配SKU和份量。','实际才入账；同一食物或照片不能重记。','逐项营养、餐次及全天。'),
 define('meals','餐单规划',/安排|配餐|计划|下一餐|吃什么|恢复|晚饭|食谱/,
  ['read_health_report','read_packages'],['next_meal'],'读取当天实际和在库分装，应用启用的长期偏好。','计划只读，候选不能超出真实库存；高热量外食后正常用餐。','逐项、整餐和执行后的条件合计。'),
 define('stock','库存、采购与分装',/库存|采购|入库|补货|分装|剩余|丢弃|扔掉|用了多少|还有多少/,
  ['read_packages','read_ledger'],['split','discard','purchase','inventory'],'匹配SKU和原批次；采购使用现有采购工具。','保留价格未知和原批次，联动财务按原权限。','数量、来源、损耗和成本。'),
 define('weighing','包装称重',/称重|毛重|空瓶|瓶重|现在.{0,18}(?:克|g)|剩.{0,18}(?:克|g)/i,
  ['read_packages'],['weigh'],'先核包装和最近一次实称，再比较同一包装。','拒绝跨瓶、增长和没有依据的换算。','重量差及最新毛重。'),
 define('exercise','运动和 TDEE',/运动|骑|跑步|通勤|散步|训练|手表|watch|tdee|消耗/i,
  ['read_health_report','read_ledger'],['activity','correct_activity'],'区分通勤、专项和设备全天数据，核对重叠。','按本机能量政策计算，不重复累计。','运动口径、计入消耗和周期。'),
 define('progress','晨重和六天周期',/体重|晨重|均重|周期|缺口|减脂|趋势/,
  ['read_health_report','read_ledger'],['weight','cycle','correct_weight'],'按日期查询有效晨重和周期。','缺报不记为零，正式和条件分开。','七次窗口、正式缺口、进度和理论脂肪当量。'),
 define('correction','历史补报和纠错',/补报|补记|漏了|更正|改成|少算|多算|昨天|前天|原记录/,
  ['read_food_history','read_health_report','read_packages'],['correct'],'定位日期、餐次、原记录和关联库存。','更正原事件，新补报才新增。','改前改后、影响日期和重新计算。'),
 define('sync','文件同步',/同步|备份|外部主账|sqlite|library|合并导入|导出/i,
  ['read_health_status'],[],'读取账本来源、已导出的回执与冲突状态，使用现有文件流程。','禁止把本机保存或文件导出描述为外部主账已同步。','本机保存、同步包生成、外部确认三个状态。'),
 define('photos','餐食多图识别',/多图|照片|截图|标签|续粉|剩菜/,
  ['read_packages'],['photo_meal'],'将同餐各图作为同一份证据，分离实吃、续份、剩余和包装标签。','同一道菜不同角度合并；无明确实吃授权只预览。','逐项来源和不确定性。')
]);

export function skillCatalog(store){
 let saved;
 try{saved=JSON.parse(store.getItem(SKILLS_KEY));}catch{}
 return HEALTH_SKILLS.map(skill=>({...skill,enabled:saved?.runtime?.[skill.id]!==false}));
}
export function setSkillEnabled(store,id,enabled){
 if(!HEALTH_SKILLS.some(row=>row.id===id)||typeof enabled!=='boolean')throw Error('找不到健康 Skill');
 const raw=store.getItem(SKILLS_KEY),prior=raw?JSON.parse(raw):{};
 const old=prior&&typeof prior==='object'&&!Array.isArray(prior)?prior:{};
 store.setItem(SKILLS_KEY,JSON.stringify({personal:[],overrides:{},...old,runtime:{...old.runtime,[id]:enabled}}));
}
export function selectSkills(catalog,{text='',photos=false,previousText=''}={}){
 const cue=/^(?:那|这|刚才|继续|然后)/.test(text)?previousText:'';
 return catalog.filter(skill=>skill.enabled&&(skill.pattern.test(text+' '+cue)||photos&&['photos','intake'].includes(skill.id)));
}
export function assertSkillAction(catalog,kind){
 const skill=catalog.find(row=>row.actions.includes(kind));
 if(skill&&!skill.enabled)throw Error('「'+skill.name+'」已停用，请先在设置启用。');
}
