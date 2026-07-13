import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import csv from 'csv-parser'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

const prisma = new PrismaClient({ adapter })

function parseNumber(val: string | undefined): number {
  if (!val) return 0
  // Remove commas if any exist (e.g. "1,000")
  const cleanVal = val.replace(/,/g, '')
  const parsed = parseFloat(cleanVal)
  return isNaN(parsed) ? 0 : parsed
}

async function main() {
  const results: any[] = []
  
  const csvFilePath = path.join(process.cwd(), 'feesdata.csv')
  
  console.log(`Loading data from ${csvFilePath}...`)
  
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', resolve)
      .on('error', reject)
  })

  console.log(`Parsed ${results.length} rows from CSV.`)
  
  await prisma.studentFee.deleteMany()
  console.log('Cleared existing student fee records.')
  
  const recordsToInsert = results.map(row => {
    const previousFees = parseNumber(row['Previous Fees'])
    const schoolFees = parseNumber(row['Current Fees'])
    const busFees = parseNumber(row['Current Vehicle'])
    const extraFees = 0

    return {
      class: row['Class'] || '',
      studentName: row['Student Name'] || '',
      fatherName: row['Father Name'] || '',
      
      previousFees: previousFees,
      previousDeposit: parseNumber(row['Previous Deposit']),
      previousDiscount: parseNumber(row['Previous Discount']),
      previousDue: parseNumber(row['Previous Due']),
      
      schoolFees: schoolFees,
      schoolDeposit: parseNumber(row['Current Fees Deposit']),
      schoolDiscount: parseNumber(row['Current Fees Discount']),
      schoolDue: parseNumber(row['Current Due Fees']),
      
      busFees: busFees,
      busDeposit: parseNumber(row['Current Vehicle Deposit']),
      busDiscount: parseNumber(row['Current Vehicle Discount']),
      busDue: parseNumber(row['Current Vechicle Due']) || parseNumber(row['Current Vehicle Due']), // Handle both spellings
      
      extraFees: extraFees,
      extraDeposit: 0,
      extraDiscount: 0,
      extraDue: 0,
      
      totalFees: previousFees + schoolFees + busFees + extraFees,
      totalDeposit: parseNumber(row['Total Deposit']),
      totalDiscount: parseNumber(row['Previous Discount']) + parseNumber(row['Current Fees Discount']) + parseNumber(row['Current Vehicle Discount']),
      totalDue: parseNumber(row['Total Due']),
      
      remarks: row['Remarks'] || '',
    }
  })

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
    const chunk = recordsToInsert.slice(i, i + chunkSize)
    await prisma.studentFee.createMany({ data: chunk })
    inserted += chunk.length
    console.log(`Inserted ${inserted} / ${recordsToInsert.length} records...`)
  }

  console.log('✅ Successfully loaded CSV data into the database.')
}

main()
  .catch((e) => {
    console.error('❌ Loading failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
