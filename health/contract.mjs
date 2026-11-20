// The same closed shapes validate the HTTP boundary and the model's strict output.
const string = (maxLength, minLength=0) => ({type:'string', minLength,...(maxLength===undefined?{}:{maxLength})});
const number = (maximum, minimum=0) => ({type:'number', minimum, maximum});
const choice = (...values) => ({type:'string', enum:values});
const list = (items, maxItems) => ({type:'array',items,...(maxItems===undefined?{}:{maxItems})});
const object = properties => ({type:'object', properties, required:Object.keys(properties), additionalProperties:false});
const optional = schema => ({anyOf:[schema,{type:'null'}]});
export const nutrientKeys = ['kcal','protein','carbs','fat','sodium'];
const nutrients = object(Object.fromEntries(nutrientKeys.map(k => [k, optional(number(100000))])));
export const units = ['g','mL','包','个','份','盒','瓶','袋'];
const unit = choice(...units);
const item = object({
  sku:optional(string(80,1)), name:string(80,1), action:choice('eat','plan','add','remove','label'),
  amount:number(100000,0.001), unit, packageSize:optional(number(100000,0.001)),
  packageUnit:optional(choice('g','mL')), basisAmount:number(100000,0.001), basisUnit:unit,
  nutrients, uncertainty:string(240,1),
  weighing:optional(object({before:number(100000,0.001),after:optional(number(100000)),tare:optional(number(100000))}))
});
export const resultSchema = object({note:string(400), items:list(item)});
const chatEntrySchema=object({note:string(400),items:list(object({
  ...item.properties,stockSource:choice('one_off','inventory')
}))});
export const activitySchema=object({note:string(400),activity:optional(object({
 name:string(80,1),km:optional(number(1000)),minutes:optional(number(1440)),kcal:optional(number(20000)),
 energyKind:choice('activity','total'),quality:choice('estimated','device'),includedInBase:choice('yes','no'),
 uncertainty:string(240)
}))});
export const purchaseSchema=object({note:string(400),total:optional(number(1e7)),items:list(object({
 ...item.properties,itemCost:optional(number(1e7))
}))});
const catalogItem = object({
  id:string(80,1), name:string(80,1), unit:string(32), standard:string(100),
  basis:string(20), qty:optional(number(1e8)), price:optional(number(1e7)),
  priceBasis:string(100), nutrients:optional(nutrients)
});
export const inputSchema = object({
  mode:choice('entry','photo','plan','activity','purchase'), text:string(600), catalog:list(catalogItem,16),
  summary:optional(object({totals:optional(nutrients), calorieTarget:number(8000),
    proteinMin:number(1000), fatMin:number(1000), cycleDays:number(31,1), cycleTarget:number(30000),
    cycleDeficit:optional(number(100000,-100000)),closedDays:number(31),preferences:string(300),
    recent:list(object({date:string(10,10),kcal:optional(number(100000)),protein:optional(number(10000))}),3)})),
  photo:optional(string(720000))
});

export function matches(s, x) {
  if (s.anyOf) return s.anyOf.some(part => matches(part,x));
  switch (s.type) {
    case 'null': return x === null;
    case 'number': return Number.isFinite(x) && x >= s.minimum && x <= s.maximum;
    case 'string': return typeof x === 'string' && (s.enum ? s.enum.includes(x) : x.length >= s.minLength && (s.maxLength===undefined||x.length<=s.maxLength));
    case 'array': return Array.isArray(x) && x.length>=(s.minItems??0)
      && (s.maxItems===undefined||x.length<=s.maxItems) && x.every(v => matches(s.items,v));
    case 'object': return x !== null && typeof x === 'object' && !Array.isArray(x)
      && Object.keys(x).length === s.required.length && s.required.every(k => Object.hasOwn(x,k) && matches(s.properties[k],x[k]));
    default: return false;
  }
}
const calendarDate = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const type=choice('expense','income');
const financeInput=object({mode:choice('finance'),text:string(600,1),date:string(10,10),
  categories:list(object({id:string(100,1),name:string(100,1),type}),200)});
export const financeSchema=object({note:string(400),entry:optional(object({
  type,amount:number(100000000,0.01),categoryId:string(100,1),date:string(10,10),note:string(200)
}))});
const conversationTurn=object({role:choice('user','assistant'),text:string(32000,1)});
export const contextSchema=object({summary:string(4000,1)});
const chatInput=object({mode:choice('chat'),text:string(1600),date:string(10,10),
  photo:optional(string(720000)),history:list(conversationTurn,72)});
const proposal=(mode,result)=>object({mode:choice(mode),date:optional(string(10,10)),result});
const ledgerOperations=[
  proposal('finance',financeSchema),proposal('activity',activitySchema),
  proposal('purchase',purchaseSchema),proposal('entry',chatEntrySchema),proposal('plan',resultSchema),
  proposal('food_edit',object({name:string(80,1),amount:number(100000,0.001),unit,
   meal:optional(string(24,1)),time:optional(string(5,5))})),
  proposal('inventory',object({operation:choice('count','shopping'),name:string(80,1),quantity:number(100000),unit})),
  proposal('portions',object({name:string(80,1),quantities:{...list(number(100000,0.001)),minItems:1},unit}))
];
const dataset=choice('health_settings','foods','weights','activities','inventory','batches','stock_moves',
  'purchases','shopping','templates','legacy_days','legacy_energy','legacy_rules','transactions',
  'categories','budgets','balances','finance_settings','skills','conversations','assistant_settings');
export const appDataReadSchema=object({
 dataset:choice(...dataset.enum,'guide','conversation_messages','local_usage','import_info','app_info'),
 id:optional(string(240,1)),date:optional(string(10,7)),query:string(),fields:list(string(60,1))
});
export const appDataEditSchema=object({dataset,id:optional(string(240,1)),action:choice('add','update','delete'),changes:string()});
export const chatSchema=object({reply:string(undefined,1),proposal:{anyOf:[
  {type:'null'},...ledgerOperations,
  proposal('app_data_edit',appDataEditSchema),
  proposal('delete_record',object({kind:choice('food','plan','weight','activity','finance'),
    query:string(),meal:optional(choice('早餐','午餐','晚餐','加餐'))})),
  proposal('skill',object({name:optional(string(60,1)),text:string(800,1)})),
  proposal('batch',object({operations:{...list({anyOf:ledgerOperations}),minItems:1},next:choice('done','continue')}))
]}});
export const ledgerReadSchema=object({scope:choice('stock','stock_alerts','meal','nutrition','expenses','balance','budget','weight','cycle'),query:string()});
export const foodHistoryReadSchema=object({date:string(10,10),query:string()});
export const expenseSummaryReadSchema=object({start:string(10,10),end:string(10,10),groupBy:choice('category','day','month')});
const jpegPhoto=photo=>photo?.startsWith('data:image/jpeg;base64,/9j/') &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(photo.slice(23));
export function validFinanceEntry(entry,input) {
  return calendarDate(entry.date) && entry.date<=input.date
    && Math.abs(entry.amount*100-Math.round(entry.amount*100))<0.00001
    && (!input.categories.length || input.categories.some(c=>c.id===entry.categoryId && c.type===entry.type));
}
export function validInput(data) {
  if (data?.mode==='chat') return matches(chatInput,data)&&calendarDate(data.date)
    && data.history.reduce((sum,row)=>sum+row.text.length,0)<=32000
    && (data.photo===null||jpegPhoto(data.photo)) && (!!data.text.trim()||!!data.photo);
  if (data?.mode==='finance') return matches(financeInput,data) && !!data.text.trim() && calendarDate(data.date);
  if (!matches(inputSchema,data)) return false;
  if (data.mode === 'photo') {
    if (!jpegPhoto(data.photo)) return false;
  } else if (data.photo !== null) return false;
  return (data.mode==='photo'||!!data.text.trim()) && (data.mode==='plan'||data.summary===null);
}
// Deliberately accepts only manually supplied fields. Ledger state is resolved
// in the UI after the model result has returned.
export function assistantInput({mode,text,photo=null,date}){
  return mode==='finance'?{mode,text,date,categories:[]}:{mode,text,photo,catalog:[],summary:null};
}
