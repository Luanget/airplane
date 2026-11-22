import {addDays,newState} from '../health/core.mjs';
import {addBatch,saveSku} from '../health/inventory.mjs';
import {confirmPackageAction,ensureContainers,packagesFor} from '../health/containers.mjs';
import {healthSteps} from '../health/contract.mjs';

export function assistantFixture(today){
 const state=newState(),yesterday=addDays(today,-1);
 state.settings.cycleAnchor=yesterday;
 state.settings.cycleDays=6;
 const add=(id,name,unit,basisUnit,extra={})=>saveSku(state,{id,name,unit,basisUnit,basisAmount:100,
  kcal:100,protein:10,carbs:12,fat:3,sodium:40,...extra});
 const sauce=add('fixture-sauce','合成牛肉辣椒酱','瓶','g',{packageSize:200,packageUnit:'g',price:6});
 const milk=add('fixture-milk','合成脱脂牛奶','mL','mL',{packageSize:1000,packageUnit:'mL',packageKind:'盒',kcal:35});
 const chicken=add('fixture-chicken','合成熟鸡胸','g','g',{kcal:160,protein:32});
 const noodles=add('fixture-noodles','合成荞麦面','包','包',{basisAmount:1,kcal:220});
 const greens=add('fixture-greens','合成小青菜','g','g',{kcal:18,foodGroup:'vegetable'});
 add('fixture-hidden','未提及的合成苹果','g','g').qty=900;
 addBatch(state,{id:'sauce-batch',date:yesterday,foodId:sauce.id,quantity:2,costCents:1200});
 addBatch(state,{id:'milk-batch',date:yesterday,foodId:milk.id,quantity:3000,costCents:1800});
 for(const [i,quantity] of [246,248,249].entries())
  addBatch(state,{id:'chicken-'+i,date:yesterday,foodId:chicken.id,quantity,portion:true,costCents:480});
 noodles.qty=6;greens.qty=800;
 ensureContainers(state);
 const [bottle]=packagesFor(state,sauce.id),[carton]=packagesFor(state,milk.id);
 const op=(state,id,container,fields)=>confirmPackageAction(state,
  {id,date:yesterday,meal:'午餐',containerId:container.id,...fields}).next;
 const baseline=op(state,'fixture-open-sauce',bottle,{action:'baseline',gross:360});
 const opened=op(baseline,'fixture-first-read',bottle,{action:'eat',gross:322.2});
 return op(opened,'fixture-yesterday-milk',carton,{action:'whole'});
}

export function action(kind,evidence,fields){
 const defaults=Object.fromEntries(Object.entries(healthSteps[kind].properties).map(([key,schema])=>[key,
  schema.type==='array'?[]:schema.enum?.[0]??null]));
 return {...defaults,kind,evidence,...fields};
}
export const proposal=(...steps)=>({intent:'execute',steps});
export const examples={
 '牛肉酱现在310g':proposal(action('weigh','牛肉酱现在310g',{name:'牛肉酱',gross:310})),
 '吃了20g牛肉酱':proposal(action('eat','吃了20g牛肉酱',{name:'牛肉酱',amount:20,unit:'g',whole:'no'})),
 '喝完一盒牛奶':proposal(action('eat','喝完一盒牛奶',{name:'牛奶',amount:1,unit:'盒',whole:'yes'})),
 '吃了一袋鸡胸、两包面，安排晚餐':proposal(action('eat','吃了一袋鸡胸',{name:'鸡胸',amount:1,unit:'袋',whole:'yes'}),
  action('eat','两包面',{name:'荞麦面',amount:2,unit:'包',whole:'yes'}),
  action('next_meal','安排晚餐',{meal:'晚餐',preferences:['青菜']})),
 '昨天牛奶少算200mL':proposal(action('correct','昨天牛奶少算200mL',{name:'牛奶',unit:'mL',delta:200}))
};
