import {
  FileText,
  LayoutDashboard,
  ListOrdered,
  History,
  Globe,
  Image as ImageIcon,
  CalendarClock,
  MessageSquareText,
  Settings,
  ScrollText,
  UserRound,
  Sparkles,
  Wand2,
  ScanSearch,
  ShoppingBag,
  Newspaper,
  Network,
  RefreshCw,
  Chrome,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  FileText,
  LayoutDashboard,
  ListOrdered,
  History,
  Globe,
  ImageIcon,
  CalendarClock,
  MessageSquareText,
  Settings,
  ScrollText,
  UserRound,
  Sparkles,
  Wand2,
  ScanSearch,
  ShoppingBag,
  Newspaper,
  Network,
  RefreshCw,
  Chrome,
};

export function ModuleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon className={className} />;
}
