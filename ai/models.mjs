import {CHAT_MODELS} from './responses.mjs';

export const CHAT_MODEL_KEY='airplane-ai-model-v1';

export function manualChatModel(storage=localStorage){
 const id=storage.getItem(CHAT_MODEL_KEY);
 return CHAT_MODELS.find(model=>model.id===id)??null;
}
export function readChatModel(storage=localStorage){return manualChatModel(storage)??CHAT_MODELS[0];}

export function saveChatModel(storage,id){
 if(id==='auto')storage.removeItem(CHAT_MODEL_KEY);
 else storage.setItem(CHAT_MODEL_KEY,id);
}

export function mountModelSettings(panel,storage){
 const options=panel.querySelector('[data-model-options]'),current=panel.querySelector('[data-current-model]');
 const status=panel.querySelector('output');
 const automatic={id:'auto',name:'自动',title:'自动选择模型'};
 const choices=[automatic,...CHAT_MODELS];
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
  const active=manualChatModel(storage)??automatic;
  current.textContent=active.title;
  buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(choices[index]===active)));
 }
 options.replaceChildren(...buttons);
 refresh();
 return refresh;
}
