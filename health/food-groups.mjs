export const FOOD_GROUPS=Object.freeze([
 'vegetable','mushroom','fruit','staple','meat','seafood','egg','dairy','legume','fat','condiment','drink','snack','mixed','other'
]);

export const foodNameKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const groupKey=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
const storedGroup=row=>[row?.foodGroup,row?.category].find(value=>typeof value==='string'&&value.trim());
const vegetableGroups=new Set(['vegetable','vegetables','mushroom','mushrooms','fungi','蔬菜','蔬菜类','食用菌','食用菌类','菌菇','菌菇类','菌类','蔬菜/菌菇']);
const mixedGroups=new Set(['mixed','mixed dish','mixed_dish','混合菜','混合菜品','复合菜品']);
const commonVegetables=new Set([
 '蔬菜','时蔬','绿叶菜','芹菜','西芹','香芹','青菜','小青菜','小白菜','大白菜','白菜','娃娃菜','娃娃菜心','卷心菜',
 '西兰花','西蓝花','花椰菜','菜花','菠菜','生菜','油麦菜','小油菜','油菜','上海青','菜心','芥蓝','茼蒿','韭菜','空心菜',
 '番茄','西红柿','黄瓜','西葫芦','胡萝卜','白萝卜','茄子','甘蓝','青椒','甜椒','冬瓜','丝瓜','苦瓜','秋葵','芦笋','豆芽',
 '金针菇','香菇','平菇','口蘑','杏鲍菇','蟹味菇','白玉菇','海鲜菇','木耳','菌菇'
]);
const pureVegetableName=value=>commonVegetables.has(foodNameKey(value)
 .replace(/^(?:有机|新鲜|冷冻|鲜|水煮|白灼|焯水|清蒸|清炒|素炒|蒸|煮)+/,'')
 .replace(/\((?:生|熟|生重|熟重|可食部分|水煮|切段|去根)\)$/,'')
 .replace(/(?:净菜|切段|生重|熟重)$/,''));
function mixedDishName(name){
 if(pureVegetableName(name))return false;
 const ingredients=foodNameKey(name).split(/炒|炖|拌|烧|焖|蒸|烩|配|和|[+、/]/).filter(Boolean);
 return ingredients.length>1&&ingredients.some(pureVegetableName);
}

const preparedDish=name=>/(?:盖饭|炒饭|便当|饺子|包子|卷饼|三明治|披萨|馅饼|汤|粥)$/.test(foodNameKey(name));

export function inferFoodGroup(name,proposal){
 if(mixedDishName(name)||vegetableGroups.has(proposal)&&preparedDish(name))return 'mixed';
 if(FOOD_GROUPS.includes(proposal))return proposal;
 return pureVegetableName(name)?'vegetable':null;
}

export function vegetableKind(row,sku){
 const group=groupKey(storedGroup(row)??storedGroup(sku));
 if(group&&!vegetableGroups.has(group)&&!mixedGroups.has(group))return 'other';
 const names=[row.name,sku?.name],pure=names.some(pureVegetableName);
 if(names.some(mixedDishName)||mixedGroups.has(group)&&pure||vegetableGroups.has(group)&&names.some(preparedDish))
  return 'unmeasured';
 return vegetableGroups.has(group)||!group&&pure?'whole':'other';
}

export function skuForClassification(state,id){
 return state.local.inventory?.find(row=>row.id===id)??state.legacy.inventory.find(row=>row.id===id);
}

export function fillSkuFoodGroup(state,id,proposal){
 const sku=skuForClassification(state,id);
 if(!sku||storedGroup(sku))return;
 const inferred=inferFoodGroup(sku.name,proposal);
 if(inferred)sku.foodGroup=inferred;
}

export function foodGroupProposal(groups,name){
 const key=foodNameKey(name);
 return groups.find(row=>foodNameKey(row.name)===key)?.foodGroup??null;
}

export function foodClassification(row){
 return Object.fromEntries(['foodGroup','category'].flatMap(key=>
  typeof row?.[key]==='string'&&row[key].trim()?[[key,row[key]]]:[]));
}
