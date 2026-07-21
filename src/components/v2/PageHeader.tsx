export function PageHeader({
  section,
  subtitle,
  children,
}: {
  section: string
  subtitle?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header
      className="px-8 h-16 flex items-center justify-between flex-shrink-0"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="leading-tight">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Fees Management
          </h1>
          <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>/</span>
          <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{section}</span>
        </div>
        {subtitle && (
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </header>
  )
}
