// 部署形态开关。
//
// 边缘缓存与“心跳携带版本号”这套 HTTP 轮询优化只在 Vercel 部署启用：
// 本地 / Docker / 内网部署后续会改成 WSS 推送，两套机制同时生效只会互相干扰，
// 所以这里显式隔离，未命中时全部走改造前的旧行为。
export function isEdgeDeployment(): boolean {
  return process.env.VERCEL === '1';
}
