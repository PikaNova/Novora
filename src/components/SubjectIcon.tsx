import {
  Atom,
  BookMarked,
  BookOpen,
  Calculator,
  Dna,
  Dumbbell,
  FlaskConical,
  Globe2,
  Landmark,
  Languages,
  MonitorCog,
  Music2,
  Palette,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

const SUBJECT_ICON_RULES: Array<[RegExp, LucideIcon]> = [
  [/语文|阅读|写作/, BookOpen],
  [/数学|奥数/, Calculator],
  [/英语|外语|听力/, Languages],
  [/物理/, Atom],
  [/化学/, FlaskConical],
  [/生物/, Dna],
  [/政治|思想品德|道德与法治/, Landmark],
  [/历史/, ScrollText],
  [/地理/, Globe2],
  [/信息技术|通用技术|编程|计算机/, MonitorCog],
  [/体育/, Dumbbell],
  [/音乐/, Music2],
  [/美术|绘画/, Palette],
];

export function getSubjectIcon(subject: string): LucideIcon {
  const normalized = subject.replace(/\s+/g, "");
  return SUBJECT_ICON_RULES.find(([rule]) => rule.test(normalized))?.[1] ?? BookMarked;
}

export default function SubjectIcon({
  subject,
  size = 18,
  className = "",
}: {
  subject: string;
  size?: number;
  className?: string;
}) {
  const Icon = getSubjectIcon(subject);
  return <Icon className={`subject-icon ${className}`.trim()} size={size} strokeWidth={1.9} aria-hidden="true" />;
}
