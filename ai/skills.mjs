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
