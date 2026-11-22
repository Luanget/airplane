import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeNote} from '../finance-note.mjs';
import {financeSchema,matches} from '../health/contract.mjs';

test('finance note preview limits visible characters without splitting Unicode clusters',()=>{
 const chef='👩‍🍳';
 assert.equal(summarizeNote('字'.repeat(20)),'字'.repeat(20));
 assert.equal(summarizeNote(chef.repeat(21)),chef.repeat(20)+'…');
 assert.equal(summarizeNote('  牛奶\n\t、  鸡蛋  '),'牛奶 、 鸡蛋');
 assert.equal(summarizeNote('A'.repeat(1000)),'A'.repeat(20)+'…');
});

test('a finance candidate can carry the full user-supplied multi-line note',()=>{
 const note='第一行\n'+'长'.repeat(1000)+'\n最后一行';
 const entry={type:'expense',amount:39.6,date:'2026-11-21',categoryId:'食品采购',note};
 assert.equal(matches(financeSchema,{note:'',entry}),true);
 assert.ok(entry.note.endsWith('\n最后一行'));
});
