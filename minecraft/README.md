# Minecraft 伙伴服务

这是可选的本地 Minecraft Java 机器人服务，和 QQ 桥配合使用。服务只监听本机 `127.0.0.1:63200`，应只在可信计算机上运行；打开服务后，同机进程可以调用游戏动作。

## 配置和启动

1. 先完成根目录的机器人和 DSH 配置，在 `bridge/config.json` 中把 `minecraft.enabled` 设为 `true`。按需修改端口，保持桥和游戏服务一致；默认端口为 63200。
2. 将本目录 `config.example.json` 复制为 `config.json`，填写 Minecraft 服务器地址、端口、机器人用户名和玩家名。示例默认关闭自动跟随和自主探索，不包含个人数据。服务器与账号授权由使用者自行确认。
3. 在仓库根目录执行 `npm --prefix minecraft ci`，再执行 `npm --prefix minecraft start`。桥接目录与本目录为兄弟目录；如果桥在其他位置，设置环境变量 `QQ_BRIDGE_DIR` 指向实际桥目录。
4. 使用 DSH 插件的“Minecraft”页面查看连接和状态；需要自主游玩时，由使用者明确启用。服务重连、目标状态和工具结果以实际返回为准。

默认配置为普通 Java 1.12.2 的离线模式示例，不能保证适配每个服务端。Forge 本地局域网发现为可选功能：仅在明确填写 `forge.localGameDir` 与 `forge.localWorldName` 时使用，不能保证适配所有整合包。

`config.json`、`home.json` 和游戏数据均为本地运行数据，不能提交。依赖安装脚本会为当前受支持版本的寻路器检查门碰撞补丁；上游实现变化时会报错，需要先审查兼容性。测试：`npm --prefix minecraft test`。
