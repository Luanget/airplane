import {validInput} from '../health/contract.mjs';
import {modelRequest,parseResult,OPENAI_URL} from '../ai/responses.mjs';

const answer = (status, data, headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const error = (status,message) => answer(status,{error:message});
async function readJson(request) {
  const limit = 750000;
  if (!request.body || Number(request.headers.get('content-length')) > limit) throw Error();
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true});
  let total=0, text='';
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw Error(); }
    text += decoder.decode(value,{stream:true});
  }
  return JSON.parse(text + decoder.decode());
}

const MODELS={
 'gpt-6-luna':{input:0.1,output:0.5},
 'gpt-6.1-terra':{input:1,output:5},
};
const maxInput=1050000;
function config(env){
 const model=env.AI_MODEL||'gpt-6-luna', price=Object.hasOwn(MODELS,model)?MODELS[model]:null;
 const maxOutput=positive(env.AI_MAX_OUTPUT_TOKENS);
 const effort=env.AI_REASONING||'none';
 if(!price||maxOutput>16384||!['none','low','medium'].includes(effort))throw Error('模型配置无效');
 return {model,price,maxOutput,effort,reserveCost:Math.ceil(maxInput*price.input+maxOutput*price.output)};
}
function positive(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n<=0) throw Error('invalid limit');
  return n;
}

// Only the bound Worker can reach this object. A single instance arbitrates all
// users so simultaneous requests cannot each spend the same remaining budget.
export class Quota {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS counter (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
  }
  get(key) { return this.sql.exec('SELECT value FROM counter WHERE key=?',key).toArray()[0]?.value ?? 0; }
  add(key,delta) {
    this.sql.exec('INSERT INTO counter(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value',key,delta);
  }
  reserve(id,now,reserveCost) {
    const minute = Math.floor(now.getTime()/60000);
    const month = now.toISOString().slice(0,7);
    const monthlyKey = 'month:' + month;
    const person = 'user:' + month + ':' + id;
    const rate = 'rate:' + id;
    const rpm = positive(this.env.USER_RPM), calls = positive(this.env.USER_MONTHLY_CALLS);
    const monthlyCap = positive(this.env.MONTHLY_BUDGET_CENTS)*10000;
    const totalCap = positive(this.env.TOTAL_BUDGET_CENTS)*10000;
    return this.storage.transactionSync(() => {
      // Store the current minute per user to keep the table bounded.
      const last = this.get(rate+':minute');
      if (last !== minute) {
        this.add(rate+':minute',minute-last);
        this.add(rate,-this.get(rate));
      }
      if (this.get(rate)>=rpm || this.get(person)>=calls) return null;
      if (this.get(monthlyKey)+reserveCost>monthlyCap || this.get('total')+reserveCost>totalCap) return null;
      this.add(rate,1); this.add(person,1); this.add(monthlyKey,reserveCost); this.add('total',reserveCost);
      return monthlyKey;
    });
  }
  async fetch(req) {
    const {id,input,usageOnly}=await req.json();
    const now=new Date(),m=now.toISOString().slice(0,7);
    if(usageOnly)return answer(200,{month:m,calls:this.get('user:'+m+':'+id),billableMicros:this.get('cost:'+m+':'+id),
      monthlyCalls:positive(this.env.USER_MONTHLY_CALLS),rpm:positive(this.env.USER_RPM)});
    const settings=config(this.env),{reserveCost,price}=settings;
    const bucket=this.reserve(id,now,reserveCost);
    if(!bucket)return error(429,'调用频率、个人额度或项目预算已达上限');
    const personal='cost:'+m+':'+id;
    this.add(personal,reserveCost);
    try {
      const upstream=await fetch(OPENAI_URL,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(50000),
        headers:{Authorization:'Bearer '+this.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify(modelRequest(input,settings))});
      if(!upstream.ok)return error(502,'模型服务暂时不可用，请检查服务端配置');
      const raw=await upstream.json();
      const usage=raw.usage;
      if(Number.isSafeInteger(usage?.input_tokens)&&usage.input_tokens>=0&&usage.input_tokens<=maxInput&&
         Number.isSafeInteger(usage.output_tokens)&&usage.output_tokens>=0&&usage.output_tokens<=settings.maxOutput){
        const cost=Math.ceil(usage.input_tokens*price.input+usage.output_tokens*price.output);
        this.storage.transactionSync(()=>{
          for(const key of [bucket,'total',personal])this.add(key,cost-reserveCost);
          this.add('tokens-in:'+m+':'+id,usage.input_tokens);
          this.add('tokens-out:'+m+':'+id,usage.output_tokens);
        });
      }
      return answer(200,parseResult(raw,input));
    }catch{return error(502,'模型未返回完整可用的候选');}
  }

}

export default {async fetch(req,env) {
  const origin=req.headers.get('Origin') || new URL(req.url).origin;
  const path=new URL(req.url).pathname;
  if (!['/api/assist','/api/usage'].includes(path))return error(404,'路径无效');
  const usageOnly=path==='/api/usage';
  if (!origin || !(env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).includes(origin)) return error(403,'来源未获授权');
  const cors = {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'};
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
  const fail = (status,message) => answer(status,{error:message},cors);
  if(req.method!==(usageOnly?'GET':'POST'))return fail(405,'请求方式无效');
  if (!env.OPENAI_API_KEY || !env.AI_USERS || !env.QUOTA) return fail(503,'智能服务尚未配置');
  try {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!token) return fail(401,'需要授权账户');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
    const id = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    const users = JSON.parse(env.AI_USERS);
    if (!Array.isArray(users) || !users.includes(id)) return fail(403,'此账户尚未获准使用智能功能');
    let input=null;
    if(!usageOnly){
      if(req.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return fail(415,'需要 JSON');
      try {input=await readJson(req);}catch{return fail(400,'请求过大或 JSON 无效');}
      if(!validInput(input))return fail(400,'输入字段或图片无效');
    }
    const object = env.QUOTA.get(env.QUOTA.idFromName('airplane-global-budget-v1'));
    const res = await object.fetch('https://quota.internal/run',{method:'POST',body:JSON.stringify({id,input,usageOnly})});
    return new Response(res.body,{status:res.status,headers:{...cors,'Content-Type':'application/json'}});
  } catch { return fail(503,'智能服务暂时不可用'); }
}};
