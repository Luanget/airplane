# Airplane Agent 运行架构

## 决策

0.9.18 先按关键词选择候选形状，再执行一次预定操作。营养试算与结账约束已经有本地业务函数，但模型在看见某些保存结果之前就离开了对话。新流程保留静态 PWA 和 Responses API，把重复的工具选择、纠错和最终回答交给模型。账本读写继续由既有本地业务函数负责。浏览器只需实现 Responses REST 传输、工具注册与检查点，免去部署一个 SDK 宿主或第三方运行环境。

以 `store:false` 逐轮重放完整的 Responses 输出项目，包含工具调用、对应结果、消息及不透明的加密推理项目。用同一模型延续进行中的请求，从低或中等推理强度开始，工具失败后提高强度。保存前先记录已经收到的工具调用；保存后核对业务回执，再保存工具结果。已有成功回执在同一任务中可复用。普通回答只在模型完成后进入对话历史。

## 参考与取舍

- OpenAI Codex 工具循环文章的调用与反馈交替，以及 App Server 文章的传输和任务状态分离，分别用于 Responses 事件和本地检查点。Harness Engineering 的反馈思路用于允许模型查看确定性校验失败并重新调用。 [工具循环](https://openai.com/index/unrolling-the-codex-agent-loop/) · [App Server](https://openai.com/index/unlocking-the-codex-harness/) · [反馈循环](https://openai.com/index/harness-engineering/)
- OpenAI Agents JS 的 `packages/agents-core/src/run.ts` 和 `runState.ts` 在处理响应后记录状态、工具护栏和待恢复调用。Airplane 借鉴这些边界，沿用本机已授权的业务执行函数。 [运行源码](https://github.com/openai/openai-agents-js/blob/main/packages/agents-core/src/run.ts) · [运行文档](https://developers.openai.com/api/docs/guides/agents/running-agents)
- 对话状态和推理文档支持本地重放完整输出项目。Mid-turn steering 的客户端入队思路用于区分本轮补充和下一轮消息。浏览器在工具边界接收补充。 [对话状态](https://developers.openai.com/api/docs/guides/conversation-state) · [推理](https://developers.openai.com/api/docs/guides/reasoning) · [Steering](https://developers.openai.com/api/docs/guides/steering)
- DeepSeek Harness 的 `steering-history.ts` 将下一步补充和下一轮消息设为不同 inbox 目标，重放时恢复来源。Airplane 使用本机任务和明确的补充入口承载这一差别。 [事件实现](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/client/ui-chat/src/client/model/steering-history.ts)
- OpenNutriTracker 的 `add_tracked_day_usecase.dart` 采用幂等日写入，照片解释 use case 将事实提取和错误分类留在独立边界。CalorieCoach 的 `meal_planning_service.py` 用确定性计算校验模型选出的份量，并把首轮结果交回模型调整。NutriTrace 的 `log-meal.js` 让工具和常规应用路由共用本地写入逻辑。 [日账实现](https://github.com/simonoppowa/OpenNutriTracker/blob/main/lib/core/domain/usecase/add_tracked_day_usecase.dart) · [餐单评估](https://github.com/MNGChen/CalorieCoach/blob/main/services/meal_planning_service.py) · [餐单写入](https://github.com/TraceApps/nutritrace/blob/main/server/lib/mcp/tools/log-meal.js)
