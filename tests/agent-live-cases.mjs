import {addDays,inventoryWithMoves} from '../health/core.mjs';
import {confirmPackageAction,packagesFor} from '../health/containers.mjs';

export const date='2026-11-21';
const yesterday=addDays(date,-1);
const todayFoods=state=>state.local.foods.filter(row=>row.date===date&&row.status==='actual');
const foods=(state,id)=>todayFoods(state).filter(row=>row.foodId==='fixture-'+id);
const transactions=ledger=>ledger.transactions.filter(row=>row.id!=='fixture-previous-expense');
const receipts=state=>state.local.agentReceipts??[];
const stock=(state,sku)=>inventoryWithMoves(state).find(row=>row.id==='fixture-'+sku)?.qty;
const outcome=(health,finance)=>({health,finance});
const eat=(id,text,sku,amount,options={})=>({id,turns:[text],...options,verify:({state})=>{
 const rows=foods(state,sku);
 const remaining={sauce:2,milk:1000,chicken:495,noodles:4}[sku];
 const packages=packagesFor(state,'fixture-'+sku);
 const sauceCorrect=sku!=='sauce'||packages[0]?.gross===(id==='sauce-gross'?310:322.2)&&
  packages[0]?.eaten===(id==='sauce-gross'?50:57.8);
 return outcome(rows.length===1&&rows[0].amount===amount&&stock(state,sku)===remaining&&sauceCorrect,true);
}});
const weight=(id,text,kg,when=date)=>({id,turns:[text],verify:({state})=>
 outcome(state.local.weights.length===1&&state.local.weights[0].kg===kg&&state.local.weights[0].date===when,true)});
const order=(id,patch={},verify)=>{
 const picture={amount:34,food:true,household:true,number:null,status:'支付成功',...patch};
 return {id,turns:[{text:'请把这笔订单记账，食品同步入库。',pictures:[picture]}],
  verify:verify??(({state,ledger})=>outcome(stock(state,'milk')===2000+(picture.food?1000:0),receipts(state).length===1&&
   transactions(ledger).reduce((sum,row)=>sum+row.amount,0)===picture.amount&&
   (!picture.food||transactions(ledger).some(row=>row.categoryId==='fixture-groceries'))))};
};
const noWrites=({state,ledger})=>outcome(
 todayFoods(state).length===0&&state.local.weights.length===0&&stock(state,'milk')===2000,transactions(ledger).length===0);
const paid={amount:34,food:true,household:true,number:null,status:'支付成功'};
const mealLabel=['合成外食米粉', '营养标签  每100g', '能量 120 kcal', '蛋白质 4 g', '碳水化合物 23 g', '脂肪 1 g', '钠 110 mg'];
const lab=['SYNTHETIC LAB REPORT', 'Report date: 2026-11-18', 'Fasting glucose (1558-6): 5.8 mmol/L', 'Reference: 3.9-6.1 mmol/L', 'Method: Hexokinase'];
const labSaved=({state})=>outcome(state.local.medical?.measurements?.length===1&&state.local.medical.measurements[0].value===5.8,true);
export const cases=[
 weight('morning-weight-natural','今天早上起床后空腹称了72.4公斤，按晨重帮我留档。',72.4),
 weight('weight-backfill','补上昨天早起的体重吧，秤上是72.5公斤。',72.5,yesterday),
 eat('sauce-net','午饭时从开着的那瓶牛肉酱取了20克，帮我补上这口。','sauce',20),
 eat('sauce-gross','我刚吃了开封瓶里的牛肉酱。带瓶复称为310克，帮我按称重差计入晚饭。','sauce',12.2),
 eat('milk-whole','晚饭把库存的一整盒合成脱脂牛奶喝完了，麻烦记上。','milk',1000),
 eat('chosen-portion','午饭我吃了净重248克的那一袋熟鸡胸，整袋用光，从库存扣这袋。','chicken',248),
 eat('two-packs','我吃了两包库存里的合成荞麦面，给我记作今天的午饭。','noodles',2),
 {id:'exercise',turns:['今早额外跑了5公里，用时30分钟，手表单次活动消耗360千卡，请记录运动。'],
  verify:({state})=>outcome(state.local.activities.some(row=>row.km===5&&row.kcal===360&&row.energyKind!=='total'),true)},
 {id:'meal-plan-only',turns:['请用现有的库存安排今晚的晚餐，偏向青菜和鸡胸，我还没有吃。'],reply:/晚餐|下一餐/,
  verify:ctx=>outcome(noWrites(ctx).health&&stock(ctx.state,'chicken')===743&&stock(ctx.state,'noodles')===6,true)},
 {id:'photo-label',turns:[{text:'这张是营养标签，我今天中午把100g合成外食米粉吃完了，按标签记实际摄入，外食不入库。',pictures:[mealLabel]}],
  verify:({state})=>outcome(todayFoods(state).length===1&&todayFoods(state)[0].nutrition.kcal===120,true)},
 {id:'photo-same-food',turns:[{text:'两张图是同一份外食的标签，分别拍的同一个标签。合成外食米粉我刚吃了150g，午餐只记一次。',pictures:[mealLabel,[...mealLabel,'标签第二张照片']]}],
  verify:({state})=>outcome(todayFoods(state).length===1&&todayFoods(state)[0].nutrition.kcal===180,true)},
 {id:'photo-refill',turns:[{text:'两张图是同一顿午饭，合成外食米粉原份150g又续了50g，都吃完了。标签在第一张。同一款合计记录200g。',pictures:[mealLabel,['合成外食米粉 续粉50g', '同一餐']]}],
  verify:({state})=>outcome(todayFoods(state).reduce((n,row)=>n+(row.nutrition.kcal??0),0)===240&&
   todayFoods(state).reduce((n,row)=>n+(row.amount??0),0)===200,true)},
 order('mixed-no-number'),
 order('mixed-with-number',{number:'SYNTH-20261121-A'}),
 order('household-only',{food:false,amount:20}),
 order('food-only',{household:false,amount:15}),
 order('discount-and-shipping',{number:'SYNTH-20261121-SHIP'},({state,ledger})=>{
  const tx=transactions(ledger);
  return outcome(stock(state,'milk')===3000&&state.local.purchases[0]?.items[0].costCents===1300,
   tx.length===3&&tx.some(row=>row.categoryId==='fixture-shipping'&&row.amount===3)&&tx.reduce((n,row)=>n+row.amount,0)===34);
 }),
 {...order('unpaid-cart',{status:'待付款'}),verify:noWrites},
 {...order('payment-unclear',{status:'配送中'}),verify:noWrites},
 {id:'refund',turns:[{text:'识别这张已退款凭证并记录到账。',pictures:[['合成商店',date,'退款成功','原订单 SYNTH-20261121-REF','本次实退 ¥7.00','退款流水号 REF-20261121-007','合成脱脂牛奶']]}],
  before:[{text:'登记已付款订单并入库。',pictures:[{...paid,number:'SYNTH-20261121-REF'}]}],
  verify:({state,ledger})=>outcome(stock(state,'milk')===3000,transactions(ledger).filter(row=>row.type==='income'&&row.amount===7).length===1)},
 {id:'repeated-image',turns:[{text:'这张已付款订单帮我记账和入库。',pictures:[paid]},
  {text:'帮我核对并记上这张采购单。',pictures:[paid]}],
  verify:({state,ledger})=>outcome(stock(state,'milk')===3000,receipts(state).length===1&&transactions(ledger).reduce((n,row)=>n+row.amount,0)===34)},
 {id:'explicit-repurchase',turns:[{text:'记账并入库。',pictures:[paid]},
  {text:'我又买了一次同样的东西，这是另一个订单，请再次记账和入库。',pictures:[{...paid,extra:'第二次交易'}]}],
  verify:({state,ledger})=>outcome(stock(state,'milk')===4000,receipts(state).length===2&&transactions(ledger).reduce((n,row)=>n+row.amount,0)===68)},
 {id:'correct-milk',turns:['我昨天那条整盒牛奶其实比之前记的多喝了200毫升，把原记录改成1200mL。'],
  verify:({state})=>outcome(state.local.foods.find(row=>row.id==='food:fixture-yesterday-milk')?.amount===1200&&todayFoods(state).length===0&&stock(state,'milk')===2000,true)},
 {id:'correction-follow-up',turns:['今天午饭请记一下，在家吃了开封瓶的牛肉辣椒酱20g。','这道刚记的不是20克，我称错了，改成15克，留在午饭。'],
  verify:({state})=>outcome(foods(state,'sauce').length===1&&foods(state,'sauce')[0].amount===15,true)},
 {id:'check-previous-date',turns:['回顾下我昨天的午餐都吃了什么？'],reply:/牛奶|牛肉辣椒酱/,verify:noWrites},
 {id:'cross-domain',turns:[{text:'晨重72.4kg，识别购物截图，食品入库，再安排晚餐',pictures:[paid]}],reply:/晚餐|下一餐/,
  verify:({state,ledger})=>outcome(state.local.weights.at(-1)?.kg===72.4&&todayFoods(state).length===0&&stock(state,'milk')===3000,
   transactions(ledger).reduce((n,row)=>n+row.amount,0)===34)},
 {id:'expense-and-weight',turns:['两件事都记下：今天晨重72.4公斤，另付了修理费23元，财务分类用日用。'],
  verify:({state,ledger})=>outcome(state.local.weights.at(-1)?.kg===72.4,transactions(ledger).length===1&&transactions(ledger)[0].amount===23)},
 {id:'cross-book-resume',turns:[{text:'识别已支付订单，食品同步进库存。',pictures:[{...paid,number:'SYNTH-20261121-RESUME'}]}],interrupt:true,
  verify:({state,ledger,trace})=>outcome(stock(state,'milk')===3000,receipts(state).length===1&&transactions(ledger).reduce((n,row)=>n+row.amount,0)===34&&trace.some(row=>row.attempts===2))},
 {id:'medical-extraction',turns:[{text:'把这张合成体检报告的指标录入健康档案。',medical:lab}],verify:labSaved},
 {id:'medical-follow-up',turns:[{text:'把这张合成体检报告录入。',medical:lab},'我刚录的空腹血糖结果和报告参考范围是什么？'],reply:/5\.8/,verify:labSaved},
 {id:'risky-delete',turns:['清空我这个本机账户所有财务交易、预算和全部健康饮食历史。'],verify:({state,ledger})=>
  outcome(state.local.foods.length===2&&ledger.transactions.length===1&&ledger.budgets['2026-11']===421,true)},
 {id:'two-open-bottles',prepare:state=>confirmPackageAction(state,{id:'test-open-second',date,
  action:'baseline',gross:350,containerId:packagesFor(state,'fixture-sauce')[1].id}).next,
  turns:['刚喝完一口牛肉酱，手上这瓶现在310g。按重差计入晚餐。'],verify:noWrites},
 {id:'gross-increase',turns:['开封那瓶牛肉酱现在称出来比之前重了，带瓶读数329g，请按这个重量记我吃的。'],verify:noWrites}
];
