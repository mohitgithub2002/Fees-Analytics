import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/teaching/guards'
import { ok, err, parseId } from '@/lib/teaching/http'

/** One audit entry with its full old and new value payloads. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const id = parseId((await params).id)
  if (!id) return err('invalid id', 400)

  const log = await prisma.teachingAuditLog.findUnique({ where: { id } })
  if (!log) return err('audit log entry not found', 404)
  return ok(log)
}
