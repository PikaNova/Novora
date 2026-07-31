import { useEffect, useState } from "react";
import { fetchAnnouncements } from "../../services/announcements";
import type { Announcement } from "../../services/announcements";

export function useAnnouncementsSettings() {
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(true);

  // 每次进入设置页都强制拉取最新公告（绕过缓存），确保 md 公告内容及时更新。
  useEffect(() => {
    let alive = true;
    setAnnLoading(true);
    fetchAnnouncements(true)
      .then((list) => {
        if (alive) setAnns(list);
      })
      .finally(() => {
        if (alive) setAnnLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { anns, annLoading };
}
