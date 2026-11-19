// Optional operator check for the owner's local .dev.vars. No browser data is read.
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {callModel,MODEL} from '../ai/responses.mjs';
import {exampleInput,assessExample} from '../ai/example.mjs';
const envFile=new URL('./.dev.vars',import.meta.url);
const config=await readFile(envFile,'utf8').catch(err=>{if(err.code==='ENOENT')return '';throw err;});
const key=parseEnv(config).OPENAI_API_KEY?.trim();
if (!key) {
  console.error('本机文件中尚未填写 Key。页面导入的 Key 可以直接在页面的试识别入口使用。');
  process.exitCode=1;
} else {
  try {
    const result=await callModel(key,exampleInput());
    console.log(MODEL+' · 真实响应 · 样例库存');
    console.log(assessExample(result).join('\n'));
  } catch(err) {
    console.error(err.message);
    process.exitCode=1;
  }
}
