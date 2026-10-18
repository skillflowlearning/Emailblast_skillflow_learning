import Sidebar from './Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex flex-col lg:flex-row min-h-screen bg-white dark:bg-gray-900">
      <Sidebar />
      <main className="app-content min-w-0 flex-1 p-4 sm:p-6 lg:p-8 pb-28 lg:pb-8">{children}</main>
    </div>
  );
}
