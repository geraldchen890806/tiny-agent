# tiny-agent

一个从 30 行长到 v1.0 的迷你 AI Agent，用来配合博客系列《从 useEffect 到 Agent Loop》—— 前端人的 Agent 入门。

**每篇博客对应一个 tag**，你可以 checkout 任意进度上车：

| tag | 对应博客 | 本版本长出的器官 |
|---|---|---|
| `v0.1` | 01 Agent Loop | 30 行裸循环：while + Anthropic API + 1 个工具（读文件） |
| `v0.2` | 02 Context | 历史管理 + 简易上下文压缩 + prompt caching |
| `v0.3` | 03 Tools | 工具箱扩到 3 个 (read/write/list) + 手写 input schema 校验 + is_error 反馈 |
| `v0.4` | 04 Prompt | system prompt 重写（前后行为对比） |
| `v0.5` | 05 记忆 | markdown 记忆文件 + 朴素检索 |
| `v0.6` | 06 容错 | 重试/退避 + verifier 自检 |
| `v0.7` | 07 权限 | 危险操作确认门（PreToolUse） |
| `v0.8` | 08 Subagent | spawn subagent（上下文隔离） |
| `v0.9` | 09 Evals | evals/ 目录 + 用例集跑通过率 |
| `v1.0` | 10 生产 | tracing + 成本统计 + 部署 |

## 设计原则

1. **无框架**：不用 LangChain / Anthropic Agent SDK，只用 `@anthropic-ai/sdk` 裸接口。你要看清楚每一层在做什么
2. **依赖最少**：`package.json` 越薄越好
3. **每篇一个 tag**：读者可以 `git checkout v0.3` 精确回到某一篇讲完时的状态
4. **可跑**：`node src/agent.js "你的问题"` 就能跑

## 快速开始

```bash
git clone git@github.com:geraldchen890806/tiny-agent.git
cd tiny-agent
npm install
export ANTHROPIC_API_KEY=sk-ant-...
node src/agent.js "帮我读一下 README.md 说了什么"
```

## 上生产 checklist（v1.0）

十条，一条都别省（对应博客第 06/07/09/10 篇）：

1. **美元预算**：每任务熔断线（`BUDGET_USD`），90% 早停、留最后一口气写 checkpoint
2. **超时**：每任务墙钟上限——卡死的任务占着队列比烧钱更常见
3. **步数闸**：`MAX_STEPS`，主循环和子循环都要有
4. **限流与鉴权**：agent 端点是全网单价最高的 HTTP 端点，被刷等于替人挖矿
5. **trace 落盘**：每步一条 span（JSONL），含压缩 mini-call 和子 agent 回传的账
6. **checkpoint / --resume**：熔断不是失败，是暂停；messages 序列化即可续跑
7. **回滚纪律**：要么走完，要么什么都没改——半路状态是最贵的状态
8. **评测体检**：每周跑一遍 `node src/eval.js`，盯通过率趋势，不盯单次
9. **告警阈值**：步数翻倍、cache 列归零、成本分布右移——都是提前量
10. **密钥管理**：`ANTHROPIC_API_KEY` 只进环境变量，不进代码、不进日志、不进 trace

## 系列博客

- 系列首页：https://chenguangliang.com/tags/agent入门系列/
- 主 SDK：Anthropic Claude（每篇有"国内替代方案"注脚）
- 作者：Gerald Chen ｜ https://chenguangliang.com

## License

MIT
