const KEY='airplane-ai-conversations-v1';

export function threadBook(store){
 let raw,stored,threads=[],activeId;
 function refresh(){
  const current=store?.getItem(KEY)??null;
  if(current===raw)return;
  raw=current;
  try{stored=JSON.parse(current);}catch{stored=null;}
  threads=Array.isArray(stored?.threads)?stored.threads.filter(thread=>
   thread&&typeof thread.id==='string'&&typeof thread.title==='string'&&Array.isArray(thread.messages)):[];
 }
 refresh();activeId=stored?.active??null;
 const current=()=>threads.find(thread=>thread.id===activeId)??null;
 function save(select=false){
  const value={active:select?activeId:stored?.active??null,threads};
  const next=JSON.stringify(value);
  try{store?.setItem(KEY,next);}
  catch(err){raw=undefined;refresh();throw err;}
  raw=next;stored=value;
 }
 function ensure(title){
  if(current())return current();
  const row={id:crypto.randomUUID(),title:title.slice(0,24),messages:[]};
  activeId=row.id;threads.unshift(row);return row;
 }
 function add(row,role,text,carry,extra){
  row.messages.push({role,text,carry,...extra});
  row.updatedAt=new Date().toISOString();
 }
 function patch(id,changes){
  refresh();
  const row=threads.find(thread=>thread.id===id);
  if(row){Object.assign(row,changes);save();}
 }
 return {
  get current(){return current();},
  list:()=>threads,
  start(){refresh();activeId=null;save(true);},
  select(id){refresh();activeId=threads.some(row=>row.id===id)?id:null;save(true);},
  rename(id,title){
   refresh();
   const row=threads.find(thread=>thread.id===id);
   if(!row)throw Error('对话已变更');
   row.title=title;save();
  },
  remove(id){
   refresh();
   const index=threads.findIndex(thread=>thread.id===id);
   if(index<0)return;
   threads.splice(index,1);
   const selected=stored?.active===id;
   if(activeId===id)activeId=null;
   if(selected&&activeId!==null)stored.active=null;
   save(selected&&activeId===null);
  },
  setSummary(id,summary,through){if(activeId===id)patch(id,{context:{summary,through}});},
  setFoodDate(date){if(activeId)patch(activeId,{foodDate:date});},
  append(role,text,carry=true,source){
   refresh();
   const row=ensure(role==='user'?text:'新对话');
   add(row,role,text,carry,source?{source}:{});
   save(true);
  },
  begin(text,request,reuse=false){
   refresh();
   const row=ensure(text);
   if(row.pending&&!reuse&&row.pending.partial)
    add(row,'assistant',row.pending.partial,false,{interrupted:true});
   if(!reuse||!row.pending)add(row,'user',text,true);
   row.pending={id:crypto.randomUUID(),request,partial:reuse?row.pending?.partial??'':''};
   row.review=null;row.photos=null;row.followUp=null;
   save(true);return {threadId:row.id,id:row.pending.id};
  },
  checkpoint({threadId,id},partial){
   refresh();
   const row=threads.find(item=>item.id===threadId);
   if(row?.pending?.id!==id||row.pending.partial===partial)return;
   row.pending.partial=partial;save();
  },
  finish({threadId,id},reply,source,review){
   refresh();
   const row=threads.find(item=>item.id===threadId);
   if(row?.pending?.id!==id)return false;
   add(row,'assistant',reply,!source,source?{source}:{});
   row.pending=null;row.review=review;save();return true;
  },
  setReview(review){if(activeId)patch(activeId,{review});},
  setFollowUp(followUp){if(activeId)patch(activeId,{followUp});},
  setPhotos(photos){
   refresh();
   const row=current();if(!row)return;
   const previous=row.photos;
   if(photos?.summary){
    const index=previous?.summaryIndex;
    if(previous?.id===photos.id&&row.messages[index])row.messages[index].text=photos.summary;
    else add(row,'assistant',photos.summary,false);
    photos.summaryIndex=previous?.id===photos.id&&row.messages[index]?index:row.messages.length-1;
   }
   row.photos=photos;if(previous?.id!==photos?.id)row.pending=null;save();
  }
 };
}
