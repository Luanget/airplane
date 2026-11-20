export const mealOrder=['晚餐','午餐','早午餐','早餐','加餐','未分餐'];
export function timelineGroup({meal}){
 const label=String(meal??'');
 if(/早午餐|早午饭/.test(label))return '早午餐';
 if(/早餐|早饭|早点/.test(label))return '早餐';
 if(/午餐|午饭|中餐|中饭/.test(label))return '午餐';
 if(/晚餐|晚饭/.test(label))return '晚餐';
 if(/加餐|夜宵|宵夜/.test(label))return '加餐';
 return '未分餐';
}

export function eatingState(row){
 if(row.actual===true||row.status==='actual')return 'actual';
 const status=String(row.status??'');
 if(status==='cancelled'||/取消|作废|失效|未吃|覆盖|superseded/i.test(status))return 'cancelled';
 return status==='plan'||/计划|待定/.test(status)?'plan':'unknown';
}

export function stockName(row){
 if(row.unitDescription===undefined)return row.name;
 return row.name.replace(/[（(]([^（）()]*)[）)]/g,(all,note)=>
  /^(?:新旧同款|新购同款|已确认同款|待核实照片标签|具体品牌规格待核|照片中水果|通用估值|含核称重|切根|\d{1,2}\/\d{1,2}熟制)(?:[，,；;、 ]|$)/.test(note)?'':all).trim();
}
export function stockUnit(unit){
 return /^完整袋/.test(unit)?'袋':String(unit).split(/[（(;；]/,1)[0].trim();
}
export function stockGroups(rows){
 const groups=new Map();
 for(const row of rows){
  const name=stockName(row),unit=stockUnit(row.unit);
  const key=name.normalize('NFKC').toLowerCase().replace(/\s/g,'')+'\0'+unit;
  if(!groups.has(key))groups.set(key,{name,rows:[]});
  groups.get(key).rows.push(row);
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
