import { useState } from "react";
import { MonitorCheck, X } from "lucide-react";
import type { SchoolClass, SchoolGrade } from "../types/school";
import type { AdminUserContext } from "../services/examService";
import { getCachedDeviceBinding, getClassBindingInstanceId, setupManagedDevice } from "../services/classBinding";
import { updateExamSettings } from "../utils/appSettings";
import { classDisplayName } from "../utils/classSettings";
import { notify } from "../services/notify";

const keyFor = (userId: number) => `novora_admin_device_setup:${userId}:${getClassBindingInstanceId()}`;

export default function AdminDeviceSetupPrompt({ user, grades, classes, canBind }: { user: AdminUserContext; grades: SchoolGrade[]; classes: SchoolClass[]; canBind: boolean }) {
  const binding = getCachedDeviceBinding();
  const isClassTerminal = !!binding && !binding.revoked && !binding.isManagement && !!binding.gradeId && !!binding.classId;
  const [open, setOpen] = useState(() => canBind && isClassTerminal && localStorage.getItem(keyFor(user.id)) !== "done");
  const [saving, setSaving] = useState(false);

  if (!open || !binding) return null;

  const finish = () => {
    localStorage.setItem(keyFor(user.id), "done");
    setOpen(false);
  };

  const convertToManagement = async () => {
    setSaving(true);
    try {
      await setupManagedDevice({ bindManagement: true });
      updateExamSettings({ selectedGradeId: "", selectedClassId: "" });
      notify("success", "本设备已转为管理设备，原 ClassIsland 配对已解除。");
      finish();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "管理设备登记失败");
    } finally {
      setSaving(false);
    }
  };

  return <div className="admin-device-setup" role="dialog" aria-modal="true" aria-label="确认本设备用途">
    <section>
      <button type="button" className="admin-device-setup__close" aria-label="关闭" onClick={finish}><X aria-hidden="true" /></button>
      <header><MonitorCheck aria-hidden="true" /><span><strong>确认本设备用途</strong><small>设备 {getClassBindingInstanceId().slice(0, 12)}</small></span></header>
      <div className="admin-device-setup__body">
        <h3>本机当前是班级考试端</h3>
        <p>已绑定 {classDisplayName(grades, classes, binding.classId)}。进入后台不会自动改变班级，请选择是否保留当前用途。</p>
        <div className="admin-device-setup__choices">
          <button type="button" disabled={saving} onClick={finish}><strong>保留班级考试端</strong><span>继续为当前班级显示考试，并保留 ClassIsland 连接</span></button>
          <button type="button" disabled={saving} onClick={() => void convertToManagement()}><strong>转为管理设备</strong><span>清空班级绑定且不占班级名额，同时解除插件配对</span></button>
        </div>
      </div>
    </section>
  </div>;
}
