'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { GraduationCap, Loader2, Lock } from 'lucide-react'

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/manage'

  const [mode, setMode] = useState<'loading' | 'login' | 'setup'>('loading')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) {
          router.replace(next)
          return
        }
        setMode(d.needsSetup ? 'setup' : 'login')
      })
      .catch(() => setMode('login'))
  }, [router, next])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const url = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login'
      const payload =
        mode === 'setup' ? { email, name, password } : { email, password }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      router.replace(next)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--elevated-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="app-canvas min-h-full w-full flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-[380px]">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            <GraduationCap className="w-6 h-6" />
          </div>
          <h1 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            VPS School
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Fees Management
          </p>
        </div>

        <div className="card p-6">
          {mode === 'loading' ? (
            <div className="flex items-center justify-center py-10" style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  {mode === 'setup' ? 'Create admin account' : 'Sign in'}
                </h2>
                <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {mode === 'setup'
                    ? 'No accounts exist yet. Create the first administrator to secure the system.'
                    : 'Enter your credentials to access the dashboard.'}
                </p>
              </div>

              <form onSubmit={submit} className="space-y-3.5">
                {error && (
                  <div
                    className="px-3.5 py-2.5 rounded-lg text-[12.5px]"
                    style={{ background: 'var(--critical-soft)', color: 'var(--critical)' }}
                  >
                    {error}
                  </div>
                )}

                {mode === 'setup' && (
                  <label className="block">
                    <span className="label-micro block mb-1.5">Full Name</span>
                    <input
                      className="w-full h-10 px-3 rounded-lg text-[13px] outline-none"
                      style={inputStyle}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </label>
                )}

                <label className="block">
                  <span className="label-micro block mb-1.5">Email</span>
                  <input
                    type="email"
                    className="w-full h-10 px-3 rounded-lg text-[13px] outline-none"
                    style={inputStyle}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                  />
                </label>

                <label className="block">
                  <span className="label-micro block mb-1.5">Password</span>
                  <input
                    type="password"
                    className="w-full h-10 px-3 rounded-lg text-[13px] outline-none"
                    style={inputStyle}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                    placeholder={mode === 'setup' ? 'At least 8 characters' : ''}
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || !email || !password || (mode === 'setup' && !name)}
                  className="w-full h-10 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:pointer-events-none"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      {mode === 'setup' ? 'Create account & sign in' : 'Sign in'}
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-[11.5px] mt-6" style={{ color: 'var(--text-faint)' }}>
          Authorised access only.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
