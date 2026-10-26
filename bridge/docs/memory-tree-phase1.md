# 小鲸鱼记忆树第一阶段

第二、第三阶段已接续实现，当前功能与限制见 [memory-tree-phase23.md](memory-tree-phase23.md)。下文保留第一阶段原说明。

数据：`state/memory-tree.sqlite`，SQLite WAL。本地处理不调用额外模型或收费 API，工具往返和注入文字仍占 DSH 上下文。需要支持 `node:sqlite` 的 Node（推荐 Node 24）。

按 QQ 群/私聊 key 隔离。人物用稳定 QQ ID 归档，昵称保留别名；同昵称多人须用 QQ ID。记忆包含 fact/event/agreement/thought、固定 factKey、来源消息引用、证据类别、有效期、状态、前版本和关联。

新工具 `qq_memory_tree` 支持 store/recall/forget。旧 DSH MCP 连接无需重启：使用 `qq_memory_append`，category=activeTopic，content=JSON 字符串，例如 `{"_memoryTree":1,"action":"recall","q":"闪退"}`。完整规则在全局人格提示词中，每次唤醒按现有方式加载。新连接才会发现正式新工具。

store 必须给当前会话真实收到的 sourceSeq。桥接校验发送者、引用及会话，内容是否准确仍依赖模型理解；不会因为存在消息引用就证明提炼正确。reported/inference/joke 不参加默认召回。自己的输出不可作证据。修正必须匹配原 kind/主体/factKey 并提供 replacesId，不能用更早来源或转述覆盖本人明确陈述。依赖旧版本的关联摘要撤为待核实。

forget 必须提供本人或管理员要求遗忘的消息 seq；撤下版本链、显式依赖分支、来源摘录和索引，留下防止重新提取的指纹。批量清空和旧控制台编辑只限管理端。不能自动识别所有没有显式关联的改写副本。备份和 QQ 原始数据库不随遗忘删除，需另行管理。

旧数组在启动时迁移一次，全部保留为 legacy/unverified，不补造原始来源；有歧义的昵称不强行归人。成功后清空旧运行数组，SQLite 成为唯一记忆源。升级前请自行备份旧 social-v2.json 和 SQLite 数据库。

自动检索只在当前会话执行关键词与人物筛选，默认排除过期/被替换/已遗忘/待核实内容；紧凑注入以约900的保守字符估算预算限制，并非模型实际 token 计量。已完成记录可作为背景，交接只带未完事项引用。轮换阈值沿用当前配置，轮换前保存引用与目标快照，不额外调用总结模型。即时情绪仍用原独立模块。

测试：`node --test scripts/test-memory-tree.mjs scripts/test-inner-life.mjs scripts/test-prompt-economy.mjs`。在 staging 测试时设 QQ_BRIDGE_DEPENDENCIES 指向正式安装目录。测试使用真实临时 SQLite、HTTP 和 MCP；不发送 QQ 消息。

后续阶段已实现图像观察、工具经历、表达候选和本地语义检索，参见第二、第三阶段文档。
