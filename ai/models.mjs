import {CHAT_MODELS} from './responses.mjs';

export const CHAT_MODEL_KEY='airplane-ai-model-v1';
const defaultModel=CHAT_MODELS.find(model=>model.id==='gpt-6.1-terra');

export function manualChatModel(storage=localStorage){
 const id=storage.getItem(CHAT_MODEL_KEY);
 return CHAT_MODELS.find(model=>model.id===id)??null;
}
export function readChatModel(storage=localStorage){return manualChatModel(storage)??defaultModel;}

export function saveChatModel(storage,id){
 if(id==='auto')storage.removeItem(CHAT_MODEL_KEY);
 else storage.setItem(CHAT_MODEL_KEY,id);
}

export function mountModelSettings(panel,storage){
 const options=panel.querySelector('[data-model-options]'),current=panel.querySelector('[data-current-model]');
 const status=panel.querySelector('output');
 const defaultChoice={id:'auto',name:'自动',title:'自动 · Luna / Terra'};
 const choices=[defaultChoice,...CHAT_MODELS];
 const buttons=choices.map(model=>{
  const button=document.createElement('button');
  button.type='button';button.textContent=model.name;
  button.onclick=()=>{
   try{saveChatModel(storage,model.id);refresh();status.textContent='';}
   catch{status.textContent='无法保存所选模型，请检查本机存储。';}
  };
  return button;
 });
 function refresh(){
  const active=manualChatModel(storage)??defaultChoice;
  current.textContent=active.title;
  buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(choices[index]===active)));
 }
 options.replaceChildren(...buttons);
 refresh();
 return refresh;
}

// A narrow fast path for unambiguous single records. Other turns need no
// classifier request: they start on Terra and still have the same tools.
const singleRecord=/^(?:(?:请|帮我|记录|记一下|记下|今天|刚才|我)\s*){0,4}(?:晨重\s*\d+(?:\.\d+)?\s*(?:kg|公斤|千克)|(?:午餐|晚餐|早餐)?\s*(?:吃了|喝了)\s*[\p{L}]{1,12}\s*\d+(?:\.\d+)?\s*(?:g|克|ml|毫升|个|盒|包|袋|份)|(?:午餐|晚餐|早餐|地铁|公交|咖啡)\s*(?:花了|付了|支出)\s*\d+(?:\.\d+)?\s*元)[。！!]?$/iu;
export function planNativeModel(storage,{text='',attachments=[]}={}){
 const manual=manualChatModel(storage);
 if(manual)return {model:manual.id,modelPolicy:{mode:'manual',reason:'用户指定'}};
 const simple=!attachments.length&&singleRecord.test(text.normalize('NFKC').trim());
 return {model:simple?'gpt-6-luna':defaultModel.id,
  modelPolicy:{mode:'auto',reason:simple?'明确的单项日常记录':attachments.length?'有附件需要理解':'复杂或意图未明'}};
}

const complexTools=new Set(['planning_facts','evaluate_meal_plan','read_cycle_report','read_conversation_evidence','read_medical','write_medical_report']);
const recoverable=new Set(['invalid_arguments','missing_evidence','insufficient_context']);
export function advanceModelPolicy(run){
 if(run.modelPolicy?.mode!=='auto'||run.model!=='gpt-6-luna')return false;
 const consecutive=run.receipts.slice(-2);
 const needsContext=run.receipts.some(row=>complexTools.has(row.tool));
 const retries=consecutive.length===2&&consecutive.every(row=>recoverable.has(row.result.code));
 if(!needsContext&&!retries)return false;
 run.model=defaultModel.id;
 run.modelPolicy={...run.modelPolicy,previousModel:'gpt-6-luna',reasoningFrom:run.input.length,reason:needsContext?'任务需要跨记录或复杂分析':'连续工具参数或证据错误'};
 run.effort=run.effort==='high'?'high':'medium';
 return true;
}
