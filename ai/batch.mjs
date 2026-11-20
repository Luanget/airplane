import {addConfirmedTransactions,freshData,readFinance,replaceFinance} from '../finance-storage.mjs';
import {healthReview} from '../health/assistant.mjs';
import {inventoryWithMoves,validateAppState} from '../health/core.mjs';
import {updateAssistantLedgers} from '../health/purchase-sync.mjs';
import {financeFields} from './finance.mjs';
import {foodEditReview,inventoryReview} from './operations.mjs';

function healthDraft(container,operation,current,today,foodDate){
 if(operation.mode==='inventory')return inventoryReview(container,operation,current,today);
 if(operation.mode==='food_edit')return foodEditReview(container,operation,current,today,foodDate).apply;
 return healthReview(container,operation,current,today)?.apply;
}

export async function batchReview(container,{operations,next},workspace,today,foodDate){
 const hasHealth=operations.some(operation=>operation.mode!=='finance');
 const current=hasHealth?await workspace.readHealth():null;
 const finance=operations.some(operation=>operation.mode==='finance')?readFinance(workspace.finance):null;
 const ledger=finance&&(finance.payload??freshData());
 const before=hasHealth?new Map(inventoryWithMoves(current).map(row=>[row.id,row.qty])):null;
 const title=document.createElement('h3');
 title.textContent='核对 '+operations.length+' 项账本变更';
 container.append(title);
 const drafts=operations.map((operation,index)=>{
  const card=document.createElement('fieldset');
  card.className='assistant-batch-step';
  const financeStep=operation.mode==='finance';
  const read=financeStep?financeFields(card,operation.result.entry,today,ledger):
   healthDraft(card,operation,current,today,foodDate);
  if(!read)throw Error('第 '+(index+1)+' 项缺少可以保存的内容，请补充后重试。');
  container.append(card);
  return {financeStep,read};
 });
 const preview=document.createElement('p');
 preview.className='assistant-batch-preview';
 if(next==='continue'){
  const notice=document.createElement('p');
  notice.textContent=workspace.account.demo?'保存后继续演示本轮。新的账本摘要仍需你核对。':
   '选择继续时，会把本轮原请求和已完成的操作类型发给 OpenAI。新的账本摘要仍需你核对。';
  container.append(notice);
 }
 container.append(preview);
 function project(){
  let health=current;
  const entries=[];
  drafts.forEach(({financeStep,read},index)=>{
   try{
    if(financeStep)entries.push(read());
    else health=read(health);
   }catch(err){throw Error('第 '+(index+1)+' 项：'+err.message);}
  });
  if(hasHealth&&!validateAppState(health))throw Error('健康数据格式无效');
  return {health,entries};
 }
 function update(){
  try{
   const {health}=project();
   const changes=health?inventoryWithMoves(health).filter(row=>row.qty!==(before.get(row.id)??null)).map(row=>
    row.name+' '+(before.get(row.id)??'未知')+' → '+(row.qty??'未知')+' '+row.unit):[];
   preview.textContent=changes.length?'合计库存变化\n'+changes.join('\n'):'已核对各项内容，可以保存。';
  }catch(err){preview.textContent=err.message;}
 }
 for(const card of container.querySelectorAll('.assistant-batch-step'))card.addEventListener('change',update);
 update();
 return async()=>{
  const {health,entries}=project();
  if(hasHealth&&finance)await updateAssistantLedgers(workspace.account,health,current.revision??0,finance.primary,entries);
  else if(hasHealth)await workspace.saveHealth(health,current.revision??0);
  else{
   const payload=structuredClone(ledger);
   addConfirmedTransactions(payload,entries);
   replaceFinance(workspace.finance,payload,finance.primary);
  }
  return '已保存 '+operations.length+' 项账本变更。';
 };
}
