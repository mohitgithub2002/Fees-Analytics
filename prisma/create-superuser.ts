/**
 * Create or update the SUPERUSER account from the command line. This is the
 * only way a superuser is created — the app never exposes it. The superuser is
 * in turn the only account that can create ADMIN users inside the app.
 *
 *   npm run db:create-superuser -- --phone 9876543210 --password "secret123" --name "Principal"
 *
 * Or via env vars: SUPERUSER_PHONE, SUPERUSER_PASSWORD, SUPERUSER_NAME.
 * If the mobile number already exists, its password/name/role are updated and
 * the account is re-activated.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { hashPassword } from '../src/lib/auth/password'
import { normalizePhone } from '../src/lib/auth/phone'

const pool = new Pool({ connectionString: `${process.env.DATABASE_URL}` })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const phoneInput = arg('--phone') || process.env.SUPERUSER_PHONE || ''
  const password = arg('--password') || process.env.SUPERUSER_PASSWORD || ''
  const name = (arg('--name') || process.env.SUPERUSER_NAME || 'Super Admin').trim()

  const phone = normalizePhone(phoneInput)
  if (!phone) {
    console.error('❌ A valid --phone (or SUPERUSER_PHONE) is required (10–15 digits).')
    process.exit(1)
  }
  if (!password || password.length < 8) {
    console.error('❌ --password (or SUPERUSER_PASSWORD) must be at least 8 characters.')
    process.exit(1)
  }

  const passwordHash = hashPassword(password)
  const user = await prisma.user.upsert({
    where: { phone },
    create: { phone, name, passwordHash, role: 'SUPERUSER' },
    update: { name, passwordHash, role: 'SUPERUSER', isActive: true },
  })

  console.log(`✅ Superuser ready: ${user.name} (${user.phone})`)
}

main()
  .catch((e) => {
    console.error('❌ Failed to create superuser:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
