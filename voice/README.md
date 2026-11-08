# QQ 语音通话服务

本目录包含可选的 Windows 本地通话服务源码和后台音频工作器。服务、设备、语音识别模型和 TTS 凭据需要使用者自行配置；仓库不包含 QQ 客户端、语音设备驱动、模型、个人音频、通话记录或运行配置。

完成根目录的桥接安装并在 `bridge/config.json` 配置所需语音识别和 TTS 后，在本目录运行 `node server.mjs`。默认读取相邻 `bridge` 目录；自定义位置可设置 `QQ_BRIDGE_DIR`。FFmpeg 可通过 PATH 或 `MC_FFMPEG` 配置；`CALL_WHISPER_MODEL` 可覆盖 Whisper 模型，`CALL_ASR_SCRIPT` 可选配本地识别脚本。使用前检查 DSH 面板的“语音通话”页和设备选择。

后台音频工作器使用 Python 的 `sounddevice`，可按平台安装到本目录 `audio-runtime` 或 Python 环境；当前 VAD 使用 `audioop`，需要支持该模块的 Python 版本（例如 3.10–3.12）。QQ 窗口检测依赖 Windows 本地 QQ。开始、结束和失败状态以服务实际返回为准，不能假定所有机器或版本都兼容。

本目录中 `voice-cache/`、`audio-runtime/`、通话会话文件及日志均属于本地数据，不应提交或分享。测试：`node --test voice/*.test.mjs`。
