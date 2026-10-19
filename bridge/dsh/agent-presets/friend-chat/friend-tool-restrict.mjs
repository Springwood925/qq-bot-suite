// 朋友聊天（网页版）安全硬边界。
//
// 为什么需要这个文件：DSH 的 MCP 工具是**全局挂载**的——qq-bridge 给 QQ 机器人装的
// 那 36 个 QQ 工具（mcp__snowluma__*，能往任意群/好友发消息、改群名片、拍一拍……）
// 会出现在**每一个** DSH 会话里，包括网页聊天会话。不管的话，任何拿到网页链接的人
// 就能让机器人往老板的客户群里发消息。
//
// 这个 preset 的边界：
//   - 网页会话【不能】碰这台电脑（本 preset 不挂任何本地工具：无 bash / 无文件读写 / 无子代理）
//   - 网页会话【不能】用任何 QQ 工具（下面 restrict 隐藏 + guard 执行期兜底）
//   - 只允许：联网搜索/抓取、提问、任务列表
export const name = 'friend-tool-restrict'

export const inject = ['tools']

// 明确屏蔽：QQ 相关的两套 MCP + 开发注入器。
// restrict 只影响继承来的全局层，不会误删 preset 自己注册的工具。
const DENY_TOOLS = [
  'mcp__snowluma__qq_send_message',
  'mcp__snowluma__qq_send_group_message',
  'mcp__snowluma__qq_send_private_message',
  'mcp__snowluma__qq_reply',
  'mcp__snowluma__qq_send_burst',
  'mcp__snowluma__qq_send_sticker',
  'mcp__snowluma__qq_send_poke',
  'mcp__snowluma__qq_collect_sticker',
  'mcp__snowluma__qq_wait_for_messages',
  'mcp__snowluma__qq_set_wake_config',
  'mcp__snowluma__qq_mark_read',
  'dev_build_plugin',
  'dev_clear_routes',
  'dev_fix_patch',
  'dev_heal_links',
  'dev_inject_plugin',
  'dev_injected_list',
  'dev_install_package',
  'dev_plugin_status',
  'dev_release_plugin',
  'dev_reload_package',
  'dev_scaffold_plugin',
  'dev_self_test',
  'dev_stage_add',
  'dev_stage_call',
  'dev_stage_demote',
  'dev_stage_list',
  'dev_stage_promote',
  'dev_uninject_plugin',
]

// 执行期白名单：不在范围内的工具一律拒绝（即使未来新增了没预料到的工具）。
const SAFE_PREFIXES = ['mcp__web-search-safe__']
const SAFE_EXACT = new Set(['ask_user_question', 'todo_write', 'web_search', 'web_fetch'])

export function apply(ctx) {
  for (const name of DENY_TOOLS) {
    try {
      ctx.tools.restrict({ deny: [name] })
    } catch (error) {
      // 名字不存在时跳过；执行期白名单仍然兜底。
      console.error(`[friend-tool-restrict] skip restrict ${name}: ${error?.message ?? error}`)
    }
  }

  ctx.tools.guard((exec) => {
    const name = exec?.name
    if (typeof name !== 'string' || name.length === 0) return
    if (SAFE_EXACT.has(name)) return
    if (SAFE_PREFIXES.some((prefix) => name.startsWith(prefix))) return
    return `工具 "${name}" 不在朋友聊天的白名单内，已拒绝（网页版只允许联网搜索这类无害工具）`
  })
}
