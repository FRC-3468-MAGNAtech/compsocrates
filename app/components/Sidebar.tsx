"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/AuthContext';
import { 
  LayoutDashboard, 
  ClipboardList, 
  Activity, 
  BarChart3, 
  CheckCircle2, 
  Settings, 
  LogOut 
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const { userData, logOut } = useAuth();

  const navItems = [
    { name: 'Dashboard', path: '/scout-dashboard', icon: LayoutDashboard, roles: ['scout', 'coach'] },
    { name: 'Scout Form', path: '/scout-form', icon: ClipboardList, roles: ['scout'] },
    { name: 'Practice Scouting', path: '/practice', icon: Activity, roles: ['scout', 'coach'] },
    { name: 'Analytics', path: '/analytics', icon: BarChart3, roles: ['scout', 'coach'] },
    { name: 'Accuracy', path: '/accuracy', icon: CheckCircle2, roles: ['scout', 'coach'] },
    { name: 'Account', path: '/account', icon: Settings, roles: ['scout', 'coach'] },
  ];

  const filteredItems = navItems.filter(item => 
    item.roles.includes(userData?.role || '')
  );

  return (
    <div className="w-64 bg-white border-r flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold tracking-tight" style={{ color: "#c42221" }}>
          CompSocrates
        </h1>
      </div>
      
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive 
                  ? 'bg-red-50 text-red-700 font-semibold shadow-sm' 
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon size={20} className={isActive ? 'text-red-600' : 'text-gray-400'} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t mt-auto">
        <button
          onClick={logOut}
          className="flex items-center gap-3 w-full px-4 py-3 text-gray-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition-colors group"
        >
          <LogOut size={20} className="group-hover:text-red-600" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </div>
  );
}