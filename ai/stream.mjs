export class ResponseStreamError extends Error {}

// The structured output schema puts "reply" first. Decode only that string,
// leaving proposal fields to the complete response validator.
function replyPreview(onReply) {
 let pending='',text='',started=false,ended=false;
 return delta=>{
  if(ended)return;
  pending+=delta;
  if(!started){
   const header=/^\s*\{\s*"reply"\s*:\s*"/.exec(pending);
   if(!header)return;
   pending=pending.slice(header[0].length);
   started=true;
  }
  const part=/^(?:[^"\\\x00-\x1F]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*/.exec(pending)[0];
  pending=pending.slice(part.length);
  ended=pending.startsWith('"');
  if(ended)pending='';
  if(part){
   text+=JSON.parse('"'+part+'"');
   onReply(text.replace(/[\uD800-\uDBFF]$/,''));
  }
 };
}

export async function readResponseStream(response,{onActivity=()=>{},onReply=()=>{},onTool=()=>{},plain=false}={}) {
 if(!response.body?.getReader)throw new ResponseStreamError('当前浏览器无法读取实时回复。');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let text='';
 const reveal=plain?(delta=>{text+=delta;onReply(text);}):replyPreview(onReply);
 let buffer='',firstPart=null;
 try {
  while(true){
   const {done,value}=await reader.read();
   buffer+=decoder.decode(value,{stream:!done});
   let boundary;
   while((boundary=/\r?\n\r?\n/.exec(buffer))){
    const data=buffer.slice(0,boundary.index).split(/\r?\n/)
     .filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    buffer=buffer.slice(boundary.index+boundary[0].length);
    if(!data||data==='[DONE]')continue;
    const event=JSON.parse(data);
    onActivity();
    if(event.type==='response.output_text.delta'&&typeof event.delta==='string'){
     const part=event.output_index+':'+event.content_index;
     firstPart??=part;
     if(firstPart===part)reveal(event.delta);
    }else if(event.type==='response.output_item.added'&&event.item?.type==='function_call'){
     onTool();
    }else if(['response.completed','response.failed','response.incomplete'].includes(event.type)){
     return event.response;
    }else if(event.type==='error'){
     throw new ResponseStreamError('OpenAI 在发送实时回复时返回了错误，请重试。');
    }
   }
   if(done)throw new ResponseStreamError('OpenAI 回复在读完前中断。原消息仍在，可以重试。');
  }
 }finally{
  void reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}
