'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, PhoneCall, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/v2/PageHeader'
import { Button, EmptyState, ErrorBanner, apiCall } from '@/components/v2/ui'
import { ArchetypeChip, CoverageNote, SectionCard, Stat, TierChip } from '@/components/recovery/chips'
import { fmtAmt, fmtCur, fmtDate } from '@/lib/v2/format'

interface Overview {
  session: { id: number; name: string }
  lastComputedAt: string | null
  money: { outstanding: number; expectedRecovery: number; recovered: number; households: number }
  today: {
    callable: number
    suppressed: number
    pinned: number
    dailyCallTarget: number
    callsLastSevenDays: number
  }
  promises: { dueThisWeek: number; dueThisWeekAmount: number; overdue: number }
  nextMonth: {
    month: string
    committed: number
    likely: number
    stretch: number
    sources: { key: string; label: string; committed: number; likely: number }[]
  } | null
  blockers: {
    noContactDetails: number
    untaggedAbility: number
    householdsNeedingReview: number
    forecastCoverage: string | null
  }
  mix: { archetype: string; label: string; households: number; outstanding: number }[]
  topHouseholds: {
    caseId: number
    householdId: number
    displayName: string
    archetype: string
    tier: string
    children: number
    outstanding: number
    expectedRecoveryValue: number
  }[]
}

export default function RecoveryHome() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v2/recovery/overview')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'could not load')
      setData(body.data)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // Deferred rather than called straight from the effect: kicking off a fetch
  // that sets state synchronously inside an effect triggers a cascading render.
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function recalculate() {
    setBusy(true)
    setError('')
    try {
      await apiCall('/api/v2/recovery/recalculate', 'POST')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const monthName = data?.nextMonth
    ? new Date(`${data.nextMonth.month}-01`).toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <>
      <PageHeader
        section="Command Center"
        subtitle={
          data
            ? `${data.session.name} · last worked out ${data.lastComputedAt ? fmtDate(data.lastComputedAt) : 'never'}`
            : undefined
        }
      >
        <Button onClick={recalculate} disabled={busy} variant="ghost">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Working…' : 'Recalculate'}
        </Button>
        <Link href="/recovery/worklist">
          <Button>
            <PhoneCall className="w-3.5 h-3.5" />
            Start calling
          </Button>
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
        {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

        {!data ? (
          <EmptyState text="Loading…" />
        ) : (
          <>
            {/* ── What to do today ──────────────────────────────
                Deliberately above the money. A dashboard that opens on
                "₹1.3 crore outstanding" tells the owner what they already
                know; the useful question is who to phone this morning. */}
            <div>
              <h2 className="label-micro mb-3">Today</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat
                  label="Worth calling now"
                  value={data.today.callable}
                  hint={`Target is ${data.today.dailyCallTarget} calls a day`}
                  tone={data.today.callable > 0 ? 'good' : undefined}
                />
                <Stat
                  label="Skipped today"
                  value={data.today.suppressed}
                  hint="Just paid, already promised, or recently called"
                />
                <Stat
                  label="Promises due this week"
                  value={data.promises.dueThisWeek}
                  hint={
                    data.promises.dueThisWeekAmount > 0
                      ? `${fmtAmt(data.promises.dueThisWeekAmount)} promised`
                      : 'Nothing promised yet'
                  }
                  tone={data.promises.dueThisWeek > 0 ? 'warn' : undefined}
                />
                <Stat
                  label="Broken promise dates"
                  value={data.promises.overdue}
                  hint="Past the date they named"
                  tone={data.promises.overdue > 0 ? 'critical' : undefined}
                />
              </div>
            </div>

            {/* ── Blockers ───────────────────────────────────── */}
            {(data.blockers.noContactDetails > 0 ||
              data.blockers.untaggedAbility > 0 ||
              data.blockers.householdsNeedingReview > 0) && (
              <SectionCard
                title="What's holding recovery back"
                subtitle="Fixing these makes every number on this page sharper"
              >
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {data.blockers.noContactDetails > 0 && (
                    <BlockerRow
                      count={data.blockers.noContactDetails}
                      title="families have no phone number"
                      detail="They cannot be called at all, however much they owe. Add numbers from the call list."
                      href="/recovery/worklist"
                      cta="Fix numbers"
                      severe
                    />
                  )}
                  {data.blockers.untaggedAbility > 0 && (
                    <BlockerRow
                      count={data.blockers.untaggedAbility}
                      title="families have no ability-to-pay tag"
                      detail="Ranking runs on payment behaviour alone until you tag them. Tag as you call — it takes one tap."
                      href="/recovery/parents"
                      cta="Browse families"
                    />
                  )}
                  {data.blockers.householdsNeedingReview > 0 && (
                    <BlockerRow
                      count={data.blockers.householdsNeedingReview}
                      title="family groupings need confirming"
                      detail="Siblings grouped automatically. A wrong grouping mixes two families' dues together."
                      href="/recovery/households"
                      cta="Review"
                    />
                  )}
                </div>
              </SectionCard>
            )}

            {/* ── Money ──────────────────────────────────────── */}
            <div>
              <h2 className="label-micro mb-3">Money</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat
                  label="Still owed"
                  value={fmtCur(data.money.outstanding)}
                  hint={`Across ${data.money.households} families`}
                  tone="critical"
                />
                <Stat
                  label="Realistically recoverable"
                  value={fmtCur(data.money.expectedRecovery)}
                  hint="What calling the callable families should actually bring in"
                  tone="good"
                />
                <Stat
                  label={monthName ? `${monthName} — safe to plan on` : 'Next month — committed'}
                  value={data.nextMonth ? fmtCur(data.nextMonth.committed) : '—'}
                  hint="Promises plus dues from families who pay on time"
                />
                <Stat
                  label={monthName ? `${monthName} — likely` : 'Next month — likely'}
                  value={data.nextMonth ? fmtCur(data.nextMonth.likely) : '—'}
                  hint="With normal follow-up"
                />
              </div>
              {data.blockers.forecastCoverage && (
                <div className="mt-3">
                  <CoverageNote message={data.blockers.forecastCoverage} />
                </div>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* ── How this school's families pay ───────────── */}
              <SectionCard
                title="How these families pay"
                subtitle="Grouped by the pattern in their payment history"
                action={
                  <Link
                    href="/recovery/behavior"
                    className="text-[12px] flex items-center gap-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Details <ArrowRight className="w-3 h-3" />
                  </Link>
                }
              >
                {data.mix.length === 0 ? (
                  <EmptyState text="Nothing worked out yet — run a recalculate." />
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {data.mix.map((m) => (
                      <div key={m.archetype} className="px-4 py-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <ArchetypeChip archetype={m.archetype} />
                        </div>
                        <span className="text-[12px] mono" style={{ color: 'var(--text-muted)' }}>
                          {m.households}
                        </span>
                        <span
                          className="text-[12.5px] mono font-medium w-20 text-right"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {fmtCur(m.outstanding)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* ── Best calls ───────────────────────────────── */}
              <SectionCard
                title="Best calls right now"
                subtitle="Ranked by what the call should actually collect, not by who owes most"
                action={
                  <Link
                    href="/recovery/worklist"
                    className="text-[12px] flex items-center gap-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Full list <ArrowRight className="w-3 h-3" />
                  </Link>
                }
              >
                {data.topHouseholds.length === 0 ? (
                  <EmptyState text="Nobody is worth calling today." />
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {data.topHouseholds.map((h) => (
                      <Link
                        key={h.householdId}
                        href={`/recovery/parents/${h.householdId}`}
                        className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-[12.5px] font-medium truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {h.displayName}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <ArchetypeChip archetype={h.archetype} small />
                            {h.tier !== 'UNKNOWN' && <TierChip tier={h.tier} small />}
                            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                              {h.children} {h.children === 1 ? 'child' : 'children'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p
                            className="text-[12.5px] mono font-medium"
                            style={{ color: 'var(--good-2)' }}
                          >
                            {fmtCur(h.expectedRecoveryValue)}
                          </p>
                          <p className="text-[11px] mono" style={{ color: 'var(--text-muted)' }}>
                            of {fmtCur(h.outstanding)}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function BlockerRow({
  count,
  title,
  detail,
  href,
  cta,
  severe,
}: {
  count: number
  title: string
  detail: string
  href: string
  cta: string
  severe?: boolean
}) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span
        className="text-[15px] font-semibold mono flex-shrink-0 w-12"
        style={{ color: severe ? 'var(--critical)' : 'var(--warning)' }}
      >
        {count}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </p>
      </div>
      <Link
        href={href}
        className="text-[12px] flex items-center gap-1 flex-shrink-0"
        style={{ color: 'var(--text-secondary)' }}
      >
        {cta} <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  )
}
