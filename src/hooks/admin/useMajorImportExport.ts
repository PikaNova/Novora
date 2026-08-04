import { useEffect, useState } from "react";
import type { ExamItem, MajorExam } from "../../types";
import { normalizeExamItems } from "../../utils/examSchedule";
import { adminCan, type AdminUserContext } from "../../services/examService";
import { notify } from "../../services/notify";
import { makeId, fmtLocal, duration } from "./adminPageUtils";
import type { MajorModal } from "./useMajorScheduleActions";

type ImportPreviewItem = ExamItem & { include: boolean };

// Owns the major-exam JSON import/export workflow: paste-JSON validation and
// preview, confirmed import, single-click export, and the "start import"
// entry point that redirects into major-creation when no major exam exists
// yet in the current grade scope.
export function useMajorImportExport(params: {
  adminUser: AdminUserContext | null;
  hasScopedMajor: boolean;
  activeMajor: MajorExam;
  activeMajorId: string;
  items: ExamItem[];
  majors: MajorExam[];
  selectedGradeId: string;
  commit: (
    ms: MajorExam[],
    activeId: string,
    immediate?: boolean,
    syncLabel?: string,
  ) => void;
  setMoreOpen: (open: boolean) => void;
  setMajorError: (error: string) => void;
  setMajorModal: (modal: MajorModal) => void;
}) {
  const {
    adminUser,
    hasScopedMajor,
    activeMajor,
    activeMajorId,
    items,
    majors,
    selectedGradeId,
    commit,
    setMoreOpen,
    setMajorError,
    setMajorModal,
  } = params;

  const [importOpen, setImportOpen] = useState(false);
  const [majorImportStep, setMajorImportStep] = useState(0);
  const [openImportGuide, setOpenImportGuide] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [majorImportPreview, setMajorImportPreview] = useState<{
    title: string;
    items: ImportPreviewItem[];
    warnings: string[];
  } | null>(null);

  useEffect(() => {
    if (importOpen) {
      setMajorImportStep(0);
      setImportText("");
      setImportError("");
      setMajorImportPreview(null);
    }
  }, [importOpen]);

  const validateMajorImportJson = () => {
    setImportError("");
    if (!hasScopedMajor || !activeMajor.id) {
      setImportError("请先填写标题并创建大型考试，再导入分考试安排。");
      return;
    }
    try {
      const source = JSON.parse(importText);
      const list = Array.isArray(source) ? source : source.items;
      if (!Array.isArray(list)) throw new Error("JSON 必须是考试数组，或包含 items 数组");
      const next = list.map((raw: unknown, index: number) => {
        const row = raw as Record<string, unknown>;
        if (!row.name || !row.startTime || !row.endTime)
          throw new Error(`第 ${index + 1} 项缺少 name、startTime 或 endTime`);
        const startTime = String(row.startTime);
        const endTime = String(row.endTime);
        const start = new Date(startTime).getTime();
        const end = new Date(endTime).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end))
          throw new Error(`第 ${index + 1} 项的开始或结束时间格式无效`);
        if (end <= start) throw new Error(`第 ${index + 1} 项的结束时间必须晚于开始时间`);
        return {
          id: String(row.id ?? makeId()),
          name: String(row.name),
          startTime,
          endTime,
          enabled: row.enabled !== false,
          order: typeof row.order === "number" ? row.order : index,
          include: true,
        };
      });
      const chronological = normalizeExamItems(next);
      const nextName =
        typeof source.title === "string" && source.title.trim()
          ? source.title.trim()
          : activeMajor.name;
      const warnings: string[] = [];
      chronological.forEach((item, index) => {
        const previous = chronological[index - 1];
        if (previous && new Date(item.startTime) < new Date(previous.endTime))
          warnings.push(`“${item.name}”与“${previous.name}”时间重叠`);
      });
      setMajorImportPreview({
        title: nextName,
        items: chronological.map((item) => ({ ...item, include: true })),
        warnings,
      });
      setMajorImportStep(2);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSON 格式错误");
    }
  };

  const importJson = () => {
    setImportError("");
    if (!majorImportPreview) {
      validateMajorImportJson();
      return;
    }
    try {
      const selectedItems = majorImportPreview.items
        .filter((item) => item.include)
        .map(({ include: _include, ...item }) => item);
      if (!selectedItems.length) throw new Error("请至少保留一项分考试安排");
      const ms = majors.map((m) =>
        m.id === activeMajor.id
          ? { ...m, name: majorImportPreview.title, items: selectedItems }
          : m,
      );
      commit(ms, activeMajorId, false, `导入「${majorImportPreview.title}」`);
      setImportText("");
      setImportOpen(false);
      setMajorImportPreview(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSON 格式错误");
    }
  };

  const exportJson = () => {
    const file = new Blob(
      [
        JSON.stringify(
          { title: activeMajor.name, items, exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      ],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeMajor.name || "exam-board"}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const openMajorImport = () => {
    setMoreOpen(false);
    setImportError("");
    if (!selectedGradeId) {
      notify("warning", "请先选择要导入考试安排的年级。", "请选择年级");
      return;
    }
    if (hasScopedMajor) {
      setOpenImportGuide(false);
      setImportOpen(true);
      return;
    }
    if (!adminCan("major.create", adminUser)) {
      notify("error", "当前年级尚无大型考试，且当前账号没有新建考试权限。", "无法导入");
      return;
    }
    setMajorError("");
    setMajorModal({
      mode: "add",
      name: "",
      targetGradeIds: selectedGradeId ? [selectedGradeId] : [],
      next: "import",
    });
  };

  return {
    importOpen,
    setImportOpen,
    majorImportStep,
    setMajorImportStep,
    openImportGuide,
    setOpenImportGuide,
    importText,
    setImportText,
    importError,
    setImportError,
    majorImportPreview,
    setMajorImportPreview,
    validateMajorImportJson,
    importJson,
    exportJson,
    openMajorImport,
  };
}
