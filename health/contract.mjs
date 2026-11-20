// The same closed shapes validate the HTTP boundary and the model's strict output.
const string = (maxLength, minLength=0) => ({type:'string', minLength, maxLength});
const number = (maximum, minimum=0) => ({type:'number', minimum, maximum});
const choice = (...values) => ({type:'string', enum:values});
const list = (items, maxItems) => ({type:'array', items, maxItems});
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
export const resultSchema = object({note:string(400), items:list(item,8)});
export const activitySchema=object({note:string(400),activity:optional(object({
 name:string(80,1),km:optional(number(1000)),minutes:optional(number(1440)),kcal:optional(number(20000)),
 energyKind:choice('activity','total'),quality:choice('estimated','device'),includedInBase:choice('yes','no'),
 uncertainty:string(240)
}))});
export const purchaseSchema=object({note:string(400),total:optional(number(1e7)),items:list(object({
 ...item.properties,itemCost:optional(number(1e7))
}),8)});
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
    case 'string': return typeof x === 'string' && (s.enum ? s.enum.includes(x) : x.length >= s.minLength && x.length <= s.maxLength);
    case 'array': return Array.isArray(x) && x.length <= s.maxItems && x.every(v => matches(s.items,v));
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
export function validFinanceEntry(entry,input) {
  return calendarDate(entry.date) && entry.date<=input.date
    && Math.abs(entry.amount*100-Math.round(entry.amount*100))<0.00001
    && input.categories.some(c=>c.id===entry.categoryId && c.type===entry.type);
}
export function validInput(data) {
  if (data?.mode==='finance') return matches(financeInput,data) && !!data.text.trim() && calendarDate(data.date);
  if (!matches(inputSchema,data)) return false;
  if (data.mode === 'photo') {
    if (!data.photo?.startsWith('data:image/jpeg;base64,/9j/') ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data.photo.slice(23))) return false;
  } else if (data.photo !== null) return false;
  return (!['entry','activity','purchase'].includes(data.mode) || !!data.text.trim()) && (data.mode === 'plan' ? !!data.summary : data.summary === null);
}
