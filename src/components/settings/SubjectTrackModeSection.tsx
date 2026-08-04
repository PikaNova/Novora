import { ListChecks } from "lucide-react";
import { Switch } from "./Switch";
import { useSubjectTrackModeSettings } from "../../hooks/settings/useSubjectTrackModeSettings";

export default function SubjectTrackModeSection({
  canEditSettings,
}: {
  canEditSettings: boolean;
}) {
  const {
    subjectTrackModeEnabled,
    subjectTrackModeSave,
    subjectTrackModeSaving,
    saveSubjectTrackMode,
  } = useSubjectTrackModeSettings(canEditSettings);

  return (
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">
              <ListChecks size={18} />
              分科模式
            </h2>
            <Switch
              checked={subjectTrackModeEnabled}
              disabled={!canEditSettings || subjectTrackModeSaving}
              onChange={(value) => void saveSubjectTrackMode(value)}
            />
          </div>
          <p className="set-note">
            开启后：已分科班级按选科过滤，未分科班级读取全部 9 门。关闭后：所有科目按考试范围直接下放，不区分班级选科。
          </p>
          {subjectTrackModeSave && (
            <p className="set-note" aria-live="polite">
              {subjectTrackModeSave}
            </p>
          )}
        </section>
  );
}
