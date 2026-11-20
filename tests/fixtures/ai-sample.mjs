// The user's recognition check uses a synthetic catalog. Never open the ledger.
import {newState} from '../../health/core.mjs';
import {assistantInput} from '../../health/contract.mjs';
import {resolveItem} from '../../health/candidates.mjs';
export const exampleText='示例鱼肉120g、两包饼干、示例酸奶喝了88g';
const foods=[['chicken','示例鱼肉','g',120],['noodles','饼干','包',2],['milk','示例酸奶','g',88]];
function demoState() {
  const state=newState();
  state.legacy.inventory=foods.map(([id,name,unit])=>({id,name,unit,active:true,qty:1000,
    standard:unit==='包'?'每包':'每100g',nutritionBasis:unit==='包'?'perServing':'per100g',
    nutrition:{kcal:null,protein:null,carbs:null,fat:null,sodium:null}}));
  return state;
}
export function exampleInput() {return assistantInput({mode:'entry',text:exampleText});}
export function assessExample(result) {
  const state=demoState(),lines=[];
  for (const [id,name,unit,amount] of foods) {
    const found=result.items.filter(x=>x.sku===id);
    if (found.length!==1) {lines.push(name+'：未唯一匹配到样例 SKU，请核对');continue;}
    const c=found[0],{stockQty}=resolveItem(state,c);
    const correct=c.action==='eat' && c.amount===amount && c.unit===unit && stockQty===amount;
    const delta=c.action==='plan'?'0':stockQty===null?'无法换算':(c.action==='add'?'+':'−')+stockQty+' '+unit;
    lines.push(name+'：'+c.amount+' '+c.unit+'，库存候选 '+delta+'（'+(correct?'符合预期':'请核对')+'）');
  }
  for (const c of result.items.filter(x=>!foods.some(([id])=>id===x.sku))) lines.push('未关联食品：'+c.name+' '+c.amount+' '+c.unit);
  return lines;
}
