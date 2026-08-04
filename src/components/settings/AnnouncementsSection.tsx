import { Megaphone } from "lucide-react";
import AnnouncementList from "../AnnouncementList";
import { formatDateTimeInZone } from "../../utils/timeSource";
import { useAnnouncementsSettings } from "../../hooks/settings/useAnnouncementsSettings";

/**
 * 设置页“公告”卡片。从 SettingsPage.tsx 提取，行为与原页面完全一致。
 */
export default function AnnouncementsSection() {
  const { anns, annLoading } = useAnnouncementsSettings();

  return (
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <Megaphone aria-hidden="true" />
              公告
            </h2>
          </div>
          <p className="set-card__lead">
            由作者端统一发布，内容以 Markdown 渲染。
          </p>
          {annLoading ? (
            <p className="set-note">公告加载中…</p>
          ) : anns.length === 0 ? (
            <p className="set-note">暂无公告。</p>
          ) : (
            <AnnouncementList
              announcements={anns}
              formatTime={(value) => formatDateTimeInZone(value)}
            />
          )}
        </section>
  );
}
