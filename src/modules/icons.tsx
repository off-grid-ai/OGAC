import { type Icon as LucideIcon } from '@phosphor-icons/react';
import {
  ChartBar as BarChart3,
  Robot as Bot,
  Brain,
  Buildings as Building2,
  Coins,
  Database,
  Microscope,
  Devices as MonitorSmartphone,
  ShareNetwork as Network,
  Scales as Scale,
  Scroll as ScrollText,
  ShieldCheck,
  TreeStructure,
  Vault,
} from '@phosphor-icons/react/dist/ssr';
import { type ModuleId } from './registry';

export const MODULE_ICONS: Record<ModuleId, LucideIcon> = {
  fleet: MonitorSmartphone,
  gateway: Network,
  control: ShieldCheck,
  data: Database,
  brain: Brain,
  agents: Bot,
  observability: Microscope,
  analytics: BarChart3,
  finops: Coins,
  reports: ScrollText,
  lineage: TreeStructure,
  regulatory: Scale,
  integrations: Vault,
  admin: Building2,
};
