'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Receipt,
  Settings,
  ShieldCheck,
  GraduationCap,
  LogOut,
  PhoneCall,
  Target,
  TrendingUp,
  Upload,
  Link2,
  SlidersHorizontal,
} from 'lucide-react'

/**
 * Recovery leads, because it is the only group anybody opens with a job to do
 * — the fees screens are where you look something up, this is where the day's
 * work is. The legacy dashboard sits at the bottom, out of the way.
 */
const NAV_GROUPS = [
  {
    label: 'Recovery',
    items: [
      { icon: Target, label: 'Command Center', href: '/recovery', superuserOnly: false },
      { icon: PhoneCall, label: 'Call List', href: '/recovery/worklist', superuserOnly: false },
      { icon: Users, label: 'Families', href: '/recovery/parents', superuserOnly: false },
      { icon: BarChart3, label: 'How They Pay', href: '/recovery/behavior', superuserOnly: false },
      { icon: TrendingUp, label: 'Cash Forecast', href: '/recovery/forecast', superuserOnly: false },
    ],
  },
  {
    label: 'Fees',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/manage', superuserOnly: false },
      { icon: Users, label: 'Students', href: '/manage/students', superuserOnly: false },
      { icon: Receipt, label: 'Payments', href: '/manage/transactions', superuserOnly: false },
      { icon: Settings, label: 'Setup', href: '/manage/setup', superuserOnly: false },
    ],
  },
  {
    label: 'Data & Settings',
    items: [
      { icon: Upload, label: 'School Data', href: '/manage/import', superuserOnly: false },
      { icon: Link2, label: 'Parents & Families', href: '/recovery/households', superuserOnly: false },
      {
        icon: SlidersHorizontal,
        label: 'Call Rules',
        href: '/recovery/settings',
        superuserOnly: false,
      },
      { icon: ShieldCheck, label: 'Staff Logins', href: '/manage/users', superuserOnly: true },
    ],
  },
]

interface AuthUser {
  name: string
  phone: string
  role: string
}

const roleLabel = (role: string) =>
  role === 'SUPERUSER' ? 'Super Admin' : role.charAt(0) + role.slice(1).toLowerCase()

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => { if (d.user) setUser(d.user) })
      .catch(() => {})
  }, [])

  async function logout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.replace('/login')
    }
  }

  const initials = user
    ? user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
    : '—'

  // Exact match for section roots, so /recovery does not stay highlighted
  // while you are three screens deep inside it.
  const isActive = (href: string) =>
    href === '/' || href === '/manage' || href === '/recovery'
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/')

  return (
    <aside
      className="w-[248px] h-full flex flex-col flex-shrink-0"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* ── Brand ─────────────────────────────────────────── */}
      <div
        className="px-4 h-16 flex items-center gap-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          <GraduationCap className="w-[18px] h-[18px]" />
        </div>
        <div className="overflow-hidden leading-tight">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            VPS School
          </p>
          <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            Fees Management
          </p>
        </div>
      </div>

      {/* ── Navigation ────────────────────────────────────── */}
      <nav className="flex-1 px-3 pt-4 pb-2 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            (item) => !item.superuserOnly || user?.role === 'SUPERUSER'
          )
          if (items.length === 0) return null
          return (
            <div key={group.label} className="mb-4">
              <p className="label-micro px-2 mb-2">{group.label}</p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = isActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group relative flex items-center gap-3 px-2.5 h-9 rounded-lg text-[13px] font-medium transition-colors duration-150"
                      style={
                        active
                          ? { background: 'var(--accent-soft)', color: 'var(--text-primary)' }
                          : { color: 'var(--text-secondary)' }
                      }
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full"
                          style={{ background: 'var(--accent)' }}
                        />
                      )}
                      <item.icon
                        className="w-[17px] h-[17px] flex-shrink-0 transition-colors"
                        style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── Footer: signed-in user + logout ───────────────── */}
      <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <div
          className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0"
            style={{ background: 'var(--elevated-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            {initials}
          </div>
          <div className="leading-tight overflow-hidden flex-1 min-w-0">
            <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {user ? user.name : 'Loading…'}
            </p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              {user ? roleLabel(user.role) : ''}
            </p>
          </div>
          <button
            onClick={logout}
            disabled={loggingOut}
            title="Sign out"
            aria-label="Sign out"
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-muted)', background: 'var(--elevated)' }}
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
