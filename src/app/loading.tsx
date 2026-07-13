export default function Loading() {
  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-11 h-11 rounded-full border-2 animate-spin"
          style={{
            borderColor: 'rgba(99,102,241,0.3)',
            borderTopColor: 'var(--indigo)',
          }}
        />
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Loading dashboard…
        </p>
      </div>
    </div>
  )
}
