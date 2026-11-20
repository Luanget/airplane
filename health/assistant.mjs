import {syncCalendarFields} from '../calendar.mjs';
import {cents,newPurchaseId,recordPurchase} from './purchases.mjs';
import {saveSku} from './inventory.mjs';
import {inventoryWithMoves,recordEvent,numeric,validDate} from './core.mjs';
import {confirmItems, resolveItem} from './candidates.mjs';
import {matches, resultSchema, activitySchema, purchaseSchema, units, nutrientKeys} from './contract.mjs';

const labels = {kcal:'热量 kcal',protein:'蛋白质 g',carbs:'碳水 g',fat:'脂肪 g',sodium:'钠 mg'};
const actions = {eat:'已吃',plan:'计划',add:'入库',remove:'出库',label:'保存标签'};
export async function jpeg(file) {
  if (!file || !file.type.startsWith('image/') || file.size > 16*1024*1024) throw Error('请选择 16 MB 以内的照片');
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url;
    await img.decode();
    const scale = Math.min(1,1024/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const data = canvas.toDataURL('image/jpeg',0.76);
    if (data.length>720000) throw Error('图片仍过大，请裁剪后重选');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

function field(parent, title, options={}) {
  const label = document.createElement('label');
  label.textContent=title;
  const el = document.createElement(options.choices ? 'select' : 'input');
  if (options.choices) for (const [key,text] of options.choices) el.add(new Option(text,key));
  else {
    el.type = options.type || 'text';
    if (el.type === 'number') { el.min='0'; el.step='any'; }
  }
  el.value = options.value ?? '';
  label.append(el); parent.append(label);
  return el;
}
const pairs = values => values.map(x=>[x,x]);
function editRow(container, original, state, mode) {
  const c = structuredClone(original);
  const block = document.createElement('fieldset');
  const legend = document.createElement('legend');
  const keep = document.createElement('input');
  keep.type='checkbox'; keep.checked=true; keep.setAttribute('aria-label','保留这项');
  legend.append(keep,' '+c.name); block.append(legend);
  const desc = document.createElement('p'); desc.textContent=c.uncertainty; block.append(desc);
  const grid = document.createElement('div'); grid.className='form-grid'; block.append(grid);
  const stock = inventoryWithMoves(state).filter(s=>s.active);
  if (!c.sku) {
    const exact=stock.filter(s=>s.name.trim()===c.name.trim());
    if (exact.length===1) c.sku=exact[0].id;
  }
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent='规格与基准营养'; details.append(summary);
  const params=document.createElement('div'); params.className='form-grid'; details.append(params);
  const output = document.createElement('p');
  function update() {
    try {
      const {sku,stockQty,nutrition,amount,unit} = resolveItem(state,c);
      const delta = c.action==='plan' ? '计划不扣库' : sku ? `库存变化 ${stockQty==null?'待核对':(c.action==='add'?'+':'−')+Number(stockQty.toFixed(3))+' '+sku.unit}` : c.action==='add' ? '创建库存食品' : '未关联库存';
      output.textContent = amount+' '+unit+' ｜ '+Object.entries(nutrition).map(([k,v])=>labels[k]+' '+(v??'待补')).join(' · ') + ' ｜ '+delta;
    } catch (err) { output.textContent=err.message; }
  }
  function bind(parent,title,key,opts,target=c) {
    const el=field(parent,title,{...opts,value:target[key]});
    el.addEventListener('input',()=>{
      target[key] = el.value === '' ? null : el.type==='number' ? el.valueAsNumber : el.value;
      update();
    });
  }
  bind(grid,'食品名称','name',{});
  bind(grid,'匹配食品','sku',{choices:[['','自定义食品'],...stock.map(s=>[s.id,s.name])]});
  bind(grid,'动作','action',{choices:mode==='plan' ? [['plan','计划']] : mode==='purchase' ? [['add','入库']] : Object.entries(actions)});
  bind(grid,'数量','amount',{type:'number'});
  if (mode==='purchase')bind(grid,'此项实付 ¥','itemCost',{type:'number'});
  bind(grid,'单位','unit',{choices:pairs(units)});
  bind(params,'单包装净含量','packageSize',{type:'number'});
  bind(params,'净含量单位','packageUnit',{choices:[['','未知'],...pairs(['g','mL'])]});
  bind(params,'营养基准份量','basisAmount',{type:'number'});
  bind(params,'基准单位','basisUnit',{choices:pairs(units)});
  for (const k of nutrientKeys) bind(params,labels[k],k,{type:'number'},c.nutrients);
  if(c.weighing){
    bind(params,'称重前毛重 g','before',{type:'number'},c.weighing);
    bind(params,'称重后毛重 g','after',{type:'number'},c.weighing);
    bind(params,'空包装重 g','tare',{type:'number'},c.weighing);
    const clear=document.createElement('button');clear.type='button';clear.textContent='改用手填份量';
    clear.onclick=()=>{c.weighing=null;clear.disabled=true;update();};params.append(clear);
  }
  block.append(details,output); container.append(block); update();
  return () => keep.checked ? c : null;
}

function editActivity(panel,item){
 const name=field(panel,'活动名称',{value:item.name});
 const km=field(panel,'距离 km',{type:'number',value:item.km});
 const minutes=field(panel,'时长 分钟',{type:'number',value:item.minutes});
 const kcal=field(panel,'热量 kcal',{type:'number',value:item.kcal});
 const energyKind=field(panel,'热量口径',{choices:[['activity','本次活动'],['total','设备全天总消耗']],value:item.energyKind});
 const includedInBase=field(panel,'计入基础 TDEE',{choices:[['yes','已包含'],['no','另外计算']],value:item.includedInBase});
 const quality=field(panel,'来源',{choices:[['estimated','估算'],['device','手表或设备']],value:item.quality});
 const uncertainty=field(panel,'备注',{value:item.uncertainty});
 return ()=>({name:name.value.trim(),km:numeric(km.value),minutes:numeric(minutes.value),kcal:numeric(kcal.value),
  energyKind:energyKind.value,quality:quality.value,includedInBase:includedInBase.value,uncertainty:uncertainty.value});
}
function approvedPurchase(state,items,date,total) {
 const next=structuredClone(state);
 const rows=items.map(c=>{
  const {sku,stockQty,amount,unit}=resolveItem(next,c);
  if(sku&&stockQty===null)throw Error('请核对采购份量的库存单位');
  const foodId=sku?.id??saveSku(next,{name:c.name,unit,basisUnit:c.basisUnit,basisAmount:c.basisAmount,
    ...c.nutrients,quality:'estimated',source:c.uncertainty,packageSize:c.packageSize,packageUnit:c.packageUnit}).id;
  return {foodId,quantity:stockQty??amount,costCents:c.itemCost===null?null:cents(c.itemCost),expires:null};
 });
 recordPurchase(next,{id:newPurchaseId(),date,items:rows,totalCents:cents(total),financeId:null,note:'AI 候选采购'});
 return next;
}
export function healthReview(container, proposal, state, today) {
  const {mode,result}=proposal;
  if(!result.activity&&!result.items?.length)return null;
  const heading={activity:'运动记录',purchase:'采购与入库',plan:'饮食计划',entry:'饮食或库存记录'}[mode];
  const title=document.createElement('h3');title.textContent=heading;container.append(title);
  if(result.note){const note=document.createElement('p');note.textContent=result.note;container.append(note);}
  const dates=document.createElement('div');dates.className='form-grid';container.append(dates);
  const date=field(dates,'日期',{type:'date',value:validDate(proposal.date)?proposal.date:today});
  date.required=true;
  const meal=result.items?.some(c=>['eat','plan'].includes(c.action))?
    field(dates,'餐次',{choices:pairs(['早餐','午餐','晚餐','加餐']),value:mode==='plan'?'晚餐':'午餐'}):null;
  const extras=document.createElement('div');extras.className='form-grid';container.append(extras);
  const activities=mode==='activity'?editActivity(extras,result.activity):null;
  const totalField=mode==='purchase'?field(extras,'实付总额 ¥',{type:'number',value:result.total}):null;
  if(totalField)totalField.required=true;
  const rows=(result.items??[]).map(c=>editRow(container,c,state,mode));
  syncCalendarFields(container);
  return {
    label:mode==='plan'?'保存为饮食计划':mode==='purchase'?'确认采购入库':'确认保存',
    apply(current) {
      if(!validDate(date.value))throw Error('请选择记录日期');
      if(mode==='activity'){
        const activity=activities();
        if(!matches(activitySchema,{activity,note:''}))throw Error('请核对活动名称和数值');
        const next=structuredClone(current);
        recordEvent(next,'activities',{...activity,date:date.value,includedInBase:activity.energyKind==='activity'&&activity.includedInBase==='yes'});
        return next;
      }
      const items=rows.map(read=>read()).filter(Boolean);
      const purchase=mode==='purchase',total=purchase?numeric(totalField.value):null;
      if(!items.length||!matches(purchase?purchaseSchema:resultSchema,{items,note:'',...(purchase?{total}:{})}))
        throw Error('请勾选候选并核对份量和营养字段');
      if(purchase&&total===null)throw Error('请填写订单实付总额');
      return purchase?approvedPurchase(current,items,date.value,total):confirmItems(current,items,date.value,meal?.value??'午餐');
    },
    saved:mode==='purchase'?'采购已入库，可在库存页关联支出。':mode==='plan'?'已保存饮食计划。':'记录已保存。'
  };
}
