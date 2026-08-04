import InlineSelect from "../InlineSelect";
import { CHINA_PROVINCES, schoolFullName } from "../../data/provinces";
import { useSchoolInfoSettings } from "../../hooks/settings/useSchoolInfoSettings";

export default function SchoolInfoSection({
  canEditSchool,
}: {
  canEditSchool: boolean;
}) {
  const {
    schoolName,
    setSchoolName,
    province,
    setProvince,
    schoolSave,
    saveSchoolName,
  } = useSchoolInfoSettings(canEditSchool);

  return (
        <section className="set-card">
          <div className="set-card__head">
            <h2 className="set-card__title">学校信息</h2>
          </div>
          <p className="set-card__lead">
            学校名称会显示在班级考试安排预览和 A4 PDF 页眉中。
          </p>
          <div className="set-row">
            <label className="set-label">省份 / 地区</label>
            <InlineSelect
              className="set-input"
              disabled={!canEditSchool}
              value={province}
              onChange={setProvince}
              options={[
                { value: "", label: "请选择省份或地区" },
                ...CHINA_PROVINCES.map((item) => ({
                  value: item,
                  label: item,
                })),
              ]}
            />
          </div>
          <div className="set-row">
            <label className="set-label">学校名称</label>
            <input
              className="set-input"
              maxLength={80}
              disabled={!canEditSchool}
              value={schoolName}
              onChange={(event) => setSchoolName(event.target.value)}
              placeholder="请输入学校名称"
            />
          </div>
          <div className="set-note">
            完整校名：
            <strong>
              {schoolFullName(province, schoolName) || "尚未填写"}
            </strong>
          </div>
          <button
            className="set-btn set-btn--primary"
            disabled={!canEditSchool || !province || !schoolName.trim()}
            onClick={() => void saveSchoolName()}
          >
            保存学校信息
          </button>
          {schoolSave && (
            <p className="set-note" aria-live="polite">
              {schoolSave}
            </p>
          )}
        </section>
  );
}
