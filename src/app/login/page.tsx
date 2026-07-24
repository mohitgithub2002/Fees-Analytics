'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { GraduationCap, Loader2, Lock } from 'lucide-react'

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/manage'

  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [phone, setPhone] = useState('')
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
        setNeedsSetup(Boolean(d.needsSetup))
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [router, next])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
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
          {!ready ? (
            <div className="flex items-center justify-center py-10" style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="mb-5">
                <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  Sign in
                </h2>
                <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Enter your mobile number and password to continue.
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

                <label className="block">
                  <span className="label-micro block mb-1.5">Mobile Number</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    className="w-full h-10 px-3 rounded-lg text-[13px] outline-none mono"
                    style={inputStyle}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="username"
                    placeholder="98765 43210"
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
                    autoComplete="current-password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || !phone || !password}
                  className="w-full h-10 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:pointer-events-none"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      Sign in
                    </>
                  )}
                </button>

                {needsSetup && (
                  <p className="text-[11.5px] leading-relaxed pt-1" style={{ color: 'var(--text-muted)' }}>
                    No accounts exist yet. Create the superuser on the server with{' '}
                    <code className="mono" style={{ color: 'var(--text-secondary)' }}>
                      npm run db:create-superuser
                    </code>
                    , then sign in.
                  </p>
                )}
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
