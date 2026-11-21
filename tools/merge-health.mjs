import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {externalBase,projectExternalLedger} from '../health/sync-io.mjs';
import {planHealthMerge} from '../health/sync.mjs';
import {importSource} from '../health/sync-source.mjs';

const usage='node tools/merge-health.mjs --base 旧主账.json --incoming 手机同步包.json [--source 固定来源名称] [--choices 核对结果.json] [--out health_tracker_新版本.json --version YYMMDD.N]';
try{
 const {values}=parseArgs({options:{base:{type:'string'},incoming:{type:'string'},choices:{type:'string'},source:{type:'string'},
  out:{type:'string'},version:{type:'string'},help:{type:'boolean'}}});
 if(values.help){console.log(usage);}
 else {
  if(!values.base||!values.incoming||Boolean(values.out)!==Boolean(values.version))throw Error(usage);
  const read=async path=>JSON.parse(await readFile(path,'utf8'));
  const [raw,incoming,choices]=await Promise.all([read(values.base),read(values.incoming),values.choices?read(values.choices):{}]);
  if(!raw?.tables)throw Error('--base 必须是外部健康主账 JSON');
  const {state,plan:refresh,sourceId:baseSource}=externalBase(raw,{identity:values.source,choices:choices.external??{}});
  const preview=(plan)=>({changes:plan.rows.filter(row=>!['same','existing'].includes(row.status)),problems:plan.problems,impact:plan.impact});
  if(refresh&&(refresh.problems.length||refresh.unresolved.length)){
   console.log(JSON.stringify({stage:'external',...preview(refresh)},null,2));
   process.exitCode=2;
  }else{
   const source=importSource(incoming),plan=planHealthMerge(state,source,{choices:choices.incoming??choices,baseSource});
   if(!values.out||plan.unresolved.length||plan.problems.length){
    console.log(JSON.stringify({stage:'incoming',source:{id:source.id,version:source.version},...preview(plan)},null,2));
    if(plan.unresolved.length||plan.problems.length)process.exitCode=2;
   }else{
    const result=projectExternalLedger(raw,plan.next,{version:values.version,id:raw.ledger_id??raw.source_id??'external-health-ledger'});
    await writeFile(values.out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('已生成待人工采用的主账：'+values.out);
   }
  }
 }
}catch(error){console.error(error.message);process.exitCode=1;}
