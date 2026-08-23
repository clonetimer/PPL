# PPL Stable Release Kit Validation — 2026-08-20

本文件记录统一 Stable Release Kit 在最终封包前重新执行的**发布级验证**。它不替代各产品原有 promotion evidence，而是验证本 Kit 自身没有因为重新整理源码、文档和 npm artifacts 而破坏可用性。

## 1. Archive integrity

逐个执行 archive integrity 检查：

- 10 个单产品 Stable Source ZIP：PASS；
- 1 个 `PPL_All_Stable_Source_2026-08-20.zip`：PASS；
- 1 个 DeepSeek Harness clean integration ZIP：PASS；
- 12 个 npm TGZ：PASS。

## 2. Source version metadata

从各 Stable Source ZIP 内部 `package.json` 重新读取版本：

```text
PPL Core / pplc-reference                 0.3.0
PPL Runtime / @ppl/runtime                0.1.0
@ppl/adapter-dsh                          0.1.0
@ppl/app-dsh-persona-inspector            0.1.0
PPL Profiles                              0.2.0
  @ppl/profile-core                       0.2.0
  @ppl/profile-runtime                    0.2.0
  @ppl/profile-tutor                      0.2.0
  @ppl/profile-research                   0.2.0
PPL Observatory                           0.5.0
  @ppl/app-core                           0.5.0
  @ppl/app-ui                             0.5.0
  @ppl/app-standalone                     0.5.0
  @ppl/app-adapter-dsh                    0.5.0
ppl-llm-host-adapter                      0.1.6
@ppl/provider-openai-compatible-local     0.1.0
@ppl/lmstudio-native-judge-transport      0.1.0
@ppl/host-binding-life                    0.1.0
```

全部与 `STABLE_VERSION_MATRIX.md` 一致。

## 3. Fresh offline install — Application Host Stack

在全新空目录中，仅使用 Release Kit 的本地 TGZ 执行：

```text
ppl-llm-host-adapter-0.1.6.tgz
ppl-provider-openai-compatible-local-0.1.0.tgz
ppl-lmstudio-native-judge-transport-0.1.0.tgz
ppl-host-binding-life-0.1.0.tgz
```

`npm install --offline`：PASS。

随后从 fresh install 导入并验证：

- `createPplLlmHostAdapter`：PASS；
- `createRecoverableToolMediatedAgentLifecycle`：PASS；
- `runRecoverableToolMediatedAgentTurn`：PASS；
- `createOpenAICompatibleChatTransport`：PASS；
- `createLmStudioNativeJudgeTransport`：PASS；
- `compileLifeHostRequest`：PASS。

## 4. Fresh offline install — Profiles 0.2

在全新空目录中安装：

```text
ppl-profile-core-0.2.0.tgz
ppl-profile-runtime-0.2.0.tgz
ppl-profile-tutor-0.2.0.tgz
ppl-profile-research-0.2.0.tgz
```

`npm install --offline`：PASS；四个 package public exports 均可 import：PASS。

## 5. Fresh offline install — Observatory 0.5

在全新空目录中安装：

```text
ppl-app-core-0.5.0.tgz
ppl-app-ui-0.5.0.tgz
ppl-app-standalone-0.5.0.tgz
ppl-app-adapter-dsh-0.5.0.tgz
```

`npm install --offline`：PASS。

Public surface：

- `@ppl/app-core` import：PASS；
- `lifecycleOverview`：PASS；
- `@ppl/app-ui` import：PASS；
- `@ppl/app-adapter-dsh` import：PASS；
- `ppl-observatory` CLI 启动：PASS；
- 本地 HTTP GET `/` 返回 Observatory HTML：PASS。

`@ppl/app-standalone` 是 CLI/Web APP package，不声明库 `exports`；因此正确验证入口是 `ppl-observatory`，不是 `import('@ppl/app-standalone')`。

已知的非功能性显示遗留：Stable `server.mjs` 启动日志仍输出 `PPL Observatory 0.4.0` 字符串；package/version/contracts/promotion artifacts 均为 **0.5.0 Stable**。部署指南已明确标注该 stale display string。

## 6. DeepSeek Harness clean kit

`ppl-stable-clean-dsh-kit-2026-08-19.zip` archive integrity：PASS；确认包含：

- `install-clean-ppl-stable.mjs`；
- `verify-clean-ppl-stable.mjs`；
- Core 0.3.0 source；
- Runtime 0.1.0 npm artifact；
- DSH Adapter 0.1.0 npm artifact；
- Persona Inspector 0.1.0 source；
- clean install replay/diff evidence。

该 integration 的已认证 reference host 为：

```text
DeepSeek Harness 0.1.0-rc.7
commit 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca
```

本 Release Kit 构建环境没有该完整 DSH checkout，因此本次仅重新验证 integration artifact 完整性和结构；**没有把这次 Kit validation 冒充成新的 DSH host certification**。实际部署应严格按 `deployment/deepseek-harness/PPL_DEEPSEEK_HARNESS_DEPLOYMENT.md` 的 clean-host Gate 执行。

## 7. Evidence boundary

本 Kit 只把已经完成 Stable promotion 的组件列为 Stable。以下明确排除：

- Host 0.1.7-rc.1；
- LM Studio Native Agent Transport RC；
- OpenAI Responses Provider Preview。

Local Provider 0.1.0 的当前 PPL 实证资格中，LM Studio + Qwen3.5-0.8B 是 live-certified 路径；Ollama/vLLM/llama.cpp 属于 protocol/conformance-qualified 路径，需要针对实际 server/model 独立认证。
