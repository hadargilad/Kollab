import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Shield, LayoutDashboard, Upload, Network, Search, Settings, LogOut, User, UserSearch, Users, UserCircle } from 'lucide-react';
import { useState } from 'react';

interface LayoutProps {
  user: { username: string; role: string } | null;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path);
  };

  // Base navigation items for everyone
  const navItems = [
    { path: '/profile', icon: UserCircle, label: 'My Profile' },
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/upload', icon: Upload, label: 'Upload' },
    { path: '/network', icon: Network, label: 'Network' },
    { path: '/identity', icon: Search, label: 'Identity' },
    { path: '/profile-search', icon: UserSearch, label: 'Profile Search' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  // Admin-only management items
  const adminItems = [
    { path: '/user-management', icon: Users, label: 'User Management' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-lg font-bold">Audio-Intel</h1>
              <p className="text-slate-400 text-sm">Intelligence Platform</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      active
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}

            {/* Admin Section */}
            {user?.role === 'Admin' && (
              <div className="mt-6 pt-6 border-t border-slate-800">
                <p className="text-slate-500 text-xs font-bold px-4 mb-2 uppercase tracking-widest">Management</p>
                {adminItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                          active
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </div>
            )}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={onLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors w-full"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout System</span>
          </button>
        </div>
      </aside>

      {/* Main View Area */}
      <main className="flex-1 overflow-auto flex flex-col">
        {/* Dynamic Header */}
        <header className="bg-slate-900 border-b border-slate-800 px-8 py-4 sticky top-0 z-50">
          <div className="flex items-center justify-between">
            <div className="text-slate-400 text-sm font-medium">
              Secure Intelligence System | <span className="text-blue-400 font-bold">{user?.role} Access</span>
            </div>
            
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition-all border border-slate-700 hover:border-slate-500 shadow-sm"
              >
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-1.5 rounded-lg">
                  <User className="w-4 h-4 text-white" />
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-white text-sm font-bold">{user?.username}</div>
                  <div className="text-slate-500 text-[10px] uppercase font-black tracking-tighter">{user?.role}</div>
                </div>
              </button>

              {/* User Dropdown Menu */}
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)}></div>
                  <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    <div className="p-2 border-b border-slate-700 bg-slate-800/50">
                        <div className="px-3 py-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Account</div>
                    </div>
                    <div className="p-1.5">
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          navigate('/profile');
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-blue-600 hover:text-white transition-all w-full group"
                      >
                        <UserCircle className="w-4 h-4 text-blue-400 group-hover:text-white" />
                        <span className="text-sm font-medium">My Profile</span>
                      </button>
                      
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          onLogout();
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-red-500/10 hover:text-red-400 transition-all w-full mt-1 group"
                      >
                        <LogOut className="w-4 h-4 text-slate-500 group-hover:text-red-400" />
                        <span className="text-sm font-medium">Logout</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Outlet */}
        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}