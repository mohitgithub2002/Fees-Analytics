import { Prisma } from '@/generated/prisma/client'

/**
 * All fee arithmetic happens in integer paise to avoid floating-point drift.
 * Amounts are stored in the DB as Decimal(12,2) and exposed to API consumers
 * as plain numbers (rupees with 2 decimal places).
 */

export type MoneyLike = number | string | Prisma.Decimal

export function toPaise(value: MoneyLike): number {
  return Math.round(Number(value) * 100)
}

export function toRupees(paise: number): number {
  return paise / 100
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Split an amount into `parts` pieces that sum exactly to the original.
 * Every piece gets the floor share; the last piece absorbs the remainder.
 */
export function splitAmount(amount: MoneyLike, parts: number): number[] {
  if (parts < 1) throw new Error('parts must be >= 1')
  const total = toPaise(amount)
  const base = Math.floor(total / parts)
  const result: number[] = new Array(parts).fill(base)
  result[parts - 1] = total - base * (parts - 1)
  return result.map(toRupees)
}

/**
 * Recursively convert Prisma Decimal values (and Dates) into JSON-friendly
 * primitives so API responses expose money as numbers, not strings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serialize(value: any): any {
  if (value === null || value === undefined) return value
  if (Prisma.Decimal.isDecimal(value)) return Number(value)
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}
