// Run privately. Only the hash goes in the server allowlist.
import {randomBytes} from 'node:crypto';
import {accountKeys} from '../account.mjs';
const code = randomBytes(32).toString('hex');
const {id} = await accountKeys(code);
console.log('私下交给使用者的账户码', code);
console.log('加入 AI_USERS 白名单的摘要', id);
