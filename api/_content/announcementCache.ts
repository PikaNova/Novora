// Share one upstream request among callers of the same warm server instance.
// Keep the existing 60-second freshness budget; this also works without a CDN.
//
// The upstream URL is part of the cache identity: 作者端可以把公告域名按服务下发（content/update
// 拆分），一旦下发的地址变了，旧地址的缓存必须立即失效，否则换域名要等到 TTL 到期才生效。
export function createAnnouncementCache(ttlMs = 60_000) {
  let cached: { url: string; at: number; items: Record<string, unknown>[] } | null = null;
  let flight: { url: string; promise: Promise<Record<string, unknown>[]> } | null = null;
  return async (
    url: string,
    load: () => Promise<Record<string, unknown>[]>,
    now = Date.now(),
  ): Promise<Record<string, unknown>[]> => {
    if (cached && cached.url === url && now - cached.at < ttlMs) return cached.items;
    if (flight && flight.url === url) return flight.promise;
    const promise = load()
      .then((items) => {
        cached = { url, at: Date.now(), items };
        return items;
      })
      .finally(() => {
        if (flight?.promise === promise) flight = null;
      });
    flight = { url, promise };
    return promise;
  };
}
