import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Upload, Network, Settings, LogOut, User, UserSearch, Users, UserCircle, FileAudio, Loader2, CheckCircle2, Sparkles, ShieldAlert, Briefcase } from 'lucide-react';
import KolLabLogo from './KolLabLogo';
import { useState } from 'react';
import { useMlStatus } from '../hooks/useMlStatus';

interface LayoutProps {
  user: { username: string; role: string } | null;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { ready: mlReady } = useMlStatus();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const navItems = [
    { path: '/profile',          icon: UserCircle,     label: 'My Profile' },
    { path: '/dashboard',        icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/upload',           icon: Upload,          label: 'Upload' },
    { path: '/all-uploads',      icon: FileAudio,       label: 'All Uploads' },
    { path: '/projects',         icon: Briefcase,       label: 'Projects' },
    { path: '/network',          icon: Network,         label: 'Network' },
    { path: '/alerts',           icon: ShieldAlert,     label: 'Alerts' },
    { path: '/profile-search',   icon: UserSearch,      label: 'Profile Search' },
    { path: '/related-speakers', icon: Sparkles,        label: 'Related Speakers' },
    { path: '/settings',         icon: Settings,        label: 'Settings' },
  ];

  const adminItems = [
    { path: '/user-management', icon: Users, label: 'User Management' },
  ];

  return (
    <div className="min-h-screen bg-black flex text-sm">
      {/* Sidebar */}
      <aside className="w-60 bg-black border-r border-zinc-800 flex flex-col shrink-0">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <KolLabLogo size={36} />
            <div>
              <div className="text-white font-bold tracking-wide text-base leading-none">
                Kol<span className="text-blue-400">L</span>ab
              </div>
              <div className="text-zinc-200 text-[10px] font-mono uppercase tracking-widest mt-0.5">
                Intel Platform
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          <ul>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-5 py-2.5 border-l-2 transition-all ${
                      active
                        ? 'border-blue-500 bg-blue-500/8 text-white'
                        : 'border-transparent text-zinc-300 hover:text-zinc-200 hover:bg-white/4'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                </li>
              );
            })}

            {user?.role === 'Admin' && (
              <>
                <li className="px-5 pt-5 pb-2">
                  <span className="text-zinc-300 text-[10px] font-mono uppercase tracking-widest">
                    Management
                  </span>
                </li>
                {adminItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        className={`flex items-center gap-3 px-5 py-2.5 border-l-2 transition-all ${
                          active
                            ? 'border-blue-500 bg-blue-500/8 text-white'
                            : 'border-transparent text-zinc-300 hover:text-zinc-200 hover:bg-white/4'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="text-sm">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        </nav>

        {/* Logout */}
        <div className="border-t border-zinc-800 p-3">
          <button
            onClick={onLogout}
            className="flex items-center gap-3 w-full px-4 py-2.5 rounded text-zinc-300 hover:text-red-400 hover:bg-red-500/8 transition-all border border-transparent hover:border-red-500/20"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-black border-b border-zinc-800 px-6 py-3 sticky top-0 z-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-200 text-xs font-mono uppercase tracking-widest">
            <span className="text-zinc-300">KolLab</span>
            <span>/</span>
            <span className="text-blue-500">{user?.role ?? 'User'}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* ML status */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border ${
              mlReady
                ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-400'
                : 'bg-amber-500/8 border-amber-500/25 text-amber-400'
            }`}>
              {mlReady
                ? <><CheckCircle2 className="w-3 h-3" /><span>ML READY</span></>
                : <><Loader2 className="w-3 h-3 animate-spin" /><span>ML LOADING</span></>
              }
            </div>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 hover:border-zinc-700 transition-all"
              >
                <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
                  <User className="w-3 h-3 text-white" />
                </div>
                <span className="text-zinc-300 text-xs font-medium hidden sm:block">{user?.username}</span>
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 mt-1.5 w-48 bg-zinc-950 border border-zinc-800 rounded shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-800">
                      <div className="text-white text-xs font-medium">{user?.username}</div>
                      <div className="text-zinc-200 text-[10px] font-mono uppercase">{user?.role}</div>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={() => { setShowUserMenu(false); navigate('/profile'); }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded text-zinc-200 hover:text-white hover:bg-white/5 transition-all text-xs"
                      >
                        <UserCircle className="w-3.5 h-3.5" />
                        My Profile
                      </button>
                      <button
                        onClick={() => { setShowUserMenu(false); onLogout(); }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded text-zinc-200 hover:text-red-400 hover:bg-red-500/8 transition-all text-xs mt-0.5"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-black">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
