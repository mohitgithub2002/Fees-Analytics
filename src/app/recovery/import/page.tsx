import { redirect } from 'next/navigation'

/**
 * Payment import moved into the single School Data screen alongside students
 * and fees. Two places to upload a file is one too many — especially when the
 * three uploads have to happen in a particular order.
 */
export default function RecoveryImportRedirect() {
  redirect('/manage/import')
}
