import { prisma } from '@/lib/prisma'
import type { TopicStatus } from '@/generated/prisma/enums'

/**
 * Completion aggregation. Only TEACHING-type SessionTopicDetail rows count
 * toward syllabus completion — REVISION rows are recorded so revision
 * coverage can be reported on independently, but they don't move the
 * "has this been taught" needle (see AGENTS docs, Section 2.4).
 */

/** Latest TEACHING status per subtopic, for one assignment. */
export async function getSubtopicCompletionMap(
  assignmentId: number,
  subtopicIds: number[],
): Promise<Map<number, TopicStatus>> {
  if (subtopicIds.length === 0) return new Map()

  const rows = await prisma.sessionTopicDetail.findMany({
    where: {
      subtopicId: { in: subtopicIds },
      sessionLog: { assignmentId, type: 'TEACHING' },
    },
    select: { subtopicId: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const map = new Map<number, TopicStatus>()
  for (const row of rows) {
    if (row.subtopicId != null) map.set(row.subtopicId, row.status)
  }
  return map
}

export function chapterCompletionPercent(subtopicIds: number[], statusMap: Map<number, TopicStatus>): number {
  if (subtopicIds.length === 0) return 0
  const complete = subtopicIds.filter((id) => statusMap.get(id) === 'COMPLETE').length
  return Math.round((complete / subtopicIds.length) * 100)
}
