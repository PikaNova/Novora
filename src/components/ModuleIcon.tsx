import React from 'react';
import {
  CalendarDays,
  ChartNoAxesCombined,
  GraduationCap,
  LayoutDashboard,
  MonitorCog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { AdminTab } from '../types/exam';

const ICONS: Record<AdminTab, LucideIcon> = {
  overview: ChartNoAxesCombined,
  dashboard: LayoutDashboard,
  major: GraduationCap,
  weekly: CalendarDays,
  classes: ShieldCheck,
  devices: MonitorCog,
  users: ShieldCheck,
};

export default function ModuleIcon({ module, size = 18 }: { module: AdminTab; size?: number }) {
  const Icon = ICONS[module];
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" />;
}
