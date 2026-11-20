import {CHAT_MODELS} from './responses.mjs';

const STORAGE_KEY='airplane-ai-model-v1';

export function readChatModel(storage=localStorage){
 const id=storage.getItem(STORAGE_KEY);
 return CHAT_MODELS.find(model=>model.id===id)??CHAT_MODELS[0];
}

export function mountModelSettings(panel,storage){
 const options=panel.querySelector('[data-model-options]'),current=panel.querySelector('[data-current-model]');
 const status=panel.querySelector('output');
 const buttons=CHAT_MODELS.map(model=>{
  const button=document.createElement('button');
  button.type='button';button.textContent=model.name;
  button.onclick=()=>{
   try{storage.setItem(STORAGE_KEY,model.id);refresh();status.textContent='';}
   catch{status.textContent='无法保存所选模型，请检查本机存储。';}
  };
  return button;
 });
 function refresh(){
  const active=readChatModel(storage);
  current.textContent=active.title;
  buttons.forEach((button,index)=>button.setAttribute('aria-pressed',String(CHAT_MODELS[index]===active)));
 }
 options.replaceChildren(...buttons);
 refresh();
 return refresh;
}
