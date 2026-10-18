'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import {
  LayoutGrid,
  Send,
  Globe,
  BarChart3,
  Settings,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AccountPanel from './AccountPanel';

const navItems = [
  { label: 'Services', href: '/services', icon: LayoutGrid },
  { label: 'Campaigns', href: '/campaigns', icon: Send },
  { label: 'Temporary test', href: '/app/blast/test', icon: Send },
  { label: 'Domains', href: '/domains', icon: Globe },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navigation = (
    <aside className="w-64 min-h-screen bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 flex flex-col">
      <div className="p-6 border-b border-gray-100 dark:border-gray-800">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gray-900 dark:bg-white rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white dark:text-gray-900" />
          </div>
          <span className="text-lg font-bold text-gray-900 dark:text-white">MailFlow</span>
        </Link>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                active
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
              )}
            >
              <Icon className="w-4 h-4" />
              {item.label}
              {active && <ChevronRight className="w-3 h-3 ml-auto" />}
            </Link>
          );
        })}
      </nav>
      <AccountPanel />
      <div className="p-4 border-t border-gray-100 dark:border-gray-800">
        <Link
          href="/admin"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
        >
          <BarChart3 className="w-4 h-4" />
          Admin Dashboard
        </Link>
      </div>
    </aside>
  );
  return <>
    <div className="hidden lg:block shrink-0">{navigation}</div>
    <header className="mobile-header lg:hidden sticky top-0 z-40 flex items-center justify-between border-b bg-white dark:bg-gray-900 dark:border-gray-800 px-4 py-2">
      <Link href="/services" className="font-bold min-h-11 flex items-center">MailFlow</Link>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border" aria-label="Open navigation"><Menu /></Dialog.Trigger>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" /><Dialog.Content className="mobile-sidebar fixed inset-y-0 left-0 z-[60] w-[min(320px,90vw)] overflow-y-auto bg-white dark:bg-gray-900">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title><Dialog.Description className="sr-only">Choose an app page or manage your account.</Dialog.Description>
          <Dialog.Close className="absolute right-3 top-4 min-h-11 min-w-11 flex items-center justify-center rounded-lg" aria-label="Close navigation"><X /></Dialog.Close>
          {navigation}
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </header>
  </>;
}
