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
  sku:optional(string(80,1)), name:string(80,1), action:choice('eat','plan','add','remove'),
  amount:number(100000,0.001), unit, packageSize:optional(number(100000,0.001)),
  packageUnit:optional(choice('g','mL')), basisAmount:number(100000,0.001), basisUnit:unit,
  nutrients, uncertainty:string(240,1)
});
export const resultSchema = object({note:string(400), items:list(item,8)});
const catalogItem = object({
  id:string(80,1), name:string(80,1), unit:string(32), standard:string(100),
  basis:string(20), qty:optional(number(1e8)), price:optional(number(1e7)),
  priceBasis:string(100), nutrients:optional(nutrients)
});
export const inputSchema = object({
  mode:choice('entry','photo','plan'), text:string(600), catalog:list(catalogItem,16),
  summary:optional(object({totals:optional(nutrients), calorieTarget:number(8000),
    proteinMin:number(1000), fatMin:number(1000), cycleDays:number(31,1), cycleTarget:number(30000)})),
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
export function validInput(data) {
  if (!matches(inputSchema,data)) return false;
  if (data.mode === 'photo') {
    if (!data.photo?.startsWith('data:image/jpeg;base64,/9j/') ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data.photo.slice(23))) return false;
  } else if (data.photo !== null) return false;
  return (data.mode !== 'entry' || !!data.text.trim()) && (data.mode === 'plan' ? !!data.summary : data.summary === null);
}
