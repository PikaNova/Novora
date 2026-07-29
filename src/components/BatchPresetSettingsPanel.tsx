import { useEffect, useState } from "react";
import type { MajorBatchSubjectGroup, MajorBatchTimeGroup, MajorBatchTimeSlot } from "../utils/appSettings";
import {
  APP_SETTINGS_CHANGED_EVENT,
  getAppSettings,
  updateMajorBatchSettings,
} from "../utils/appSettings";
import "../styles/batch-preset-settings-panel.css";

function makeSubjectGroupId() {
  return `batch_subject_group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeTimeGroupId() {
  return `batch_time_group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeSlotKey() {
  return `slot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

type DraftSlot = MajorBatchTimeSlot & { key: string };

/**
 * Admin settings panel for managing the custom subject groups and time
 * groups used by the "batch add sub-exams" workflow. Lets admins create,
 * reorder, and delete presets outside of the batch-add modal itself.
 */
export default function BatchPresetSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const [subjectGroups, setSubjectGroups] = useState<MajorBatchSubjectGroup[]>(
    () => getAppSettings().majorBatch.subjectGroups,
  );
  const [timeGroups, setTimeGroups] = useState<MajorBatchTimeGroup[]>(
    () => getAppSettings().majorBatch.timeGroups,
  );

  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectText, setNewSubjectText] = useState("");

  const [newTimeName, setNewTimeName] = useState("");
  const [draftSlots, setDraftSlots] = useState<DraftSlot[]>([
    { key: makeSlotKey(), start: "08:30", end: "09:30", dayOffset: 0 },
  ]);

  useEffect(() => {
    const sync = () => {
      const settings = getAppSettings().majorBatch;
      setSubjectGroups(settings.subjectGroups);
      setTimeGroups(settings.timeGroups);
    };
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const moveSubjectGroup = (id: string, direction: -1 | 1) => {
    const index = subjectGroups.findIndex((item) => item.id === id);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= subjectGroups.length) return;
    const next = [...subjectGroups];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const reordered = next.map((item, i) => ({ ...item, order: i }));
    updateMajorBatchSettings({ subjectGroups: reordered });
    setSubjectGroups(reordered);
  };

  const moveTimeGroup = (id: string, direction: -1 | 1) => {
    const index = timeGroups.findIndex((item) => item.id === id);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= timeGroups.length) return;
    const next = [...timeGroups];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const reordered = next.map((item, i) => ({ ...item, order: i }));
    updateMajorBatchSettings({ timeGroups: reordered });
    setTimeGroups(reordered);
  };

  const deleteSubjectGroup = (id: string) => {
    const next = subjectGroups.filter((item) => item.id !== id).map((item, i) => ({ ...item, order: i }));
    updateMajorBatchSettings({ subjectGroups: next });
    setSubjectGroups(next);
  };

  const deleteTimeGroup = (id: string) => {
    const next = timeGroups.filter((item) => item.id !== id).map((item, i) => ({ ...item, order: i }));
    updateMajorBatchSettings({ timeGroups: next });
    setTimeGroups(next);
  };

  const addSubjectGroup = () => {
    const subjects = [
      ...new Set(
        newSubjectText
          .split(/[，,\s、]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    if (!subjects.length) return;
    const next: MajorBatchSubjectGroup = {
      id: makeSubjectGroupId(),
      name: newSubjectName.trim() || `常用科目组 ${subjectGroups.length + 1}`,
      subjects,
      custom: true,
      updatedAt: Date.now(),
      order: subjectGroups.length,
    };
    const nextGroups = [...subjectGroups, next];
    updateMajorBatchSettings({ subjectGroups: nextGroups });
    setSubjectGroups(nextGroups);
    setNewSubjectName("");
    setNewSubjectText("");
  };

  const addSlotRow = () => {
    const last = draftSlots[draftSlots.length - 1];
    setDraftSlots((rows) => [
      ...rows,
      { key: makeSlotKey(), start: last?.start ?? "08:30", end: last?.end ?? "09:30", dayOffset: last?.dayOffset ?? 0 },
    ]);
  };

  const updateSlotRow = (key: string, patch: Partial<MajorBatchTimeSlot>) => {
    setDraftSlots((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeSlotRow = (key: string) => {
    setDraftSlots((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows));
  };

  const addTimeGroup = () => {
    const slots = draftSlots.map(({ start, end, dayOffset }) => ({
      start,
      end,
      dayOffset: Math.max(0, Math.round(Number(dayOffset ?? 0))),
    }));
    if (slots.some((slot) => !slot.start || !slot.end)) return;
    const next: MajorBatchTimeGroup = {
      id: makeTimeGroupId(),
      name: newTimeName.trim() || `常用时间组 ${timeGroups.length + 1}`,
      slots,
      custom: true,
      updatedAt: Date.now(),
      order: timeGroups.length,
    };
    const nextGroups = [...timeGroups, next];
    updateMajorBatchSettings({ timeGroups: nextGroups });
    setTimeGroups(nextGroups);
    setNewTimeName("");
    setDraftSlots([{ key: makeSlotKey(), start: "08:30", end: "09:30", dayOffset: 0 }]);
  };

  return (
    <div className="batch-preset-panel">
      <section className="batch-preset-section">
        <div className="batch-preset-section__head">
          <strong>常用科目组</strong>
          <span>用于批量添加分考试时快速选择科目组合，与批量添加弹窗中的设置共享</span>
        </div>
        {subjectGroups.length === 0 ? (
          <p className="set-note">暂无自定义科目组，可在下方创建。</p>
        ) : (
          <ul className="batch-preset-list">
            {subjectGroups.map((item, index) => (
              <li key={item.id} className="batch-preset-item">
                <div className="batch-preset-item__info">
                  <strong>{item.name}</strong>
                  <div className="batch-preset-chips">
                    {item.subjects.map((subject) => (
                      <span key={subject} className="batch-preset-chip">
                        {subject}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="batch-preset-item__actions">
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === 0}
                    onClick={() => moveSubjectGroup(item.id, -1)}
                    aria-label="上移"
                  >
                    ↑
                  </button>
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === subjectGroups.length - 1}
                    onClick={() => moveSubjectGroup(item.id, 1)}
                    aria-label="下移"
                  >
                    ↓
                  </button>
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    type="button"
                    disabled={!canEdit}
                    onClick={() => deleteSubjectGroup(item.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="batch-preset-form">
            <input
              className="admin-input"
              value={newSubjectName}
              onChange={(event) => setNewSubjectName(event.target.value)}
              placeholder="科目组名称"
              maxLength={30}
            />
            <input
              className="admin-input"
              value={newSubjectText}
              onChange={(event) => setNewSubjectText(event.target.value)}
              placeholder="科目名称，用逗号或空格分隔，如：语文 数学 外语"
              maxLength={200}
            />
            <button className="admin-btn" type="button" onClick={addSubjectGroup}>
              新建科目组
            </button>
          </div>
        )}
      </section>

      <section className="batch-preset-section">
        <div className="batch-preset-section__head">
          <strong>常用时间组</strong>
          <span>用于批量添加分考试时快速选择场次安排，与批量添加弹窗中的设置共享</span>
        </div>
        {timeGroups.length === 0 ? (
          <p className="set-note">暂无自定义时间组，可在下方创建。</p>
        ) : (
          <ul className="batch-preset-list">
            {timeGroups.map((item, index) => (
              <li key={item.id} className="batch-preset-item">
                <div className="batch-preset-item__info">
                  <strong>{item.name}</strong>
                  <div className="batch-preset-chips">
                    {item.slots.map((slot, slotIndex) => (
                      <span key={slotIndex} className="batch-preset-chip">
                        {slot.dayOffset ? `第${slot.dayOffset + 1}天 ` : ""}
                        {slot.start}–{slot.end}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="batch-preset-item__actions">
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === 0}
                    onClick={() => moveTimeGroup(item.id, -1)}
                    aria-label="上移"
                  >
                    ↑
                  </button>
                  <button
                    className="admin-order-btn"
                    type="button"
                    disabled={!canEdit || index === timeGroups.length - 1}
                    onClick={() => moveTimeGroup(item.id, 1)}
                    aria-label="下移"
                  >
                    ↓
                  </button>
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    type="button"
                    disabled={!canEdit}
                    onClick={() => deleteTimeGroup(item.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="batch-preset-form">
            <input
              className="admin-input"
              value={newTimeName}
              onChange={(event) => setNewTimeName(event.target.value)}
              placeholder="时间组名称"
              maxLength={30}
            />
            <div className="batch-preset-slot-rows">
              {draftSlots.map((row) => (
                <div key={row.key} className="batch-preset-slot-row">
                  <label>
                    第几天
                    <input
                      className="admin-input"
                      type="number"
                      min={0}
                      max={9}
                      value={row.dayOffset ?? 0}
                      onChange={(event) => updateSlotRow(row.key, { dayOffset: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    开始
                    <input
                      className="admin-input"
                      type="time"
                      value={row.start}
                      onChange={(event) => updateSlotRow(row.key, { start: event.target.value })}
                    />
                  </label>
                  <label>
                    结束
                    <input
                      className="admin-input"
                      type="time"
                      value={row.end}
                      onChange={(event) => updateSlotRow(row.key, { end: event.target.value })}
                    />
                  </label>
                  <button
                    className="admin-item-btn admin-item-btn--delete"
                    type="button"
                    disabled={draftSlots.length <= 1}
                    onClick={() => removeSlotRow(row.key)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="batch-preset-form__actions">
              <button className="admin-btn" type="button" onClick={addSlotRow}>
                + 添加场次
              </button>
              <button className="admin-btn admin-btn--primary" type="button" onClick={addTimeGroup}>
                新建时间组
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
