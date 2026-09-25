// 页面内上下文栏：运行模式 / 年级 / 班级。
// 这些控件原先挂在左侧导航栏底部，导致导航栏承担了页面状态；现在跟随页面渲染，
// 导航栏只负责功能切换。状态仍由 AdminPage 持有，这里只接收值与回调。
import type { ScheduleMode } from '../../types/exam';
import type { SchoolGrade, SchoolClass } from '../../types/school';
import HelpTip from '../HelpTip';
import InlineSelect from '../InlineSelect';

export type AdminContextBarProps = {
  /** 周测按班级编辑，需要班级选择；大型考试按年级即可。 */
  showClassPicker: boolean;
  can: (permission: string) => boolean;
  scheduleMode: ScheduleMode;
  handleScheduleModeChange: (mode: ScheduleMode) => void;
  selectedGradeId: string;
  changeSelectedGrade: (gradeId: string) => void;
  visibleGrades: SchoolGrade[];
  selectedClassId: string;
  changeSelectedClass: (classId: string) => void;
  visibleClasses: SchoolClass[];
};

export function AdminContextBar({
  showClassPicker,
  can,
  scheduleMode,
  handleScheduleModeChange,
  selectedGradeId,
  changeSelectedGrade,
  visibleGrades,
  selectedClassId,
  changeSelectedClass,
  visibleClasses,
}: AdminContextBarProps) {
  return (
    <div className="admin-context-bar" aria-label="页面范围与运行模式">
      {can('schedule.mode_edit') && (
        <label className="admin-context-bar__field">
          <span className="admin-context-bar__label with-help-tip">
            <span>运行模式</span>
            <HelpTip title="运行模式">
              仅大型考试或仅周测会隐藏另一类安排；自动模式会同时调度，并按冲突规则让周测避开大型考试。
            </HelpTip>
          </span>
          <InlineSelect
            className="admin-input"
            value={scheduleMode}
            onChange={(value) => handleScheduleModeChange(value as ScheduleMode)}
            options={[
              { value: 'major-only', label: '仅大型考试' },
              { value: 'weekly-only', label: '仅周测' },
              {
                value: 'automatic',
                label: '自动（大型考试优先，自动避让周测）',
              },
            ]}
          />
        </label>
      )}
      <label className="admin-context-bar__field">
        年级
        <InlineSelect
          className="admin-input"
          value={selectedGradeId}
          placeholder="请选择年级"
          onChange={changeSelectedGrade}
          options={[
            { value: '', label: '请选择年级' },
            ...visibleGrades.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
      </label>
      {showClassPicker && (
        <label className="admin-context-bar__field">
          班级
          <InlineSelect
            className="admin-input"
            value={selectedClassId}
            placeholder="请选择班级"
            onChange={changeSelectedClass}
            disabled={!selectedGradeId}
            options={[
              { value: '', label: '请选择班级' },
              ...visibleClasses
                .filter((item) => item.gradeId === selectedGradeId)
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
      )}
    </div>
  );
}
