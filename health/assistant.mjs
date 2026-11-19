import {inventoryWithMoves} from './core.mjs';
import {confirmItems, requestData, resolveItem} from './candidates.mjs';
import {matches, resultSchema, units, validInput, nutrientKeys} from './contract.mjs';
import {ENDPOINT} from './endpoint.mjs';

const $ = id => document.getElementById(id);
const labels = {kcal:'热量 kcal',protein:'蛋白质 g',carbs:'碳水 g',fat:'脂肪 g',sodium:'钠 mg'};
const actions = {eat:'已吃',plan:'计划',add:'入库',remove:'出库'};
async function jpeg(file) {
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
function editRow(container, original, state, planOnly) {
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
      const {sku,stockQty,nutrition} = resolveItem(state,c);
      const delta = c.action==='plan' ? '计划不扣库' : sku ? `库存变化 ${stockQty==null?'待核对':(c.action==='add'?'+':'−')+Number(stockQty.toFixed(3))+' '+sku.unit}` : c.action==='add' ? '创建库存食品' : '未关联库存';
      output.textContent = Object.entries(nutrition).map(([k,v])=>labels[k]+' '+(v??'待补')).join(' · ') + ' ｜ '+delta;
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
  bind(grid,'动作','action',{choices:planOnly ? [['plan','计划']] : Object.entries(actions)});
  bind(grid,'数量','amount',{type:'number'});
  bind(grid,'单位','unit',{choices:pairs(units)});
  bind(params,'单包装净含量','packageSize',{type:'number'});
  bind(params,'净含量单位','packageUnit',{choices:[['','未知'],...pairs(['g','mL'])]});
  bind(params,'营养基准份量','basisAmount',{type:'number'});
  bind(params,'基准单位','basisUnit',{choices:pairs(units)});
  for (const k of nutrientKeys) bind(params,labels[k],k,{type:'number'},c.nutrients);
  block.append(details,output); container.append(block); update();
  return () => keep.checked ? c : null;
}

export function attachAssistant({getState,commit,today}) {
  const form = $('assistant-form'), review = $('candidate-form'), status = $('assistant-status');
  if (!window.airplaneAccount?.bearer) { $('assistant-guest').hidden=false; return; }
  form.hidden=false;
  let prepared=null, rows=[], version=0, busy=false, baseRevision=0;
  const send=$('send-request');
  function reset() {
    version++; prepared=null; rows=[]; review.hidden=true;
    $('candidate-list').replaceChildren(); $('send-preview').hidden=true;
    $('send-fields').textContent=''; $('send-image').removeAttribute('src');
    status.textContent='';
  }
  form.oninput=()=>{ reset(); $('photo-label').hidden=form.elements.mode.value!=='photo'; };
  $('discard').onclick=reset;
  form.onsubmit=async e=>{
    e.preventDefault(); reset();
    const id=version;
    try {
      const mode=form.elements.mode.value;
      const photo=mode==='photo' ? await jpeg(form.elements.image.files[0]) : null;
      if (id!==version) return;
      const data=requestData(getState(),mode,form.elements.text.value.trim(),photo,today(),form.elements.catalog.checked);
      if (!validInput(data)) throw Error('请检查输入文字、库存参数或照片');
      baseRevision=getState().revision ?? 0;
      const {photo:picture,...fields}=data;
      $('send-description').textContent='经授权服务发送本次文字'+(photo?'、下方压缩照片':'')+'和所列字段。'+(mode==='plan'?'规划使用今日汇总、目标和所选库存价格。':'')+'完整账本、照片元数据及财务记录保留在本机。';
      $('send-fields').textContent=JSON.stringify(fields,null,2);
      $('send-image').hidden=!picture; if (picture) $('send-image').src=picture;
      prepared=data; $('send-preview').hidden=false; send.disabled=busy;
    } catch (err) { status.textContent=err.message; }
  };
  send.onclick=async ()=>{
    if (busy || !prepared) return;
    if (!navigator.onLine) { status.textContent='当前离线，可继续手动记录'; return; }
    const id=version, data=prepared;
    busy=true; send.disabled=true; status.textContent='正在生成候选…';
    try {
      const res=await fetch(ENDPOINT,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
        referrerPolicy:'no-referrer',signal:AbortSignal.timeout(60000),
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+window.airplaneAccount.bearer},body:JSON.stringify(data)});
      if (id!==version) return;
      if (!res.headers.get('Content-Type')?.includes('application/json')) throw Error('智能服务尚未接通，请检查 Worker 地址');
      const result=await res.json();
      if (id!==version) return;
      if (!res.ok) throw Error(result.error || '请求失败');
      if (!matches(resultSchema,result)) throw Error('服务返回的候选格式无效');
      prepared=null; $('send-preview').hidden=true; $('send-image').removeAttribute('src'); $('send-fields').textContent='';
      if (!result.items.length) { status.textContent=result.note || '未识别到食物'; return; }
      $('candidate-note').textContent=result.note; review.elements.date.value=today();
      rows=result.items.map(c=>editRow($('candidate-list'),c,getState(),data.mode==='plan'));
      review.hidden=false; status.textContent='候选已生成，核对后可入账。';
    } catch (err) { if (id===version) status.textContent=err.name==='TypeError'?'无法连接智能服务，请检查网络和 Worker 地址':err.message; }
    finally { busy=false; send.disabled=false; }
  };
  review.onsubmit=async e=>{
    e.preventDefault();
    const button=review.querySelector('[type=submit]');
    if (button.disabled) return; button.disabled=true;
    try {
      if ((getState().revision ?? 0)!==baseRevision) throw Error('账本已变更，请重新生成预览');
      const items=rows.map(read=>read()).filter(Boolean);
      if (!items.length || !matches(resultSchema,{items,note:''})) throw Error('请勾选候选并核对食品、份量和营养字段');
      await commit(confirmItems(getState(),items,review.elements.date.value,review.elements.meal.value),'已保存确认的记录');
      reset(); form.reset(); $('photo-label').hidden=true; status.textContent='已保存确认的记录';
    } catch (err) { status.textContent=err.message; }
    finally { button.disabled=false; }
  };
}
