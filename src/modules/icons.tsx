import { type Icon as LucideIcon } from '@phosphor-icons/react';
import {
  ChartBar as BarChart3,
  Robot as Bot,
  Brain,
  Buildings as Building2,
  Coins,
  Database,
  Devices as MonitorSmartphone,
  ShareNetwork as Network,
  Scales as Scale,
  Scroll as ScrollText,
  ShieldCheck,
} from '@phosphor-icons/react/dist/ssr';
import { type ModuleId } from './registry';

export const MODULE_ICONS: Record<ModuleId, LucideIcon> = {
  fleet: MonitorSmartphone,
  gateway: Network,
  control: ShieldCheck,
  data: Database,
  brain: Brain,
  agents: Bot,
  analytics: BarChart3,
  finops: Coins,
  reports: ScrollText,
  regulatory: Scale,
  admin: Building2,
};
