const graphemes=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;

export function summarizeNote(note,limit=20){
 const line=String(note??'').replace(/\s+/gu,' ').trim();
 let summary='',count=0;
 const segments=graphemes?.segment(line)??line;
 for(const item of segments){
  const character=typeof item==='string'?item:item.segment;
  if(count===limit)return summary.trimEnd()+'…';
  summary+=character;
  count++;
 }
 return summary;
}
