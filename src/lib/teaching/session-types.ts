import type { SessionType } from '@/generated/prisma/enums'

/**
 * The two questions every session type has to answer, in one place — they were
 * previously inlined as `type === 'TEACHING' || type === 'REVISION'` in each
 * write route, which is exactly the sort of list that goes stale when a new
 * type is added (as HOMEWORK was).
 */

export const SESSION_TYPES = ['TEACHING', 'REVISION', 'QA', 'TEST', 'HOMEWORK'] as const

export function isSessionType(value: unknown): value is SessionType {
  return typeof value === 'string' && (SESSION_TYPES as readonly string[]).includes(value)
}

/**
 * TEACHING / REVISION / HOMEWORK are recorded per subtopic — homework is set
 * on the same subtopic list the lesson was taught from. QA / TEST stay at
 * chapter granularity (a test spans a chapter, not one subtopic).
 */
export function usesSubtopicGranularity(type: SessionType): boolean {
  return type === 'TEACHING' || type === 'REVISION' || type === 'HOMEWORK'
}

/**
 * Only TEACHING rows count toward syllabus completion (see progress.ts), so
 * only a TEACHING write can change a pacing result. Recomputing after any
 * other type is a guaranteed no-op.
 */
export function affectsPacing(type: SessionType): boolean {
  return type === 'TEACHING'
}
