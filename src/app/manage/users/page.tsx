'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import {
  apiCall, Button, EmptyState, ErrorBanner, Field, inputCls, inputStyle, Modal, StatusChip,
} from '@/components/v2/ui'
import { fmtDate } from '@/lib/v2/format'

interface ManagedUser {
  id: number
  name: string
  phone: string
  role: 'SUPERUSER' | 'ADMIN'
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export default function UsersPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [resetFor, setResetFor] = useState<ManagedUser | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setAuthorized(d.user?.role === 'SUPERUSER')
      })
      .catch(() => setAuthorized(false))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!authorized) return
    let alive = true
    fetch('/api/auth/users')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => { if (alive) setUsers(d.data ?? []) })
      .catch(console.error)
    return () => { alive = false }
  }, [authorized, refreshKey])

  async function toggleActive(u: ManagedUser) {
    setError('')
    try {
      await apiCall(`/api/auth/users/${u.id}`, 'PATCH', { isActive: !u.isActive })
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (authorized === null) {
    return (
      <>
        <PageHeader section="Users" subtitle="Loading…" />
        <main className="flex-1 px-8 py-7"><EmptyState text="Loading…" /></main>
      </>
    )
  }

  if (!authorized) {
    return (
      <>
        <PageHeader section="Users" subtitle="Account management" />
        <main className="flex-1 px-8 py-7">
          <div className="mx-auto max-w-[560px] card p-8 text-center">
            <ShieldCheck className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Superuser access required
            </h3>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Only the superuser can manage admin accounts.
            </p>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <PageHeader
        section="Users"
        subtitle={<><span className="mono">{users.length}</span> account{users.length === 1 ? '' : 's'}</>}
      >
        <Button onClick={() => setShowCreate(true)}>
          <UserPlus className="w-3.5 h-3.5" /> New Admin
        </Button>
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1000px] space-y-4">
          {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Name', 'Mobile', 'Role', 'Status', 'Last Login', ''].map((h, i) => (
                      <th key={i} className={`px-4 py-3 label-micro font-medium ${i === 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr><td colSpan={6}><EmptyState text="No accounts yet." /></td></tr>
                  )}
                  {users.map((u) => (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</td>
                      <td className="px-4 py-3 mono" style={{ color: 'var(--text-secondary)' }}>{u.phone}</td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded-md text-[11px] font-medium"
                          style={
                            u.role === 'SUPERUSER'
                              ? { background: 'var(--blue-soft)', color: 'var(--data-2)' }
                              : { background: 'var(--accent-soft)', color: 'var(--text-secondary)' }
                          }
                        >
                          {u.role === 'SUPERUSER' ? 'Super Admin' : 'Admin'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={u.isActive ? 'Active' : 'Disabled'} />
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {u.role === 'SUPERUSER' ? (
                            <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                              managed on server
                            </span>
                          ) : (
                            <>
                              <Button variant="ghost" small onClick={() => setResetFor(u)}>
                                <KeyRound className="w-3.5 h-3.5" /> Reset
                              </Button>
                              <Button
                                variant={u.isActive ? 'danger' : 'ghost'}
                                small
                                onClick={() => toggleActive(u)}
                              >
                                {u.isActive ? 'Disable' : 'Enable'}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            New accounts are created as <strong style={{ color: 'var(--text-secondary)' }}>Admin</strong> and
            sign in with their mobile number. The superuser is managed from the server via{' '}
            <code className="mono">npm run db:create-superuser</code>.
          </p>
        </div>
      </main>

      <CreateAdminModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); reload() }}
      />
      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => { setResetFor(null); reload() }}
        />
      )}
    </>
  )
}

function CreateAdminModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await apiCall('/api/auth/users', 'POST', { name, phone, password })
      setName(''); setPhone(''); setPassword('')
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Admin" subtitle="Creates an admin account that signs in with a mobile number.">
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <Field label="Full Name"><input className={inputCls} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile Number">
          <input type="tel" inputMode="numeric" className={`${inputCls} mono`} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
        </Field>
        <Field label="Password">
          <input type="password" className={inputCls} style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !phone.trim() || password.length < 8}>
            {busy ? 'Creating…' : 'Create Admin'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ResetPasswordModal({
  user, onClose, onDone,
}: { user: ManagedUser; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await apiCall(`/api/auth/users/${user.id}`, 'PATCH', { password })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password · ${user.name}`} subtitle="Set a new password for this admin.">
      <div className="space-y-3.5">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}
        <Field label="New Password">
          <input type="password" className={inputCls} style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoFocus />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || password.length < 8}>
            {busy ? 'Saving…' : 'Reset Password'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
