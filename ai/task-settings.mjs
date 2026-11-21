import {CHAT_MODELS} from './responses.mjs';
import {modelRates,saveModelRates} from './usage.mjs';
import {summarizeTasks} from './task-log.mjs';

const ratio=(part,total)=>total?(100*part/total).toFixed(1)+'%':'—';
const usd=value=>(value/1e12).toFixed(6);
export function mountTaskSettings(panel,journal,storage,demo){
 panel.hidden=demo;
 if(demo)return ()=>{};
 const summary=panel.querySelector('[data-task-summary]'),form=panel.querySelector('form'),out=panel.querySelector('output');
 for(const model of CHAT_MODELS)form.elements.model.add(new Option(model.name,model.id));
 function fill(){
  const rate=modelRates(storage)[form.elements.model.value];
  [form.elements.input.value,form.elements.cached.value,form.elements.outputRate.value]=rate;
 }
 form.elements.model.onchange=fill;
 form.onsubmit=event=>{
  event.preventDefault();
  try{
   saveModelRates(storage,form.elements.model.value,
    ['input','cached','outputRate'].map(name=>form.elements[name].valueAsNumber));
   out.textContent='费率已保存，后续回执使用新费率。';
  }catch(error){out.textContent=error.message;}
 };
 async function refresh(){
  fill();
  try{
   const metrics=summarizeTasks(await journal.list());
   summary.textContent=metrics.tasks?
    metrics.tasks+' 个任务 · '+metrics.requests+' 次 API · 完成 '+ratio(metrics.completed,metrics.tasks)+
    ' · 人工确认 '+metrics.confirmations+' 次\n输入 '+metrics.input+' / 输出 '+metrics.output+
    ' token · '+(metrics.cacheReports?'缓存命中 '+metrics.cacheHits+'/'+metrics.cacheReports+'（'+
     ratio(metrics.cacheHits,metrics.cacheReports)+'），读取占 '+ratio(metrics.cachedInput,metrics.cacheEligibleInput):'暂无缓存统计回执')+
    '\n'+(metrics.priced?'已知用量约 US$'+usd(metrics.estimatedPicoUsd)+'（'+metrics.priced+' 次）':'暂无可估算费用回执'):
    '暂无任务记录。';
  }catch{summary.textContent='本机任务日志暂无法读取。';}
 }
 panel.querySelector('[data-export-tasks]').onclick=async()=>{
  try{
   const tasks=await journal.list();
   const url=URL.createObjectURL(new Blob([JSON.stringify({format:'airplane-agent-task-log-v1',tasks,summary:summarizeTasks(tasks)},null,2)],
    {type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download='airplane-agent-task-log.json';document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),3000);
  }catch(error){out.textContent=error.message;}
 };
 return refresh;
}
