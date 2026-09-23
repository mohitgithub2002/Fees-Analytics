import { NextRequest } from 'next/server'
import { err } from '@/lib/fees/api'
import { requireAdmin } from '@/lib/teaching/guards'
import { TEMPLATES, templateToCsv } from '@/lib/import/templates'

/**
 * Download a blank upload template, pre-filled with a worked example.
 *
 * The examples are left in on purpose: a header-only file leaves people
 * guessing what a Family ID looks like or whether dates are day-first, and
 * that guess is where bad uploads come from. They are meant to be deleted
 * before the real rows go in, and the importer says so.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const type = request.nextUrl.searchParams.get('type') ?? 'students'
  const template = TEMPLATES[type]
  if (!template) {
    return err(`type must be one of: ${Object.keys(TEMPLATES).join(', ')}`)
  }

  return new Response(templateToCsv(template), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${template.key}-template.csv"`,
    },
  })
}
