const KEY='airplane-ai-conversations-v1';

export function threadBook(store){
 let stored;
 try{stored=JSON.parse(store?.getItem(KEY)??'null');}catch{}
 const threads=Array.isArray(stored?.threads)?stored.threads.filter(thread=>
  thread&&typeof thread.id==='string'&&typeof thread.title==='string'&&Array.isArray(thread.messages)): [];
 let active=threads.find(thread=>thread.id===stored?.active)??null;
 const save=()=>store?.setItem(KEY,JSON.stringify({active:active?.id??null,threads}));
 return {
  get current(){return active;},
  list:()=>threads,
  start(){active=null;save();},
  select(id){active=threads.find(thread=>thread.id===id)??null;save();},
  setFoodDate(date){if(active){active.foodDate=date;save();}},
  append(role,text,carry=true,source){
   if(!active){
    active={id:crypto.randomUUID(),title:role==='user'?text.slice(0,24):'新对话',messages:[]};
    threads.unshift(active);
   }
   active.messages.push({role,text,carry,...(source?{source}:{})});
   active.updatedAt=new Date().toISOString();save();
  }
 };
}
