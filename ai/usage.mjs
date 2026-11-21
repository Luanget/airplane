// OpenAI Standard prices per million tokens. Costs are accumulated in picodollars.
const prices={
 'gpt-6-luna':[0.1,0.01,0.5],
 'gpt-6.1-terra':[1,0.05,5],
 'gpt-6.2-sol':[2,0.1,10]
};
const nonNegativeInteger=n=>Number.isSafeInteger(n)&&n>=0;
export function estimatedCost(model,usage){
 if(!usage||!Object.hasOwn(prices,model))return null;
 const {input_tokens:input,output_tokens:output,input_tokens_details:details}=usage;
 const cached=details?.cached_tokens??0,written=details?.cache_write_tokens??0;
 const longWrite=details?.cache_write_tokens_details?.ttl_12h_tokens??0;
 if(![input,output,cached,written,longWrite].every(nonNegativeInteger)||cached+written>input||longWrite>written)return null;
 const [inputPrice,cachePrice,outputPrice]=prices[model];
 const longInput=input>272000;
 const dollarsPerMillion=(longInput?2:1)*(
  (input-cached-written)*inputPrice+cached*cachePrice+(written-longWrite)*inputPrice*1.25+longWrite*inputPrice*2.5
 )+output*outputPrice*(longInput?1.5:1);
 const cost=Math.round(dollarsPerMillion*1e6);
 return nonNegativeInteger(cost)?cost:null;
}

async function usageTransaction(mode,operation){
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('airplane-ai-usage-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('usage');
  let blocked=false;
  request.onblocked=()=>{blocked=true;reject(Error('本机 API 用量暂不可用'));};
  request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
  request.onerror=()=>reject(request.error);
 });
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('usage',mode),store=tx.objectStore('usage');
   const total=store.get('total');
   total.onsuccess=()=>operation(store,total.result??0);
   tx.oncomplete=()=>resolve(total.result??null);
   tx.onabort=()=>reject(tx.error??Error('无法读取本机 API 用量'));
  });
 }finally{db.close();}
}

export async function recordUsage(response,model){
 const id=response?.id,cost=estimatedCost(model,response?.usage);
 if(typeof id!=='string'||!/^resp_[A-Za-z0-9_-]{1,128}$/.test(id)||cost===null)return false;
 await usageTransaction('readwrite',(store,total)=>{
  const seen=store.get(id);
  seen.onsuccess=()=>{
   if(seen.result)return;
   store.put(true,id);
   store.put(total+cost,'total');
  };
 });
 return true;
}

export function totalUsage(){return usageTransaction('readonly',()=>{});}
export async function replaceUsage(expected,value){
 let changed=false;
 await usageTransaction('readwrite',(store,total)=>{
  if(total!==(expected??0))return;
  if(value===null)store.delete('total');else store.put(value,'total');
  changed=true;
 });
 if(!changed)throw Error('用量记录已变更，请重新读取');
}

export function displayUsage(cost){
 if(cost===null)return '';
 if(cost>0&&cost<1e6)return '本机估算支出低于 US$0.000001';
 return '本机已用约 US$'+(cost/1e12).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6});
}
