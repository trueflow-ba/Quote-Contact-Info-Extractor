import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LayoutDashboard, Settings, LogOut, User, ChevronDown, Shield } from 'lucide-react';
import { APP_VERSION, APP_BUILD_DATE } from '@/version';
import api from '@/lib/api';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [backendVersion, setBackendVersion] = useState(null);

  useEffect(() => {
    api.get('/version').then(r => setBackendVersion(r.data)).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/settings', label: 'Settings', icon: Settings },
    ...(user?.role === 'admin' ? [{ path: '/admin', label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <header className="bg-[#0A0F1C] border-b border-slate-800 sticky top-0 z-50 h-16" data-testid="app-header">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-8">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 group" data-testid="brand-link">
            <div className="w-8 h-8 bg-sky-500 rounded-sm flex items-center justify-center">
              <span className="text-white font-semibold text-sm">TF</span>
            </div>
            <span className="text-slate-200 font-semibold text-sm hidden sm:block tracking-tight group-hover:text-white transition-colors">
              TrueFlow
            </span>
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 bg-slate-800/60 border border-slate-800 rounded-sm px-1.5 py-0.5 ml-1 hover:text-slate-300 transition-colors"
              title={`Frontend v${APP_VERSION} (${APP_BUILD_DATE})${backendVersion ? `\nBackend v${backendVersion.version} (${backendVersion.build_date})` : '\nBackend: contacting...'}`}
              data-testid="app-version-badge"
            >
              v{APP_VERSION}
              {backendVersion && backendVersion.version !== APP_VERSION && (
                <span className="text-amber-400" title="Backend version differs from frontend">⚠</span>
              )}
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                data-testid={`nav-${label.toLowerCase()}`}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm transition-colors ${
                  location.pathname === path
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors" data-testid="user-menu-trigger">
              <div className="w-7 h-7 bg-slate-800 rounded-full flex items-center justify-center">
                <User className="h-3.5 w-3.5" strokeWidth={1.5} />
              </div>
              <span className="text-sm hidden sm:block">{user?.name || user?.email}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-[#111827] border-slate-800 text-slate-300 min-w-[160px]">
            <DropdownMenuItem onClick={() => navigate('/settings')} className="text-sm cursor-pointer hover:bg-slate-800 focus:bg-slate-800">
              <Settings className="h-4 w-4 mr-2" strokeWidth={1.5} /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-sm cursor-pointer text-red-400 hover:bg-slate-800 focus:bg-slate-800" data-testid="logout-button">
              <LogOut className="h-4 w-4 mr-2" strokeWidth={1.5} /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
