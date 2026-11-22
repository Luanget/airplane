export const FOOD_GROUPS=Object.freeze([
 'vegetable','mushroom','fruit','staple','bakery','meat','seafood','egg','dairy','legume','fat','condiment','drink','snack','mixed','other'
]);

export const foodNameKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const legacyGroups=new Map([
 ['vegetables','vegetable'],['蔬菜','vegetable'],['蔬菜类','vegetable'],
 ['mushrooms','mushroom'],['fungi','mushroom'],['菌菇','mushroom'],['菌菇类','mushroom'],['食用菌','mushroom'],
 ['mixed dish','mixed'],['mixed_dish','mixed'],['混合菜','mixed'],['混合菜品','mixed']
]);

export function canonicalFoodGroup(value){
 const key=String(value??'').normalize('NFKC').trim().toLowerCase();
 return FOOD_GROUPS.includes(key)?key:legacyGroups.get(key)??null;
}

export const foodGroupOf=(row,sku)=>canonicalFoodGroup(row?.foodGroup)??canonicalFoodGroup(sku?.foodGroup);

export function foodGroupProposal(groups,name){
 const key=foodNameKey(name);
 return groups.find(row=>foodNameKey(row.name)===key)??{};
}

export function foodClassification(row){
 const result={};
 for(const key of ['foodGroup','category','categoryId','vegetableBasis']){
  if(typeof row?.[key]==='string'&&row[key].trim())result[key]=row[key];
 }
 if(Number.isFinite(row?.vegetableGrams)&&row.vegetableGrams>=0)result.vegetableGrams=row.vegetableGrams;
 return result;
}
