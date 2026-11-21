// JSON Pointer paths refer only to properties that belong to the stored JSON.
const collection=value=>value!==null&&typeof value==='object';
const protectedKeys=new Set(['__proto__','prototype','constructor']);
function verifyValue(value){
 if(typeof value==='number'&&!Number.isFinite(value))throw Error('数值超出了 JSON 可保存的范围');
 if(collection(value))for(const [key,entry] of Object.entries(value)){
  if(protectedKeys.has(key))throw Error('不能修改对象原型字段');
  verifyValue(entry);
 }
}

export function documentPath(path){
 if(path==='')return [];
 if(typeof path!=='string'||!path.startsWith('/'))throw Error('请使用 JSON Pointer 路径');
 return path.slice(1).split('/').map(token=>{
  if(/~(?![01])/.test(token))throw Error('JSON Pointer 转义无效');
  const key=token.replace(/~1/g,'/').replace(/~0/g,'~');
  if(protectedKeys.has(key))throw Error('不能修改对象原型字段');
  return key;
 });
}

function child(parent,key){
 if(!collection(parent)||!Object.hasOwn(parent,key))throw Error('数据路径不存在');
 if(Array.isArray(parent)&&!/^(0|[1-9]\d*)$/.test(key))throw Error('数组路径需要数字索引');
 return parent[key];
}

export function readDocumentPath(value,path){
 return documentPath(path).reduce(child,value);
}

function equal(a,b){
 if(a===b)return true;
 if(!collection(a)||!collection(b)||Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);
 return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
}

function changeAt(root,path,action,value){
 const segments=documentPath(path);
 if(!segments.length){
  if(action==='test'){
   if(!equal(root,value))throw Error('原值已经改变，请重新读取');
   return root;
  }
  if(action==='remove')return undefined;
  return structuredClone(value);
 }
 const key=segments.pop(),parent=segments.reduce(child,root);
 if(action==='test'){
  if(!equal(child(parent,key),value))throw Error('原值已经改变，请重新读取');
  return root;
 }
 if(!collection(parent))throw Error('父路径不是对象或数组');
 if(Array.isArray(parent)){
  const index=key==='-'&&action==='add'?parent.length:Number(key);
  if((key!=='-'||action!=='add')&&!/^(0|[1-9]\d*)$/.test(key)||
   !Number.isSafeInteger(index)||index>parent.length||index===parent.length&&action!=='add')
   throw Error('数组位置无效');
  if(action==='add')parent.splice(index,0,structuredClone(value));
  else if(action==='remove')parent.splice(index,1);
  else parent[index]=structuredClone(value);
 }else{
  if(action!=='add')child(parent,key);
  if(action==='remove')delete parent[key];
  else Object.defineProperty(parent,key,{value:structuredClone(value),writable:true,enumerable:true,configurable:true});
 }
 return root;
}

export function editDocument(original,operations){
 if(!Array.isArray(operations)||!operations.length)throw Error('请提供 JSON Patch 操作列表');
 let next=structuredClone(original);
 for(const operation of operations){
  const {op,path,value}=operation??{};
  if(typeof path!=='string'||!['test','add','replace','remove'].includes(op)||
   (op!=='remove'&&!Object.hasOwn(operation,'value')))throw Error('JSON Patch 操作无效');
  if(op==='add'||op==='replace')verifyValue(value);
  next=changeAt(next,path,op,value);
 }
 return next;
}
