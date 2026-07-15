export default function Loading() {
  return (
    <div className="app-canvas flex h-screen w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-9 h-9 rounded-full border-2"
          style={{
            borderColor: 'var(--border-strong)',
            borderTopColor: 'var(--text-primary)',
            animation: 'spin .7s linear infinite',
          }}
        />
        <p className="text-[13px] font-medium mono" style={{ color: 'var(--text-muted)' }}>
          Loading dashboard…
        </p>
      </div>
    </div>
  )
}
