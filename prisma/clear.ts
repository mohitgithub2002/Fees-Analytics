import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

const prisma = new PrismaClient({ adapter })

async function main() {
  await prisma.studentFee.deleteMany()
  console.log('✅ All student fee records have been successfully deleted.')
}

main()
  .catch((e) => {
    console.error('❌ Failed to delete records:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
