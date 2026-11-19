import {validInput} from '../health/contract.mjs';
import {outputLimit,reserveCost,modelRequest,parseResult} from './responses.mjs';

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
  reserve(id,now) {
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
    const {id,input} = await req.json();
    const bucket = this.reserve(id,new Date());
    if (!bucket) return error(429,'已达调用频率、个人额度或预算上限');
    try {
      const upstream = await fetch('https://api.openai.com/v1/responses',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(50000),
        headers:{Authorization:'Bearer '+this.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify(modelRequest(input))
      });
      if (!upstream.ok) return error(502,'识别服务暂时不可用，请稍后重试');
      const raw = await upstream.json();
      const usage = raw.usage;
      if (Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens>=0 && usage.input_tokens<=400000
          && Number.isSafeInteger(usage.output_tokens) && usage.output_tokens>=0 && usage.output_tokens<=outputLimit) {
        const used = Math.ceil(usage.input_tokens*0.75 + usage.output_tokens*4.5);
        this.storage.transactionSync(() => { this.add(bucket,used-reserveCost); this.add('total',used-reserveCost); });
      }
      return answer(200,parseResult(raw,input));
    } catch { return error(502,'未获得完整候选，请核对输入后重试'); }
  }
}

export default {async fetch(req,env) {
  const origin = req.headers.get('Origin');
  if (new URL(req.url).pathname !== '/api/assist') return error(404,'路径无效');
  if (!origin || !(env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).includes(origin)) return error(403,'来源未获授权');
  const cors = {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'};
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
  const fail = (status,message) => answer(status,{error:message},cors);
  if (req.method !== 'POST') return fail(405,'仅接受 POST');
  if (!env.OPENAI_API_KEY || !env.AI_USERS || !env.QUOTA) return fail(503,'智能服务尚未配置');
  try {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!token) return fail(401,'需要授权账户');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
    const id = Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    const users = JSON.parse(env.AI_USERS);
    if (!Array.isArray(users) || !users.includes(id)) return fail(403,'此账户尚未获准使用智能功能');
    if (req.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return fail(415,'需要 JSON');
    let input;
    try { input=await readJson(req); } catch { return fail(400,'请求过大或 JSON 无效'); }
    if (!validInput(input)) return fail(400,'输入字段或图片无效');
    const object = env.QUOTA.get(env.QUOTA.idFromName('airplane-global-budget-v1'));
    const res = await object.fetch('https://quota.internal/run',{method:'POST',body:JSON.stringify({id,input})});
    return new Response(res.body,{status:res.status,headers:{...cors,'Content-Type':'application/json'}});
  } catch { return fail(503,'智能服务暂时不可用'); }
}};
