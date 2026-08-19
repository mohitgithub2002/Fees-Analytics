import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool:   Pool | undefined
}

function createPool() {
  const pool = new Pool({
    connectionString: `${process.env.DATABASE_URL}`,
    // Neon scale-to-zero: a cold start can take a few seconds, so wait rather
    // than fail fast, but do not hang forever if the endpoint is unreachable.
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  })
  // An idle client dropped by Neon emits 'error' on the pool; without a listener
  // that becomes an unhandled exception and kills the dev server.
  pool.on('error', (err) => {
    console.error('[prisma] idle pg client error:', err.message)
  })
  return pool
}

// The pool must be cached alongside the client: on HMR this module re-evaluates
// and would otherwise leak a new pool per reload while the cached client keeps
// using the original adapter.
const pool = globalForPrisma.pool ?? createPool()

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.pool   = pool
}
