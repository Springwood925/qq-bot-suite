# 安装本地语义记忆

基础记忆树使用 Node 自带 SQLite；推荐 Node 24。没有本地嵌入运行库时保留关键词检索，不会改用云端嵌入服务。运行库和模型不包含在 Git 仓库中。

在 `bridge` 目录运行：

```sh
npm ci
npm run setup:memory
```

安装脚本用版本锁定的清单安装独立运行库，并从 Hugging Face 下载固定 revision 的模型文件，逐文件核对 SHA256。首次安装需要网络；正常检索仅在本机 CPU worker 中执行，禁用模型联网。模型为 `Xenova/bge-small-zh-v1.5`，q8、512 维、CLS pooling、最大 256 token，revision 和校验值见 `runtime-manifests/memory/model.json`。

模型位于 `models/bge-small-zh-v1.5`，运行库位于 `local-memory-runtime`，均属于本地安装产物。不要把这些目录、聊天状态、配置或数据库推送到代码仓库。各平台只需要对应的原生运行文件；不要将某台电脑精简后的 Windows 运行库打包分发给其他平台。

安装后重启桥接，在插件详情页的记忆树查看模型是否就绪及索引覆盖。可运行 `npm run test:memory-semantic`，使用虚构数据验证真实本地向量、遗忘与权限隔离；不会发送 QQ 消息或调用收费模型。

也可通过 `QQ_MEMORY_RUNTIME` 和 `QQ_MEMORY_MODEL` 为安装检查和测试指定已有运行库、模型位置。`node scripts/setup-memory-runtime.mjs --verify-only` 仅核对已有模型文件和运行库入口，不安装或下载。

Codex 辅助读图和生图是独立的可选功能。将 `codex-media.example.json` 复制为本机的 `codex-media.json`，按需设置 `enabled: true`；还需安装并登录兼容的 Codex CLI。凭据由 CLI 自己管理，不填写在仓库中。它沿用订阅能力及用量规则，不能据此承诺没有订阅限制。未启用时保留原有图片链路。
