import {validInput} from '../health/contract.mjs';
import {callModel,ModelError} from '../ai/responses.mjs';

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

export default {async fetch(req,env) {
  const origin = req.headers.get('Origin');
  if (!['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname)) return error(403,'仅供本机使用');
  if (new URL(req.url).pathname !== '/api/assist') return error(404,'路径无效');
  if (!origin || !(env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).includes(origin)) return error(403,'来源未获授权');
  const cors = {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'};
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
  const fail = (status,message) => answer(status,{error:message},cors);
  if (req.method !== 'POST') return fail(405,'仅接受 POST');
  if (!env.OPENAI_API_KEY || !env.AI_USERS) return fail(503,'智能服务尚未配置');
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
    return answer(200,await callModel(env.OPENAI_API_KEY,input),cors);
  } catch (err) { return err instanceof ModelError ? fail(err.status,err.message) : fail(503,'智能服务暂时不可用'); }
}};
