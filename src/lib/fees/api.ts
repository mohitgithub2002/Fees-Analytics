import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { AllocationError } from './allocation'
import { FeeItemError } from './fee-items'
import { serialize } from './money'

export function ok(data: unknown, status = 200) {
  return NextResponse.json(serialize(data), { status })
}

export function err(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...serialize(extra ?? {}) }, { status })
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function parseId(raw: string): number | null {
  const id = parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function isPositiveAmount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/** Map domain + Prisma errors to consistent JSON error responses. */
export function handleError(e: unknown) {
  if (e instanceof FeeItemError) return err(e.message, e.status)
  if (e instanceof AllocationError) {
    return err(e.message, 400, { outstanding: e.outstanding })
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return err('a record with these unique values already exists', 409)
    if (e.code === 'P2025') return err('record not found', 404)
    if (e.code === 'P2003') return err('related record not found', 400)
  }
  console.error(e)
  return err('internal server error', 500)
}
