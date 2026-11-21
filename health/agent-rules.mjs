// These policies handle only evidence and accounting. Profile prose never runs as code.
export function activityPolicy(settings,{name,energyKind,includedInBase,evidence}){
 const note=name+' '+evidence;
 const commute=/通勤|往返上班|上下班|日常步行|日常走动|常规走动|日常散步/.test(note)&&
  !/(额外|专项|训练).{0,8}(?:通勤|步行|散步)|通勤外/.test(note);
 const archivedTotal=energyKind==='total'&&settings.agentEnergy?.watchReference===true&&
  !/确认(?:按|采用|使用).{0,12}(?:全天|总消耗)|以.{0,8}(?:全天|总消耗).{0,8}(?:为准|结算)/.test(note);
 return {includedInBase:includedInBase||commute&&settings.agentEnergy?.commuteIncluded===true,
  ...(archivedTotal?{excludedFromEnergy:true}:{})};
}
export function duplicateActivity(rows,record,timeWasExplicit){
 return rows.find(row=>{
  if(row.date!==record.date||/计划|取消|作废/.test(row.status??''))return false;
  if(row.energyKind==='total'&&record.energyKind==='total')
   return row.kcal===record.kcal;
  const name=value=>String(value??'').normalize('NFKC').replace(/[\s（）。]/g,'');
  const sameClock=!!row.time&&row.time===record.time;
  const matchingEvidence=['km','minutes','kcal'].some(key=>record[key]!=null)&&
   ['km','minutes','kcal'].every(key=>(row[key]??null)===(record[key]??null));
  const sameActivity=name(row.name)===name(record.name)||/骑|单车/.test(row.name)&&/骑|单车/.test(record.name);
  return (row.energyKind??'activity')===(record.energyKind??'activity')&&sameActivity&&
   (matchingEvidence&&(!timeWasExplicit||!row.time||sameClock)||timeWasExplicit&&sameClock&&record.minutes!=null&&row.minutes===record.minutes);
 });
}
export function effectiveTdee(settings,date){
 return (settings.energyBaselineChanges??[]).find(row=>row.from>date)?.before??settings.baselineTdee;
}
