import { useEffect, useState } from "react";
import { fetchAnnouncements } from "../../services/announcements";
import type { Announcement } from "../../services/announcements";

// Owns the announcements modal's open state and its lazily-fetched list.
export function useAnnouncements() {
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(false);

  useEffect(() => {
    if (!announceOpen) return;
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
  }, [announceOpen]);

  return { announceOpen, setAnnounceOpen, anns, annLoading };
}
