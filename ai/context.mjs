export const CHAT_HISTORY_KEY='airplane-ai-history-v1';
export const HISTORY_OPTIONS=[
 {id:'current',label:'仅本轮',messages:0,chars:0},
 {id:'rolling',label:'自动压缩',messages:40,chars:16000},
 {id:'extended',label:'更多历史',messages:72,chars:32000}
];
export function readHistoryOption(storage){
 const stored=storage.getItem(CHAT_HISTORY_KEY);
 return HISTORY_OPTIONS.find(option=>option.id===stored)??HISTORY_OPTIONS[1];
}
export function saveHistoryOption(storage,id){storage.setItem(CHAT_HISTORY_KEY,id);}

function fit(turns,chars,count,reverse=false){
 const rows=reverse?[...turns].reverse():turns;
 let size=0;
 const selected=[];
 for(const row of rows){
  if(selected.length===count)break;
  const room=chars-size;
  if(!room||selected.length&&row.text.length>room)break;
  let text=row.text;
  if(text.length>room){
   const head=Math.ceil((room-1)/2),tail=room-head-1;
   text=text.slice(0,head)+'…'+text.slice(text.length-tail);
  }
  selected.push({...row,text});size+=text.length;
 }
 return reverse?selected.reverse():selected;
}

export function contextFor(thread,budget=HISTORY_OPTIONS[1]){
 if(!budget.messages)return {history:[],summary:'',compact:null};
 const messages=thread?.messages??[];
 const saved=thread?.context;
 const valid=saved&&Number.isSafeInteger(saved.through)&&saved.through>=0&&saved.through<=messages.length&&
  typeof saved.summary==='string'&&saved.summary.length<=4000;
 const summary=valid?saved.summary:'';
 const turns=[];
 for(let index=valid?saved.through:0;index<messages.length;index++){
  const {role,text,carry,privateMedical}=messages[index];
  if(!privateMedical&&carry&&['user','assistant'].includes(role)&&typeof text==='string'&&text.trim())turns.push({role,text,index});
 }
 const serial=rows=>rows.map(({role,text})=>({role,text}));
 const charCount=turns.reduce((sum,turn)=>sum+turn.text.length,0);
 const retained=fit(turns,budget.chars,budget.messages,true);
 let compact=null;
 if(turns.length>budget.messages||charCount>budget.chars){
  // Compact enough for several more messages. Keep the most recent turn
  // intact where possible and summarize older turns in chronological order.
  const recent=fit(turns,Math.floor(budget.chars*.65),Math.floor(budget.messages*.65),true);
  const older=turns.filter(row=>row.index<recent[0].index);
  const batch=fit(older,32000,72);
  if(batch.length)compact={through:batch.at(-1).index+1,history:serial(batch)};
 }
 return {history:serial(retained),summary,compact};
}
