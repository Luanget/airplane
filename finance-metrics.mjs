const amountOf=transaction=>Number(transaction.amount)||0;
const sumAmount=rows=>rows.reduce((sum,transaction)=>sum+amountOf(transaction),0);
const countsTowardBudget=transaction=>transaction.type==='expense'&&transaction.budgetExcluded!==true;
const addsBudget=transaction=>transaction.type==='income'&&transaction.budgetSync;

export function daysInMonth(month){
 const [year,number]=month.split('-').map(Number);
 return new Date(year,number,0).getDate();
}

export function transactionsForMonth(ledger,month){
 return (ledger?.transactions??[]).filter(transaction=>typeof transaction?.date==='string'&&transaction.date.startsWith(month));
}

export function currentBalanceFor(ledger,date){
 const net=(ledger?.transactions??[]).reduce((sum,transaction)=>{
  if(transaction.date&&transaction.date>date)return sum;
  return sum+(transaction.type==='income'?amountOf(transaction):-amountOf(transaction));
 },0);
 const adjustments=(ledger?.balanceAdjustments??[]).reduce((sum,row)=>sum+Number(row.delta||0),0);
 return Number(ledger?.prefs?.initialBalance??0)+net+adjustments;
}

export function monthlyBudget(ledger,month,rows=transactionsForMonth(ledger,month)){
 const baseBudget=Number(ledger?.budgets?.[month]??0),syncBudget=sumAmount(rows.filter(addsBudget));
 return {baseBudget,syncBudget,budget:baseBudget+syncBudget};
}

export function monthlyMetrics(ledger,month,today,rows=transactionsForMonth(ledger,month)){
 const {baseBudget,syncBudget,budget}=monthlyBudget(ledger,month,rows);
 const dimensions=daysInMonth(month),currentMonth=today.slice(0,7),todayNumber=Number(today.slice(8));
 const current=month===currentMonth,future=month>currentMonth,past=month<currentMonth;
 const elapsed=future?0:current?todayNumber:dimensions;
 const expenseRows=rows.filter(row=>row.type==='expense');
 const income=sumAmount(rows.filter(row=>row.type==='income'));
 const expense=sumAmount(expenseRows);
 const budgetExpense=sumAmount(expenseRows.filter(countsTowardBudget));
 const excludedExpense=sumAmount(expenseRows.filter(row=>!countsTowardBudget(row)));
 const baseDaily=baseBudget>0?baseBudget/dimensions:0;
 const averageDaily=budget>0?budget/dimensions:0;

 // A synchronized income boosts the allowance on its date in full. Expenses
 // outside the budget affect spending and balance but not the daily allowance.
 const todayBoost=current?sumAmount(rows.filter(row=>addsBudget(row)&&row.date===today)):0;
 const boostToDate=future?0:sumAmount(rows.filter(row=>addsBudget(row)&&(!current||row.date<=today)));
 const plannedToDate=baseDaily*elapsed+boostToDate;
 const delta=future?0:budgetExpense-plannedToDate;
 const remainingBudget=budget-budgetExpense;
 const todayRows=current?expenseRows.filter(row=>row.date===today):[];
 const todayTotalExpense=sumAmount(todayRows),todayExpense=sumAmount(todayRows.filter(countsTowardBudget));
 const todayExcludedExpense=Math.max(todayTotalExpense-todayExpense,0);
 const expenseBeforeToday=current?Math.max(budgetExpense-todayExpense,0):budgetExpense;
 const remainingDays=current?Math.max(dimensions-todayNumber+1,1):dimensions;
 const distributableBeforeToday=Math.max(budget-todayBoost-expenseBeforeToday,0);
 const dailyLimit=current?distributableBeforeToday/remainingDays+todayBoost:averageDaily;
 const todayDelta=todayExpense-dailyLimit;
 const timeProgress=future?0:elapsed/dimensions;
 const budgetProgress=budget>0?budgetExpense/budget:0;
 const projection=!future&&elapsed>0?budgetExpense/elapsed*dimensions:0;
 return {budget,baseBudget,syncBudget,todayBoost,income,expense,budgetExpense,excludedExpense,
  dim:dimensions,elapsed,baseDaily,averageDaily,dailyLimit,plannedToDate,delta,remainingBudget,remainingDays,
  todayExpense,todayTotalExpense,todayExcludedExpense,todayDelta,timeProgress,budgetProgress,projection,current,future,past};
}
