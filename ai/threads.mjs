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
  rename(id,title){
   const row=threads.find(thread=>thread.id===id);
   if(!row)throw Error('对话已变更');
   const previous=row.title;
   row.title=title;
   try{save();}
   catch(err){row.title=previous;throw err;}
  },
  remove(id){
   const index=threads.findIndex(thread=>thread.id===id);
   if(index<0)return;
   const previous=active,[removed]=threads.splice(index,1);
   if(active?.id===id)active=null;
   try{save();}
   catch(err){threads.splice(index,0,removed);active=previous;throw err;}
  },
  setSummary(id,summary,through){
   if(active?.id!==id)return;
   const previous=active.context;
   active.context={summary,through};
   try{save();}
   catch(err){active.context=previous;throw err;}
  },
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
