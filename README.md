# Airplane PWA 1.0.0-rc.1

Airplane 是本地优先的财务和健康账本。财务、健康和助手通过顶部图标切换。底部「＋」打开手动录入，健康首页按日期显示饮食、体重和运动。当前版本供真机验收。

## 运行与更新

在仓库根目录运行，浏览器访问 [本机 Airplane](http://127.0.0.1:8080/)。

```sh
python3 serve.py
```

首次在线打开并完成缓存后，财务、健康和助手页面均可离线打开。旧设备应继续使用原站点地址和浏览器配置。在设置中打开「程序更新」，检查并安装新版。静态开发服务器仅提供 PWA 壳资源。

## 账本与备份

- 财务包含收支、分类、月预算、收入同步预算、预算外支出、余额调整和统计。健康包含实际饮食、餐单计划、趋势、减脂周期和个人健康档案。
- 库存按批次、独立包装和称重维护。食品采购可联动原财务交易，饮食消耗只记摄入与库存。采购更正和撤销会检查关联交易、批次与后续消耗。
- 健康设置支持健康、财务及可选 AI 数据的统一备份，体检和聊天附件可选择导出。恢复应先预览，账本替换会在本机保存恢复前快照。财务设置继续接受旧账本和完整备份。
- 外部健康主账使用「合并导入」及同步包，可预览差异并核对冲突。[健康账本文件往返与 CLI 用法](docs/HEALTH_SYNC.md)
- 财务沿用 `airplane-pwa-v1` 和 `airplane-pwa-recovery-v1`。旧账户码档案可在原站点附加 `?private=1` 导出。

## AI 助手

- 在助手设置导入自己的 OpenAI API Key。在线推理由用户选用的模型处理。简单、明确的单项记录自动优先 Luna，复杂任务和附件优先 Terra，也可手动指定模型。
- 模型按需读取本轮许可的本机数据。相关用户消息、Skills、记忆和选定附件会参与请求。账本由本机工具写入和校验。低风险任务可分别授权自动执行，敏感批量操作遵循当前权限。所有者模式及恢复边界见 [所有者数据控制](docs/OWNER_CONTROL.md)。
- 识别照片、采购和饮食时会同时给出食品类别。已分类的 SKU 优先复用；用户可要求更正 SKU 或单次饮食的类别。混合菜不以整份重量计入蔬菜。
- 餐单试算会检查实际摄入、剩余计划、库存和当天营养目标。计划不计入实际摄入或扣库。执行详情可查看工具、保存回执、模型和用量，支持可撤销的更正。
- 对话、稳定习惯和自定义 Skills 保存在当前浏览器。中断后可从历史对话继续。历史照片可按 ID 读取当前会话中仍保存在设备上的附件。

[打开本机演示](http://127.0.0.1:8080/assistant/?demo=1) 可用合成账本体验批准、保存和续办，无需 Key。

## 验证

```sh
npm ci
npm test
npm run test:browser
npm run test:health-actions-ui
npm run test:inventory-ui
npm run test:medical-ui
npm run test:model-agent-ui
npm run test:owner-ui
npm run test:ui-format
npm run test:release-upgrade
npm run test:worker
node tools/merge-health.mjs --help
```

浏览器回归使用 Chrome 或 Chromium 和合成账本，可用 `CHROME_PATH` 指定浏览器。历史升级测试需保留对应 Git 提交。真实模型评测可用 `npm run test:model-agent-live`，它通过标准输入接收 Key，使用合成数据。真机验收和线上发布是候选版之后的独立步骤。
