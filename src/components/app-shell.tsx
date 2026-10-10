'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, Menu, Circle } from 'lucide-react';
import { MODULES } from '@/modules/registry';
import { ModuleIcon } from './icons';
import { cn } from './ui';
import { api } from '@/lib/client-fetch';

type NavItem = { href: string; label: string; icon: string; soon?: boolean };

const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: 'LayoutDashboard' },
  { href: '/queue', label: 'Article Queue', icon: 'ListOrdered' },
  { href: '/history', label: 'Article History', icon: 'History' },
];

const SITE_NAV: NavItem[] = [
  { href: '/websites', label: 'Websites', icon: 'Globe' },
  { href: '/image-template', label: 'Image Template', icon: 'ImageIcon' },
  { href: '/workflow', label: 'Workflow', icon: 'CalendarClock' },
];

const SYSTEM_NAV: NavItem[] = [
  { href: '/prompts', label: 'Prompt Manager', icon: 'MessageSquareText' },
  { href: '/settings', label: 'Settings', icon: 'Settings' },
  { href: '/logs', label: 'Logs', icon: 'ScrollText' },
  { href: '/automation-chrome', label: 'Automation Chrome', icon: 'Chrome' },
];

type SystemStatus = {
  worker: { online: boolean; lastSeenAt: string | null };
  extension: { online: boolean; lastSeenAt: string | null; version: string | null; connected: boolean };
  counts: { running: number; queued: number; waitingChatgpt: number };
};

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm',
        active ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        item.soon && 'opacity-60',
      )}
    >
      <ModuleIcon name={item.icon} className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.soon && <span className="ml-auto rounded bg-gray-100 px-1.5 text-[10px] uppercase tracking-wide text-gray-500">soon</span>}
    </Link>
  );
}

function Section({ title, items, pathname }: { title?: string; items: NavItem[]; pathname: string }) {
  return (
    <div className="mb-4">
      {title && <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</div>}
      <nav className="space-y-0.5">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/')} />
        ))}
      </nav>
    </div>
  );
}

export function AppShell({ user, children }: { user: { name: string; email: string; role: string }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SystemStatus>('/api/status')
        .then((s) => alive && setStatus(s))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  const writers: NavItem[] = MODULES.filter((m) => m.group === 'Writers').map((m) => ({ href: m.href, label: m.name, icon: m.icon, soon: m.status === 'coming-soon' }));
  const tools: NavItem[] = MODULES.filter((m) => m.group === 'SEO Tools').map((m) => ({ href: m.href, label: m.name, icon: m.icon, soon: m.status === 'coming-soon' }));

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-gray-900">Blog Automation</div>
          <div className="text-xs text-gray-500">Studio</div>
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-2">
        <Section items={MAIN_NAV} pathname={pathname} />
        <Section title="Writers" items={writers} pathname={pathname} />
        <Section title="Websites" items={SITE_NAV} pathname={pathname} />
        <Section title="SEO Tools" items={tools} pathname={pathname} />
        <Section title="System" items={SYSTEM_NAV} pathname={pathname} />
      </div>
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-800">{user.name}</div>
            <div className="truncate text-xs text-gray-500">{user.email}</div>
          </div>
          <button onClick={logout} title="Sign out" className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 bg-white" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4">
          <button className="rounded p-1 text-gray-600 hover:bg-gray-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center justify-end gap-4 text-xs text-gray-600">
            {status && (
              <>
                <span className="hidden sm:inline">
                  {status.counts.running} running · {status.counts.queued} queued
                </span>
                <StatusDot ok={status.worker.online} label={status.worker.online ? 'Worker online' : 'Worker offline'} />
                <Link href="/automation-chrome">
                  <StatusDot
                    ok={status.extension.online}
                    warn={!status.extension.online && status.counts.waitingChatgpt > 0}
                    label={status.extension.online ? `Extension connected${status.extension.version ? ` (v${status.extension.version})` : ''}` : status.extension.connected ? 'Extension offline' : 'Extension not connected'}
                  />
                </Link>
              </>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function StatusDot({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Circle className={cn('h-2.5 w-2.5', ok ? 'fill-emerald-500 text-emerald-500' : warn ? 'fill-amber-500 text-amber-500' : 'fill-gray-300 text-gray-300')} />
      {label}
    </span>
  );
}
