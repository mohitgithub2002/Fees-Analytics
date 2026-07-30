import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

/**
 * Shared response helpers for the Teacher & Syllabus module. Always
 * `{ data }` on success and `{ error }` on failure, so every client branches
 * on one predictable shape (see AGENTS docs, Section 4.4 conventions).
 */

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status })
}

export function err(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function parseId(raw: string | null | undefined): number | null {
  if (!raw) return null
  const id = parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** page/pageSize query params, defaulting to 50 and capped at 200. */
export function parsePagination(sp: URLSearchParams) {
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') || '50', 10) || 50))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

/** True when both dates fall on the same local calendar day (used for the "same-day only" edit window). */
export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Map Prisma errors to consistent JSON error responses. */
export function handleError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return err('a record with these values already exists', 409)
    if (e.code === 'P2025') return err('record not found', 404)
    if (e.code === 'P2003') return err('related record not found', 400)
  }
  console.error(e)
  return err('internal server error', 500)
}
