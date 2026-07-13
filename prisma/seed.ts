import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

const prisma = new PrismaClient({ adapter })

const CLASS_ORDER = ['Nursery', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

const STUDENT_POOL = [
  { studentName: 'Aarav Sharma', fatherName: 'Rajesh Sharma' },
  { studentName: 'Ananya Gupta', fatherName: 'Suresh Gupta' },
  { studentName: 'Arjun Verma', fatherName: 'Deepak Verma' },
  { studentName: 'Diya Patel', fatherName: 'Mahesh Patel' },
  { studentName: 'Ishaan Singh', fatherName: 'Vijay Singh' },
  { studentName: 'Kavya Joshi', fatherName: 'Prakash Joshi' },
  { studentName: 'Kiran Kumar', fatherName: 'Anil Kumar' },
  { studentName: 'Meera Agarwal', fatherName: 'Ramesh Agarwal' },
  { studentName: 'Nikhil Pandey', fatherName: 'Santosh Pandey' },
  { studentName: 'Priya Mishra', fatherName: 'Narendra Mishra' },
  { studentName: 'Rahul Tiwari', fatherName: 'Dinesh Tiwari' },
  { studentName: 'Riya Yadav', fatherName: 'Sunil Yadav' },
  { studentName: 'Rohan Srivastava', fatherName: 'Ashok Srivastava' },
  { studentName: 'Sakshi Dubey', fatherName: 'Rakesh Dubey' },
  { studentName: 'Siddharth Chauhan', fatherName: 'Naresh Chauhan' },
  { studentName: 'Tanvi Saxena', fatherName: 'Vivek Saxena' },
  { studentName: 'Uday Bhatt', fatherName: 'Ramakant Bhatt' },
  { studentName: 'Vanya Malhotra', fatherName: 'Sanjay Malhotra' },
  { studentName: 'Yash Thakur', fatherName: 'Suresh Thakur' },
  { studentName: 'Zara Khan', fatherName: 'Imran Khan' },
  { studentName: 'Aditya Rao', fatherName: 'Venkat Rao' },
  { studentName: 'Bhavna Singh', fatherName: 'Ranjit Singh' },
  { studentName: 'Chirag Mehta', fatherName: 'Haresh Mehta' },
  { studentName: 'Deepa Nair', fatherName: 'Krishnan Nair' },
  { studentName: 'Eshan Kapoor', fatherName: 'Rohit Kapoor' },
]

function getFeeStructure(className: string) {
  const lower = ['Nursery', 'LKG', 'UKG']
  const mid = ['I', 'II', 'III', 'IV', 'V']
  const high = ['VI', 'VII', 'VIII']

  if (lower.includes(className)) return { school: 12000, bus: 6000, extra: 2000 }
  if (mid.includes(className)) return { school: 15000, bus: 7000, extra: 3000 }
  if (high.includes(className)) return { school: 18000, bus: 8000, extra: 4000 }
  return { school: 22000, bus: 9000, extra: 5000 } // IX, X
}

function round100(n: number) {
  return Math.max(0, Math.round(n / 100) * 100)
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min
}

async function main() {
  console.log('🌱 Seeding database...')
  await prisma.studentFee.deleteMany()

  const records = []

  for (const className of CLASS_ORDER) {
    const fees = getFeeStructure(className)
    const numStudents = 8 + Math.floor(Math.random() * 5) // 8-12 students per class
    const shuffled = [...STUDENT_POOL].sort(() => Math.random() - 0.5)
    const classStudents = shuffled.slice(0, numStudents)

    for (const student of classStudents) {
      const paymentBehavior = Math.random() // 0=good payer, 1=bad payer

      // Previous year dues (30% chance)
      const hasPrevDue = Math.random() < 0.30
      const previousFees = hasPrevDue ? round100(rand(2000, 8000)) : 0
      const previousDiscount = 0
      const previousDeposit = hasPrevDue ? round100(previousFees * rand(0, 0.5)) : 0
      const previousDue = previousFees - previousDeposit - previousDiscount

      // School fees
      const schoolFees = fees.school
      const schoolDiscount = Math.random() < 0.10 ? round100(schoolFees * 0.10) : 0
      let schoolDeposit: number
      if (paymentBehavior < 0.35) schoolDeposit = schoolFees - schoolDiscount        // Full payer
      else if (paymentBehavior < 0.75) schoolDeposit = round100((schoolFees - schoolDiscount) * rand(0.25, 0.80)) // Partial
      else schoolDeposit = 0                                                           // Non-payer
      const schoolDue = schoolFees - schoolDeposit - schoolDiscount

      // Bus fees (70% use bus)
      const usesBus = Math.random() < 0.70
      const busFees = usesBus ? fees.bus : 0
      const busDiscount = 0
      let busDeposit = 0
      if (usesBus) {
        if (paymentBehavior < 0.40) busDeposit = busFees
        else if (paymentBehavior < 0.78) busDeposit = round100(busFees * rand(0.20, 0.80))
      }
      const busDue = busFees - busDeposit - busDiscount

      // Extra fees (80% charged)
      const hasExtra = Math.random() < 0.80
      const extraFees = hasExtra ? fees.extra : 0
      const extraDiscount = 0
      let extraDeposit = 0
      if (hasExtra) {
        if (paymentBehavior < 0.45) extraDeposit = extraFees
        else if (paymentBehavior < 0.80) extraDeposit = round100(extraFees * rand(0.20, 0.80))
      }
      const extraDue = extraFees - extraDeposit - extraDiscount

      // Totals
      const totalFees = previousFees + schoolFees + busFees + extraFees
      const totalDeposit = previousDeposit + schoolDeposit + busDeposit + extraDeposit
      const totalDiscount = previousDiscount + schoolDiscount + busDiscount + extraDiscount
      const totalDue = previousDue + schoolDue + busDue + extraDue

      const remarks =
        totalDue === 0
          ? 'Cleared'
          : totalDue > 0.7 * (schoolFees + busFees + extraFees)
          ? 'High Due'
          : totalDue > 0.3 * (schoolFees + busFees + extraFees)
          ? 'Partial Payment'
          : ''

      records.push({
        class: className,
        studentName: student.studentName,
        fatherName: student.fatherName,
        previousFees,
        previousDeposit,
        previousDiscount,
        previousDue,
        schoolFees,
        schoolDeposit,
        schoolDiscount,
        schoolDue,
        busFees,
        busDeposit,
        busDiscount,
        busDue,
        extraFees,
        extraDeposit,
        extraDiscount,
        extraDue,
        totalFees,
        totalDeposit,
        totalDiscount,
        totalDue,
        academicYear: '2024-25',
        remarks,
      })
    }
  }

  await prisma.studentFee.createMany({ data: records })
  console.log(`✅ Seeded ${records.length} student fee records across ${CLASS_ORDER.length} classes`)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
