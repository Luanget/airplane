import {canonicalFoodGroup,foodClassification,foodNameKey} from './food-groups.mjs';

const categoryKey=name=>foodNameKey(name);
const legacyId=name=>'legacy-food-category:'+categoryKey(name);
const storedCategories=state=>state.local.foodCategories??[];
export const skuForClassification=(state,id)=>state.local.inventory?.find(row=>row.id===id)??state.legacy.inventory.find(row=>row.id===id);

function referenceLocations(state){
 const locations=[];
 for(const [table,rows] of [
  ['localInventory',state.local.inventory??[]],['legacyInventory',state.legacy.inventory],
  ['localFoods',state.local.foods],['legacyFoods',state.legacy.foods],
  ['foodEdits',Object.values(state.local.edits?.foods??{}).filter(Boolean)],
  ['templateFoods',(state.local.templates??[]).flatMap(row=>row.items??[])],
  ['deletedFoods',(state.sync?.tombstones??[]).filter(row=>row.type==='foods'&&row.before).map(row=>row.before)]
 ])rows.forEach((row,index)=>locations.push({row,table,index,id:row.id??null}));
 return locations;
}

function categoryIndex(state){
 const rows=new Map(storedCategories(state).map(row=>[row.id,row]));
 const names=new Set([...rows.values()].flatMap(row=>[row.name,...row.aliases].map(categoryKey)));
 for(const {row} of referenceLocations(state)){
  if(typeof row.category!=='string'||!row.category.trim()||names.has(categoryKey(row.category)))continue;
  const id=legacyId(row.category);
  if(!rows.has(id))rows.set(id,{id,name:row.category.trim(),foodGroup:null,aliases:[],legacy:true});
 }
 return rows;
}

function follow(rows,id){
 const visited=new Set();
 while(id&&!visited.has(id)){
  visited.add(id);
  const row=rows.get(id);
  if(!row||!row.mergedInto)return row??null;
  id=row.mergedInto;
 }
 return null;
}

function byName(rows,name){
 const key=categoryKey(name);
 return key?[...rows.values()].find(row=>[row.name,...row.aliases].some(value=>categoryKey(value)===key))??null:null;
}

function categoryFor(rows,food){
 return follow(rows,food?.categoryId)??follow(rows,byName(rows,food?.category)?.id);
}

export function readFoodCategories(state){
 return [...categoryIndex(state).values()].filter(row=>!row.mergedInto).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}

export function categoryReader(state){
 const rows=categoryIndex(state),resolved=new Map();
 return food=>{
  if(!food?.categoryId&&!food?.category)return {};
  const key=food.categoryId??food.category;
  if(!resolved.has(key))resolved.set(key,categoryFor(rows,food));
  const category=resolved.get(key);
  return category?{categoryId:category.id,categoryName:category.name}:{};
 };
}

export function findFoodCategory(state,id){
 return follow(categoryIndex(state),id);
}

export function fillFoodClassification(state,target,proposal={},reuse){
 const reusable=foodClassification(reuse),prior=canonicalFoodGroup(target.foodGroup);
 const group=prior??canonicalFoodGroup(reusable.foodGroup)??canonicalFoodGroup(proposal.foodGroup);
 if(!prior&&group)target.foodGroup=group;
 if(group==='vegetable'&&!target.vegetableBasis){
  const basis=reusable.vegetableBasis??proposal.vegetableBasis;
  if(basis==='whole'||basis==='component')target.vegetableBasis=basis;
 }
 if(!target.category&&!target.categoryId&&(reusable.category||reusable.categoryId)){
  if(reusable.category)target.category=reusable.category;
  if(reusable.categoryId)target.categoryId=reusable.categoryId;
 }
 if(!target.categoryId&&(target.category||proposal.categoryId)){
  const rows=categoryIndex(state);
  const category=target.category?categoryFor(rows,target):follow(rows,proposal.categoryId);
  if(category&&(target.category||!group||!category.foodGroup||group===category.foodGroup)){
   target.categoryId=category.id;
   if(category.legacy&&!target.category)target.category=category.name;
  }
 }
 return target;
}

export function fillSkuFoodGroup(state,id,proposal){
 const sku=skuForClassification(state,id);
 if(sku)fillFoodClassification(state,sku,proposal);
}

const plainCategory=({id,name,foodGroup,aliases,mergedInto})=>({id,name,foodGroup,aliases:[...aliases],...(mergedInto?{mergedInto}:{})});
const same=(left,right)=>JSON.stringify(left??null)===JSON.stringify(right??null);
const distinct=list=>[...new Map(list.map(name=>[categoryKey(name),name])).values()];
const writeRow=(state,row)=> {
 const categories=state.local.foodCategories??=[];
 const index=categories.findIndex(item=>item.id===row.id);
 if(index<0)categories.push(row);else categories[index]=row;
};

export function administerFoodCategory(state,{action,id,targetId,name,foodGroup}){
 const index=categoryIndex(state),originals=new Map(storedCategories(state).map(row=>[row.id,row]));
 const edits=[],references=[];
 const save=(row)=>{
  const next=plainCategory(row);
  edits.push({id:next.id,before:originals.get(next.id)??null,after:next});
  writeRow(state,next);
 };
 const requestedName=typeof name==='string'?name.normalize('NFKC').trim():'';
 if(action==='create'){
  if(!requestedName)throw Error('请给出可复用的类别名称');
  const existing=follow(index,byName(index,requestedName)?.id);
  if(existing){
   if(foodGroup&&existing.foodGroup&&existing.foodGroup!==foodGroup)throw Error('同名类别已经存在，但所属食品组不同，请先核对');
   return {category:existing,reused:true};
  }
  const category={id:'food-category:'+categoryKey(requestedName),name:requestedName,foodGroup,aliases:[]};
  save(category);
  return {category,edits,references};
 }
 const current=index.get(id);
 if(!current||current.mergedInto)throw Error('请指定仍启用的食品类别');
 if(action==='rename'){
  if(!requestedName)throw Error('请给出新的类别名称');
  const duplicate=follow(index,byName(index,requestedName)?.id);
  if(duplicate&&duplicate.id!==id)throw Error('同名或别名类别已存在。请先核实，再合并相同类别');
  if(requestedName===current.name)return {category:current,reused:true};
  const category={...current,name:requestedName,aliases:distinct([...current.aliases,current.name])
   .filter(alias=>categoryKey(alias)!==categoryKey(requestedName))};
  save(category);
  return {category,edits,references};
 }
 const target=index.get(targetId);
 if(!target||target.mergedInto||id===targetId)throw Error('请指定另一个仍启用的目标类别');
 const groupFor=category=>{
  if(category.foodGroup)return category.foodGroup;
  const groups=new Set(referenceLocations(state).filter(({row})=>categoryFor(index,row)?.id===category.id)
   .map(({row})=>canonicalFoodGroup(row.foodGroup)).filter(Boolean));
  return groups.size===1?[...groups][0]:null;
 };
 const sourceGroup=groupFor(current),targetGroup=groupFor(target);
 if(sourceGroup&&targetGroup&&sourceGroup!==targetGroup)throw Error('两者属于不同食品组，不能合并');
 for(const {row,...location} of referenceLocations(state)){
  if(categoryFor(index,row)?.id!==id)continue;
  references.push({...location,before:row.categoryId??null,after:targetId});
  row.categoryId=targetId;
 }
 const category={...target,aliases:distinct([...target.aliases,current.name,...current.aliases])
  .filter(alias=>categoryKey(alias)!==categoryKey(target.name))};
 save(category);
 save({...current,aliases:[],mergedInto:targetId});
 return {category,edits,references};
}

export function undoFoodCategory(state,{edits,references}){
 const index=new Map(storedCategories(state).map(row=>[row.id,row]));
 const locations=referenceLocations(state);
 for(const {id,after} of edits)if(!same(index.get(id),after))throw Error('类别已经变更，请重新查询后更正');
 for(const change of references){
  let location=locations.find(row=>row.table===change.table&&row.index===change.index&&row.id===change.id);
  if(!location&&change.id)location=locations.find(row=>row.table===change.table&&row.id===change.id);
  if(!location||location.row.categoryId!==change.after)throw Error('相关食品分类已变更，请重新查询');
  if(change.before===null)delete location.row.categoryId;else location.row.categoryId=change.before;
 }
 for(const {id,before} of edits){
  if(before)writeRow(state,before);
  else{
   if(locations.some(({row})=>row.categoryId===id)&&!id.startsWith('legacy-food-category:'))
    throw Error('该类别已被食品引用，请先移除引用');
   state.local.foodCategories=storedCategories(state).filter(row=>row.id!==id);
  }
 }
}

export function validFoodCategories(state){
 const rows=state.local.foodCategories??[];
 if(!Array.isArray(rows)||new Set(rows.map(row=>row?.id)).size!==rows.length||!rows.every(row=>
  typeof row?.id==='string'&&row.id.length&&typeof row.name==='string'&&row.name.trim()&&
  (row.foodGroup===null||canonicalFoodGroup(row.foodGroup)===row.foodGroup)&&
  Array.isArray(row.aliases)&&row.aliases.every(name=>typeof name==='string'&&name.trim())&&
  (row.mergedInto===undefined||typeof row.mergedInto==='string')))return false;
 const index=categoryIndex(state);
 if(rows.some(row=>!follow(index,row.id)))return false;
 return referenceLocations(state).every(({row})=>!row.categoryId||!!follow(index,row.categoryId));
}
