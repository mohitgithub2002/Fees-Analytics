'use client'

import { useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { PageHeader } from '@/components/v2/PageHeader'
import { EmptyState } from '@/components/v2/ui'
import { EstimatedDataBadge } from '@/components/recovery/chips'
import { InstallmentWaterfall } from '@/components/recovery/InstallmentWaterfall'
import { MonthlyChart } from '@/components/recovery/MonthlyChart'
import { ClassCohortChart } from '@/components/recovery/ClassCohortChart'
import { ARCHETYPE_META, type PaymentArchetype } from '@/lib/recovery/types'
import { fmtCur } from '@/lib/v2/format'
import type {
  ClassCohortDTO, InstallmentBehaviourDTO, MonthlyCollectionDTO, SegmentMatrixResponse,
} from '@/lib/recovery/api-types'

const tabTrigger =
  'px-3.5 h-9 rounded-lg text-[13px] font-medium transition-colors data-[state=active]:bg-[var(--accent-soft)] data-[state=active]:text-[var(--text-primary)]'

const ARCHETYPE_ORDER: PaymentArchetype[] = [
  'CHRONIC_DEFAULTER', 'NEXT_YEAR_PAYER', 'HEAVY_ROLLOVER', 'YEAR_END_PARTIAL',
  'YEAR_END_FULL', 'INSTALLMENT_REGULAR', 'EARLY_FULL', 'UNKNOWN',
]

export default function BehaviorPage() {
  const [installments, setInstallments] = useState<InstallmentBehaviourDTO[] | null>(null)
  const [monthly, setMonthly] = useState<{ months: MonthlyCollectionDTO[]; sessions: string[]; dataQuality: { percentEstimated: number } } | null>(null)
  const [classes, setClasses] = useState<ClassCohortDTO[] | null>(null)
  const [segments, setSegments] = useState<SegmentMatrixResponse | null>(null)

  useEffect(() => {
    fetch('/api/v2/recovery/behavior/installments').then((r) => r.json()).then((d) => setInstallments(d.data)).catch(() => setInstallments([]))
    fetch('/api/v2/recovery/behavior/monthly').then((r) => r.json()).then(setMonthly).catch(() => {})
    fetch('/api/v2/recovery/behavior/classes').then((r) => r.json()).then((d) => setClasses(d.data)).catch(() => setClasses([]))
    fetch('/api/v2/recovery/behavior/segments').then((r) => r.json()).then(setSegments).catch(() => {})
  }, [])

  const archetypeTotals = new Map<PaymentArchetype, { households: number; outstanding: number }>()
  for (const cell of segments?.cells ?? []) {
    const cur = archetypeTotals.get(cell.archetype) ?? { households: 0, outstanding: 0 }
    cur.households += cell.households
    cur.outstanding += cell.outstanding
    archetypeTotals.set(cell.archetype, cur)
  }

  return (
    <>
      <PageHeader section="Behaviour" subtitle="How, and when, fees actually get collected">
        {monthly && monthly.dataQuality.percentEstimated > 0 && (
          <EstimatedDataBadge percentEstimated={monthly.dataQuality.percentEstimated} />
        )}
      </PageHeader>

      <main className="flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[1400px]">
          <Tabs.Root defaultValue="installments">
            <Tabs.List className="flex items-center gap-1 mb-5" style={{ color: 'var(--text-secondary)' }}>
              <Tabs.Trigger value="installments" className={tabTrigger}>Installments</Tabs.Trigger>
              <Tabs.Trigger value="months" className={tabTrigger}>Months</Tabs.Trigger>
              <Tabs.Trigger value="classes" className={tabTrigger}>Classes</Tabs.Trigger>
              <Tabs.Trigger value="archetypes" className={tabTrigger}>Behaviour Types</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="installments">
              <div className="card p-6">
                <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>Installment Performance</h3>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>Expected vs collected, on time and late, for the current session&apos;s school fee installments.</p>
                {installments ? <InstallmentWaterfall data={installments} /> : <EmptyState text="Loading…" />}
              </div>
            </Tabs.Content>

            <Tabs.Content value="months">
              <div className="card p-6">
                <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>Collection by Month</h3>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>When in the calendar year money arrives, compared across recent sessions.</p>
                {monthly ? <MonthlyChart months={monthly.months} sessions={monthly.sessions} /> : <EmptyState text="Loading…" />}
              </div>
            </Tabs.Content>

            <Tabs.Content value="classes">
              <div className="card p-6">
                <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>Recovery by Class</h3>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>Each class measured against its own average — a class with a wide &quot;below average&quot; band has a structural problem, not just slow payers.</p>
                {classes ? <ClassCohortChart data={classes} /> : <EmptyState text="Loading…" />}
              </div>
            </Tabs.Content>

            <Tabs.Content value="archetypes">
              <div className="card p-6">
                <h3 className="text-[14px] font-semibold tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>Behaviour Type Distribution</h3>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>How households are classified by payment behaviour, and how much money sits in each group.</p>
                {!segments ? (
                  <EmptyState text="Loading…" />
                ) : archetypeTotals.size === 0 ? (
                  <EmptyState text="No classified households yet — recalculate from the Command Center." />
                ) : (
                  <div className="space-y-2">
                    {ARCHETYPE_ORDER.filter((a) => archetypeTotals.has(a)).map((a) => {
                      const t = archetypeTotals.get(a)!
                      const meta = ARCHETYPE_META[a]
                      const maxOutstanding = Math.max(...[...archetypeTotals.values()].map((v) => v.outstanding), 1)
                      return (
                        <div key={a} className="flex items-center gap-4 py-2">
                          <span className="w-44 flex-shrink-0 text-[12.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>{meta.label}</span>
                          <div className="flex-1 h-6 rounded-md overflow-hidden" style={{ background: 'var(--elevated)' }}>
                            <div
                              className="h-full rounded-md"
                              style={{
                                width: `${Math.max(4, (t.outstanding / maxOutstanding) * 100)}%`,
                                background: meta.tone === 'critical' ? 'var(--critical)' : meta.tone === 'warning' ? 'var(--warning)' : meta.tone === 'good' ? 'var(--good)' : 'var(--text-faint)',
                              }}
                            />
                          </div>
                          <span className="w-32 flex-shrink-0 text-right mono text-[12.5px]" style={{ color: 'var(--text-primary)' }}>{fmtCur(t.outstanding)}</span>
                          <span className="w-20 flex-shrink-0 text-right mono text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{t.households} hh</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </main>
    </>
  )
}
