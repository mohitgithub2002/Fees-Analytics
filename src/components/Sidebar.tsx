import Link from 'next/link'
import {
  GraduationCap,
  LayoutDashboard,
  BarChart3,
  Users,
  TrendingUp,
  Settings,
} from 'lucide-react'

const NAV = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/', active: true },
  { icon: BarChart3,       label: 'Analytics',  href: '#' },
  { icon: Users,           label: 'Students',   href: '#' },
  { icon: TrendingUp,      label: 'Reports',    href: '#' },
  { icon: Settings,        label: 'Settings',   href: '#' },
]

export function Sidebar() {
  return (
    <aside
      className="w-64 h-full flex flex-col flex-shrink-0"
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Logo -------------------------------------------------- */}
      <div
        className="px-5 py-5 flex items-center gap-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--indigo), var(--purple))',
          }}
        >
          <GraduationCap className="w-5 h-5 text-white" />
        </div>
        <div className="overflow-hidden">
          <p
            className="font-bold text-sm leading-tight truncate"
            style={{ color: 'var(--text-primary)' }}
          >
            VPS School
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            Fees Dashboard
          </p>
        </div>
      </div>

      {/* Nav --------------------------------------------------- */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group"
            style={
              item.active
                ? {
                    background:
                      'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.18))',
                    color: 'var(--indigo)',
                    border: '1px solid rgba(99,102,241,0.30)',
                  }
                : {
                    color: 'var(--text-secondary)',
                    border: '1px solid transparent',
                  }
            }
          >
            <item.icon
              className="w-4 h-4 flex-shrink-0"
              style={item.active ? { color: 'var(--indigo)' } : {}}
            />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Footer ------------------------------------------------ */}
      <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div
          className="px-3 py-3 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Academic Year
          </p>
          <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
            2024–25
          </p>
        </div>
      </div>
    </aside>
  )
}
