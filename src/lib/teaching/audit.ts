import { Prisma } from '@/generated/prisma/client'
import type { ActorType } from '@/generated/prisma/enums'

/**
 * writeAudit() — always called inside the same transaction as the change it
 * describes, so the log can never disagree with reality. actorName is
 * captured redundantly (not looked up later) so the log stays readable even
 * after the actor's account is gone.
 */

interface AuditInput {
  actorType: ActorType
  actorId: number
  actorName: string
  action: string
  entityType: string
  entityId?: number | null
  oldValue?: unknown
  newValue?: unknown
}

export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
  await tx.teachingAuditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValue: input.oldValue === undefined ? Prisma.JsonNull : (input.oldValue as Prisma.InputJsonValue),
      newValue: input.newValue === undefined ? Prisma.JsonNull : (input.newValue as Prisma.InputJsonValue),
    },
  })
}
