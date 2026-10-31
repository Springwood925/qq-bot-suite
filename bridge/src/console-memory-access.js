// 控制台管理入口不能复用机器人的会话令牌；GET 只接受只读操作。
const READ_ACTIONS = new Set(['overview','list','read','search','metrics','styleReviews','candidateStatus','affinity','diagnostics','evidence']);
export function checkConsoleMemoryAccess(req, action = 'overview') {
  if (req.headers['x-agent-token'] !== undefined) throw Object.assign(new Error('记忆与回顾管理仅限控制台'), {statusCode:403});
  if (req.method === 'GET' && !READ_ACTIONS.has(action)) throw Object.assign(new Error('写操作必须使用 POST'), {statusCode:405});
}
