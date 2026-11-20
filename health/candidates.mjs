import {inventoryWithMoves, addFood, localStockChange, round, makeId} from './core.mjs';
import {measuredGrams,saveSku} from './inventory.mjs';
import {nutrientKeys} from './contract.mjs';

const unitOf = u => ({'袋':'包','克':'g','毫升':'mL','ml':'mL'})[u] ?? u;
const packed = u => ['包','盒','瓶','个','份'].includes(unitOf(u));
export function basis(sku) {
  if (sku.basisUnit) return [sku.basisAmount, sku.basisUnit];
  if (sku.nutritionBasis === 'per100g') return [100,'g'];
  if (sku.nutritionBasis === 'per100ml') return [100,'mL'];
  // A serving of a package is not necessarily the package itself.
  const explicit = sku.standard.match(/(?:每|整|1)\s*(包|袋|盒|瓶|个|份)/);
  const mass = sku.standard.trim().match(/^(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)$/i);
  const packageBasis = sku.standard.match(/(?:g|克|ml|毫升)\s*[/／]\s*(包|袋|盒|瓶|个|份)/i);
  if (packageBasis) return [1,packageBasis[1]];
  if (mass) return [+mass[1],unitOf(mass[2].toLowerCase())];
  return [1,explicit?.[1] ?? '份'];
}

function packageInfo(sku, c) {
  const match = sku?.standard.match(/(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)\s*[/／]\s*(包|袋|盒|瓶|个|份)/i);
  if (match) return {size:+match[1], measure:unitOf(match[2].toLowerCase()), pack:unitOf(match[3])};
  return {size:sku?.packageSize ?? c.packageSize, measure:sku?.packageUnit ?? c.packageUnit,
    pack:unitOf(sku?.pack ?? (packed(c.unit) ? c.unit : packed(sku?.unit) ? sku.unit : c.basisUnit))};
}

function convert(amount, from, to, pack) {
  from = unitOf(from); to = unitOf(to);
  if (from === to) return amount;
  if (pack.size > 0 && pack.measure && packed(pack.pack)) {
    if (from === pack.pack && to === pack.measure) return amount * pack.size;
    if (from === pack.measure && to === pack.pack) return amount / pack.size;
  }
  return null;
}

export function manualStockQty(sku, amount) {
  const [,from] = basis(sku);
  return convert(amount, from, sku.unit, packageInfo(sku, {unit:from,basisUnit:from}));
}

// One path handles the preview and the eventual write. No model-supplied totals.
export function resolveItem(state, c) {
  if (c.weighing)c={...c,amount:measuredGrams(c.weighing),unit:'g'};
  if (!Number.isFinite(c.amount) || c.amount <= 0 || c.amount > 100000) throw Error('请核对份量');
  const sku = c.sku ? inventoryWithMoves(state).find(s => s.active && s.id === c.sku) : null;
  if (c.sku && !sku) throw Error('库存食品已变更，请重新选择');
  const [n, unit] = sku ? basis(sku) : [c.basisAmount,c.basisUnit];
  const pack = packageInfo(sku,c);
  const stockQty = sku ? convert(c.amount,c.unit,sku.unit,pack) : null;
  const labelAmount = convert(c.amount,c.unit,unit,pack);
  // Fill missing SKU fields only when the model supplied a convertible estimate.
  const modelAmount = convert(c.amount,c.unit,c.basisUnit,pack);
  const nutrition = Object.fromEntries(nutrientKeys.map(k => {
    if (sku?.nutrition[k] != null)
      return [k,labelAmount === null ? null : round(sku.nutrition[k]*labelAmount/n,2)];
    return [k,modelAmount === null || c.nutrients[k] === null ? null : round(c.nutrients[k]*modelAmount/c.basisAmount,2)];
  }));
  return {sku, stockQty, nutrition, pack,amount:c.amount,unit:c.unit};
}
export function confirmItems(current, candidates, date, meal) {
  const next = structuredClone(current);
  for (const c of candidates) {
    const {sku,stockQty,nutrition,pack,amount,unit} = resolveItem(next,c);
    if(c.action==='label'){
      saveSku(next,{id:sku?.id,name:c.name,unit:sku?.unit??c.unit,basisUnit:c.basisUnit,basisAmount:c.basisAmount,
        ...c.nutrients,quality:'estimated',source:'确认 AI 读取的标签',packageSize:c.packageSize,packageUnit:c.packageUnit,
        price:sku?.priceBasis===sku?.unit?sku?.pricePerUnit:null,minimum:sku?.minimum,stage:sku?.stage,stockStage:sku?.stockStage});
      continue;
    }
    if (['add','remove'].includes(c.action)) {
      if (!sku && c.action === 'remove') throw Error('出库需要选择已有食品');
      let id = sku?.id;
      if (!id) {
        id = makeId('sku');
        (next.local.inventory ??= []).push({id,name:c.name,active:true,qty:0,unit:c.unit,
          standard:`${c.basisAmount} ${c.basisUnit}`,nutritionBasis:c.basisUnit === 'g' ? 'per100g' : c.basisUnit === 'mL' ? 'per100ml' : 'perServing',
          basisAmount:c.basisAmount,basisUnit:c.basisUnit,nutrition:c.nutrients,
          packageSize:pack.size, packageUnit:pack.measure, pack:pack.pack,pricePerUnit:null,priceBasis:''});
      }
      if (sku && stockQty === null) throw Error('份量与库存单位无法换算，请核对包装规格');
      localStockChange(next,{date,foodId:id,delta:(stockQty ?? amount)*(c.action==='add'?1:-1),reason:'确认智能候选'});
    } else {
      if (c.action === 'eat' && sku && stockQty === null) throw Error('无法换算扣库数量，请调整单位或选择自定义食物');
      const entry = addFood(next,{date,meal,name:sku?.name ?? c.name,portion:`${amount} ${unit}`,
        ...nutrition,foodId:sku?.id,stockQty,quality:'estimated',uncertainty:c.uncertainty,status:c.action==='plan'?'plan':'actual'});
      entry.source = 'confirmed-assistant';
      entry.uncertainty = c.uncertainty;
    }
  }
  return next;
}
