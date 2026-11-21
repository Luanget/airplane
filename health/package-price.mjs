const oatPrice=Object.freeze({cents:3000,quantity:1000,unit:'g',kind:'包'});
const saucePrice=Object.freeze({cents:1000,quantity:1,unit:'瓶',kind:'瓶'});
const legacySauces=new Set(['FD_SAUCE_HUBANG','FD_SAUCE_HUBANG_ZERO_FAT_BULDAK_20261101',
 'FD_SAUCE_HUBANG_BEEF_CHILI_20261120','FD_DRESSING_ZHANYI_0FAT_100','FD_DRESSING_015']);

export function packagePrice(sku){
 if(!sku)return null;
 if(/^FD_(OATS|RYE_FLAKES)(?:_|$)/.test(sku.id))return oatPrice;
 if(legacySauces.has(sku.id))return saucePrice;
 return null;
}

export function catalogCost(sku,quantity){
 const price=sku.packagePrice??packagePrice(sku);
 if(price)return price.unit===sku.unit?Math.round(price.cents*quantity/price.quantity):null;
 if(sku.priceBasis===sku.unit&&Number.isFinite(sku.pricePerUnit))return Math.round(sku.pricePerUnit*quantity*100);
 return null;
}

export function apportionedCost(costCents,amount,net,spent=0){
 if(!Number.isFinite(costCents)||!Number.isFinite(net)||net<=0||!Number.isFinite(amount)||amount<0)return null;
 return Math.max(0,Math.min(costCents-spent,Math.round(costCents*amount/net)));
}

export function packageCostReference(sku,container,lot){
 if(!lot&&container.origin==='opening'){
  const price=packagePrice(sku);
  if(price?.unit===container.kind)return {costCents:price.cents,costEstimated:true};
 }
 return {costCents:container.costCents??null,costEstimated:false};
}
