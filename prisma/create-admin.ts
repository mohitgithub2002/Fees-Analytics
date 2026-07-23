/**
 * Create or update an admin account from the command line.
 *
 *   npm run db:create-admin -- --email you@school.com --password "secret123" --name "Head Admin"
 *
 * Or via env vars: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME.
 * If the email already exists, its password/name/role are updated and the
 * account is re-activated.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { hashPassword } from '../src/lib/auth/password'

const pool = new Pool({ connectionString: `${process.env.DATABASE_URL}` })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const email = (arg('--email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = arg('--password') || process.env.ADMIN_PASSWORD || ''
  const name = (arg('--name') || process.env.ADMIN_NAME || 'Administrator').trim()

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('❌ A valid --email (or ADMIN_EMAIL) is required.')
    process.exit(1)
  }
  if (!password || password.length < 8) {
    console.error('❌ --password (or ADMIN_PASSWORD) must be at least 8 characters.')
    process.exit(1)
  }

  const passwordHash = hashPassword(password)
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role: 'ADMIN' },
    update: { name, passwordHash, role: 'ADMIN', isActive: true },
  })

  console.log(`✅ Admin ready: ${user.email} (${user.name})`)
}

main()
  .catch((e) => {
    console.error('❌ Failed to create admin:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
