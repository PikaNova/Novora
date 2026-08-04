import { useRef, useState, type ChangeEvent } from "react";
import { School } from "lucide-react";
import InlineSelect from "../InlineSelect";
import { CHINA_PROVINCES, schoolFullName } from "../../data/provinces";
import { useSchoolInfoSettings } from "../../hooks/settings/useSchoolInfoSettings";
import { fileToSquareDataUrl } from "../../utils/imageResize";

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
    schoolLogo,
    setSchoolLogo,
    schoolSave,
    saveSchoolName,
  } = useSchoolInfoSettings(canEditSchool);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");
  const handleLogoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const url = await fileToSquareDataUrl(file);
      setSchoolLogo(url);
      setUploadError("");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图标上传失败");
    }
  };

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
          <div className="set-row">
            <label className="set-label">学校图标</label>
            <div className="set-school-logo">
              {schoolLogo ? (
                <img className="set-school-logo__img" src={schoolLogo} alt="学校图标" />
              ) : (
                <span className="set-school-logo__empty">
                  <School size={18} aria-hidden="true" />
                  未设置
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={handleLogoFile}
              />
              <button
                type="button"
                className="set-btn"
                disabled={!canEditSchool}
                onClick={() => fileInputRef.current?.click()}
              >
                上传图标
              </button>
              {schoolLogo && (
                <button
                  type="button"
                  className="set-btn"
                  disabled={!canEditSchool}
                  onClick={() => setSchoolLogo("")}
                >
                  移除
                </button>
              )}
            </div>
            {uploadError && (
              <p className="set-note set-note--warn">{uploadError}</p>
            )}
            <p className="set-note">
              图标会显示在考试页顶部与首页学校信息左侧；自动裁剪为正方形并压缩至 256×256。
            </p>
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
