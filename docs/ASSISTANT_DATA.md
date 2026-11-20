# 助手数据规范

L · 数据与纠错规范指导模型通过 `read_app_data` 查询字段、计算、写入流程和特殊情况。读取某一笔时传数据集与记录 ID，也可以按日期或关键词定位。新记录的 ID 由程序生成，修改原记录时使用查询返回的 ID。用户核对前后值并确认后，应用才提交结构化变更。

## 字段和关系

| 数据集 | 字段及单位 | 保存与联动 |
| --- | --- | --- |
| `health_settings` | `calorieTarget`、`baselineTdee`、`cycleTarget` 用 kcal，`cycleAnchor` 是日期，`cycleDays` 是整数，营养目标用 g 或 mg | 日报和周期根据现行设置计算。已导入的消耗基线优先用于对应日期 |
| `foods` | `date`、`time`、`meal`、`name`、`portion`、`amount`、`amountUnit`、`nutrition`、`cost`、`status` | `actual` 记实际，`plan` 记计划，`cancelled` 记取消。实际摄入按原食物 ID 关联库存流水 |
| `weights`、`activities` | `kg`、`isMorning`；`km`、`minutes`、`kcal`、`energyKind`、`includedInBase` | `energyKind` 区分 `activity` 与 `total` |
| `inventory`、`batches`、`stock_moves` | `basisAmount`、`basisUnit`、`packageSize`、`packageUnit`、`piecesPerPack`；批次 `foodId`、`quantity`、`costCents`、`expires`；流水 `delta`、`batchId`、`linkedFoodId` | 采购与分装管理批次数量。流水恢复同组调整，关联消耗由原饮食撤销。档案可停用 |
| `purchases`、`shopping`、`templates` | 采购 `date`、`totalCents`、`items`；补货 `foodId`、`quantity`、`selected`；模板名称与来源日期、餐次 | 采购条目通过 `foodId` 和 `batchId` 跟踪实物，通过采购关联号对应支出 |
| `legacy_days`、`legacy_energy`、`legacy_rules` | 按日期的营养、摄入与消耗基线，按名称的历史规则 | 导入时保留原始来源，日常使用规范化记录及补报更正 |
| `transactions`、`categories`、`budgets`、`balances`、`finance_settings` | 收支类型 `expense` 或 `income`，金额用元，`budgetExcluded`、`budgetSync` 是布尔值，预算 ID 为 YYYY-MM | 月基础预算加同步收入得总预算。分类快照使已删除分类的旧交易继续可读 |
| `skills`、`conversations`、`assistant_settings` | Skill 名称、规则和启用状态，对话标题，模型和近期历史档位 | 内置 Skill 可关闭或覆盖。对话修改以标题或整段为单位 |

日期使用设备当地的 YYYY-MM-DD，时间为 HH:mm。五项营养的键为 `kcal`、`protein`、`carbs`、`fat`、`sodium`，单位分别是 kcal、g、g、g、mg。采购分币字段用整数。未知值用 `null`。

## 记账和计算

- 新增、补报、修改和撤销按发生日处理。修改已有饮食先撤销原扣库，再按改后的实际份量分配。新增计划只记录计划。已确认的补报改变当天及所在周期的合计。
- 营养按用量除以基准量后的比例计算。成本按已知批次剩余成本与使用比例分到分，未知成本单列。同一包装可由前后毛重差计算，已知皮重时也可毛重减皮重。体积和质量换算需要实测或可信规格。
- 每日缺口为有效总消耗减实际摄入。设备全天总消耗优先，专项活动只计未包含的消耗。周期按设置锚定分组，按已过的日期和已知实际摄入结算。累计缺口除以 7700 得理论脂肪当量。体重趋势比较最近七次有效晨重及上一窗口。
- 同一份餐的多张照片共享用餐事件。续加份量单独记。库存为未知时先实盘，明确无货的库存是零。同款记录先比对规格、营养、包装及批次，再核对采购和消耗来源。跨日补报使用实际发生日。

## 存储、备份和恢复

健康账本保存在 IndexedDB，修改使用版本号防止覆盖并发更新。财务账本在本机保留主副本和恢复副本，用原始账本版本防覆盖。有财务联动的采购先建立待同步记录，再更新财务，最后提交健康账本。遇到中断，从待同步记录继续，已写入的支出按关联 ID 核对，避免重复写入。冲突时先使用库存页核对待同步状态。

导出的健康 JSON、财务 JSON 和统一备份由本机账本生成。外部 SQLite 镜像和历史交接文件通过选定的导出文件更新。API Key、加密材料和恢复副本由应用自己的设置与恢复流程管理。
