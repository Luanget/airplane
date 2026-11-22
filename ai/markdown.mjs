import MarkdownIt from '../vendor/markdown-it.min.mjs';

const markdown=new MarkdownIt({html:false,breaks:true});
const defaultValidateLink=markdown.validateLink;
markdown.validateLink=url=>{
 if(!defaultValidateLink(url))return false;
 try{return ['http:','https:','mailto:'].includes(new URL(url,'https://airplane.invalid/').protocol);}
 catch{return false;}
};
// Attachments have their own viewer. Rendering a reply never fetches a remote image.
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content);
markdown.renderer.rules.table_open=()=>'<div class="markdown-table" role="region" aria-label="表格" tabindex="0"><table>\n';
markdown.renderer.rules.table_close=()=>'</table></div>\n';
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{
 tokens[index].attrSet('target','_blank');
 tokens[index].attrSet('rel','noopener noreferrer');
 return self.renderToken(tokens,index,options);
};

const lastRendered=new WeakMap();
export function renderMarkdown(body,text){
 if(lastRendered.get(body)===text)return;
 const fragment=body.ownerDocument.createElement('template');
 fragment.innerHTML=markdown.render(text).trimEnd();
 const previous=Array.from(body.childNodes),next=Array.from(fragment.content.childNodes);
 for(const [index,node] of next.entries()){
  const old=previous[index];
  if(old?.isEqualNode(node))continue;
  if(old?.nodeType===1&&node.nodeType===1&&
    (old.matches('.markdown-table')&&node.matches('.markdown-table')||old.tagName==='PRE'&&node.tagName==='PRE')){
   const left=old.scrollLeft;
   old.replaceChildren(...node.childNodes);
   old.scrollLeft=left;
  }else if(old)old.replaceWith(node);
  else body.append(node);
 }
 for(const stale of previous.slice(next.length))stale.remove();
 body.classList.add('markdown-reply');
 lastRendered.set(body,text);
}

// Paint the latest text once per interval. Keep completed blocks, scrollable
// table wrappers and the reader's position while later tokens arrive.
export function markdownStream(body,thread,onPaint=()=>{}){
 let latest='',timer=null,lastPaint=-Infinity;
 function flush(){
  if(timer!==null)clearTimeout(timer);
  timer=null;
  const top=thread.scrollTop,follow=thread.scrollHeight-top-thread.clientHeight<48;
  onPaint(latest);
  renderMarkdown(body,latest);
  if(follow)thread.scrollTop=thread.scrollHeight;
  else thread.scrollTop=top;
  lastPaint=performance.now();
 }
 return {
  update(text){
   latest=text;
   if(timer!==null)return;
   const wait=110-(performance.now()-lastPaint);
   if(wait<=0||!text)flush();
   else timer=setTimeout(flush,wait);
  },
  cancel(){if(timer!==null)clearTimeout(timer);timer=null;}
 };
}
