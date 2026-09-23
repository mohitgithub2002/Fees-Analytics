/**
 * The upload formats, defined once.
 *
 * This is the contract between the downloadable template, the import
 * validator and the mapping UI. Keeping the three in one place is what stops
 * the file a school is told to fill in from drifting away from the file the
 * server actually accepts.
 *
 * Pure and Prisma-free so the UI can import it.
 */

export interface TemplateColumn {
  key: string
  /** The header written into the downloadable template. */
  header: string
  required?: boolean
  hint: string
  /** Alternative headers accepted when auto-detecting a school's own file. */
  aliases?: string[]
}

export interface ImportTemplate {
  key: 'students' | 'fees' | 'payments'
  title: string
  summary: string
  /** Said plainly on the screen, because order matters and is not obvious. */
  order: string
  columns: TemplateColumn[]
  sample: Record<string, string>[]
}

/* ── 1. Students, with their parents ───────────────────────────────
 *
 * One row per child. Parent details ride along on the child's row, because
 * that is how school registers are actually kept — nobody maintains a separate
 * parent list, and asking for one guarantees the upload never happens.
 *
 * `familyId` is the important column. It is what makes siblings ONE payer
 * instead of three, and it is explicit rather than guessed: any repeated value
 * groups those children together. Leave it blank and children are grouped by
 * parent phone number instead; leave both blank and each child becomes its own
 * family, which you can merge later by hand.
 */
export const STUDENTS_TEMPLATE: ImportTemplate = {
  key: 'students',
  title: 'Students & parents',
  summary:
    'One row per child, with the parent’s name and phone on the same row. Siblings are grouped into one family so they become a single phone call.',
  order: 'Upload this first — fees and payments both need the students to exist.',
  columns: [
    {
      key: 'admissionNo',
      header: 'Admission No',
      hint: 'Your own student number. Strongly recommended: it lets you re-upload the same file to update records instead of creating duplicates.',
      aliases: ['Admission Number', 'Adm No', 'Scholar No', 'Student ID', 'SR No'],
    },
    {
      key: 'studentName',
      header: 'Student Name',
      required: true,
      hint: 'The child’s full name.',
      aliases: ['Name', 'Student', 'Child Name'],
    },
    {
      key: 'className',
      header: 'Class',
      required: true,
      hint: 'e.g. Play, LKG, UKG, I, II … XII. Classes that do not exist yet are created for you.',
      aliases: ['Standard', 'Grade', 'Class Name'],
    },
    {
      key: 'section',
      header: 'Section',
      hint: 'A, B, C… Leave blank if you do not use sections.',
      aliases: ['Sec', 'Division'],
    },
    {
      key: 'familyId',
      header: 'Family ID',
      hint: 'Any code you like (F001, the father’s phone, a house number). Children sharing a value become ONE family and one phone call. Blank falls back to grouping by parent phone.',
      aliases: ['Family', 'Family Code', 'Household', 'Household ID', 'Sibling Group'],
    },
    {
      key: 'fatherName',
      header: 'Father Name',
      hint: 'Used as the family’s name on the call list.',
      aliases: ["Father's Name", 'Father', 'Guardian Name', 'Parent Name'],
    },
    {
      key: 'motherName',
      header: 'Mother Name',
      hint: 'Optional.',
      aliases: ["Mother's Name", 'Mother'],
    },
    {
      key: 'parentPhone',
      header: 'Parent Phone',
      hint: 'THE most important column for recovery — a family with no number cannot be chased at all. 10 digits, or with +91.',
      aliases: ['Phone', 'Mobile', 'Contact', 'Contact No', 'Father Phone', 'Parent Mobile'],
    },
    {
      key: 'altPhone',
      header: 'Alternate Phone',
      hint: 'A second number to try — often the mother’s.',
      aliases: ['Alt Phone', 'Mother Phone', 'Secondary Phone', 'Phone 2'],
    },
    { key: 'address', header: 'Address', hint: 'Optional.', aliases: ['Residence'] },
    { key: 'gender', header: 'Gender', hint: 'Optional.', aliases: ['Sex'] },
    {
      key: 'dateOfBirth',
      header: 'Date of Birth',
      hint: 'Optional. Day-first (14/08/2015) or 2015-08-14.',
      aliases: ['DOB', 'Birth Date'],
    },
  ],
  sample: [
    {
      'Admission No': '1001',
      'Student Name': 'Aarav Sharma',
      Class: 'III',
      Section: 'A',
      'Family ID': 'F001',
      'Father Name': 'Rajesh Sharma',
      'Mother Name': 'Sunita Sharma',
      'Parent Phone': '9876543210',
      'Alternate Phone': '9876500001',
      Address: '12 Station Road',
      Gender: 'M',
      'Date of Birth': '14/08/2015',
    },
    {
      'Admission No': '1002',
      'Student Name': 'Anaya Sharma',
      Class: 'I',
      Section: 'A',
      'Family ID': 'F001',
      'Father Name': 'Rajesh Sharma',
      'Mother Name': 'Sunita Sharma',
      'Parent Phone': '9876543210',
      'Alternate Phone': '',
      Address: '12 Station Road',
      Gender: 'F',
      'Date of Birth': '02/03/2018',
    },
    {
      'Admission No': '1003',
      'Student Name': 'Vihaan Gupta',
      Class: 'VIII',
      Section: '',
      'Family ID': 'F002',
      'Father Name': 'Manoj Gupta',
      'Mother Name': '',
      'Parent Phone': '+91 98765 11111',
      'Alternate Phone': '',
      Address: '',
      Gender: 'M',
      'Date of Birth': '',
    },
  ],
}

/* ── 2. Fees ────────────────────────────────────────────────────────
 *
 * What each child was billed. Most schools will instead define a fee structure
 * per class once (Setup → Fee Structures) and let it apply automatically; this
 * file is for schools whose amounts vary per child, and — importantly — for
 * carrying in LAST YEAR'S unpaid balance, which is what makes "owes for more
 * than one year" answerable on day one.
 */
export const FEES_TEMPLATE: ImportTemplate = {
  key: 'fees',
  title: 'Fees charged',
  summary:
    'What each child was billed. Use the Session column to bring in last year’s unpaid balance as well as this year’s fees.',
  order: 'Upload after students. Skip it entirely if you use class-wise fee structures instead.',
  columns: [
    {
      key: 'admissionNo',
      header: 'Admission No',
      hint: 'How the row is matched to a student. Use this if you have it.',
      aliases: ['Admission Number', 'Adm No', 'Student ID'],
    },
    {
      key: 'studentName',
      header: 'Student Name',
      hint: 'Used to match when there is no admission number.',
      aliases: ['Name', 'Student'],
    },
    {
      key: 'className',
      header: 'Class',
      hint: 'Helps when two children share a name.',
      aliases: ['Standard', 'Grade'],
    },
    {
      key: 'session',
      header: 'Session',
      hint: 'e.g. 2026-27. Blank means the current session. Use last year’s name to bring in an old balance.',
      aliases: ['Academic Year', 'Year'],
    },
    {
      key: 'category',
      header: 'Category',
      hint: 'SCHOOL, BUS or OTHER. Blank means SCHOOL.',
      aliases: ['Fee Type', 'Type'],
    },
    {
      key: 'feeName',
      header: 'Fee Name',
      required: true,
      hint: 'e.g. Tuition Fee, Bus Fee, Previous Balance. Re-uploading the same name for the same child is skipped, so the file is safe to run twice.',
      aliases: ['Particulars', 'Description', 'Fee Head'],
    },
    {
      key: 'amount',
      header: 'Amount',
      required: true,
      hint: 'The full amount charged, before any discount.',
      aliases: ['Total', 'Fees', 'Total Fees', 'Charged'],
    },
    {
      key: 'discount',
      header: 'Discount',
      hint: 'Concession given. Blank means none.',
      aliases: ['Concession', 'Waiver', 'Rebate'],
    },
    {
      key: 'paid',
      header: 'Already Paid',
      hint: 'How much of this has already been collected. Use it to load an opening balance — the leftover becomes what they owe.',
      aliases: ['Deposit', 'Received', 'Collected', 'Paid Amount'],
    },
    {
      key: 'installments',
      header: 'Installments',
      hint: 'How many parts this fee is split into. Blank means 1. School fees are commonly 3.',
      aliases: ['No of Installments', 'Parts'],
    },
  ],
  sample: [
    {
      'Admission No': '1001',
      'Student Name': 'Aarav Sharma',
      Class: 'III',
      Session: '',
      Category: 'SCHOOL',
      'Fee Name': 'Tuition Fee',
      Amount: '24000',
      Discount: '2000',
      'Already Paid': '8000',
      Installments: '3',
    },
    {
      'Admission No': '1001',
      'Student Name': 'Aarav Sharma',
      Class: 'III',
      Session: '',
      Category: 'BUS',
      'Fee Name': 'Bus Fee',
      Amount: '6000',
      Discount: '',
      'Already Paid': '0',
      Installments: '1',
    },
    {
      'Admission No': '1003',
      'Student Name': 'Vihaan Gupta',
      Class: 'VIII',
      Session: '2025-26',
      Category: 'SCHOOL',
      'Fee Name': 'Previous Balance',
      Amount: '18000',
      Discount: '',
      'Already Paid': '0',
      Installments: '1',
    },
  ],
}

/* ── 3. Payments ────────────────────────────────────────────────── */
export const PAYMENTS_TEMPLATE: ImportTemplate = {
  key: 'payments',
  title: 'Payments received',
  summary:
    'Every payment with the date it was actually received. This is what makes the system able to say WHEN families pay, not just how much they owe.',
  order: 'Upload last. Without real dates, behaviour patterns and the cash forecast stay blank.',
  columns: [
    {
      key: 'admissionNo',
      header: 'Admission No',
      hint: 'The most reliable way to match a payment to a student.',
      aliases: ['Admission Number', 'Adm No', 'Student ID'],
    },
    { key: 'studentName', header: 'Student Name', hint: 'Used when there is no admission number.', aliases: ['Name'] },
    { key: 'className', header: 'Class', hint: 'Helps when two children share a name.', aliases: ['Standard'] },
    {
      key: 'amount',
      header: 'Amount',
      required: true,
      hint: 'How much was received.',
      aliases: ['Paid', 'Deposit', 'Received'],
    },
    {
      key: 'paidAt',
      header: 'Payment Date',
      required: true,
      hint: 'The day the money actually arrived. Day-first (13/07/2026) is read correctly.',
      aliases: ['Date', 'Receipt Date', 'Paid On'],
    },
    {
      key: 'mode',
      header: 'Mode',
      hint: 'CASH, ONLINE, CHEQUE, BANK_TRANSFER, CARD or OTHER.',
      aliases: ['Payment Mode', 'Method'],
    },
    { key: 'reference', header: 'Receipt No', hint: 'Your own receipt or reference number.', aliases: ['Receipt', 'Reference', 'Txn No'] },
  ],
  sample: [
    {
      'Admission No': '1001',
      'Student Name': 'Aarav Sharma',
      Class: 'III',
      Amount: '8000',
      'Payment Date': '15/04/2026',
      Mode: 'CASH',
      'Receipt No': 'R-1001',
    },
    {
      'Admission No': '1003',
      'Student Name': 'Vihaan Gupta',
      Class: 'VIII',
      Amount: '5000',
      'Payment Date': '02/07/2026',
      Mode: 'ONLINE',
      'Receipt No': 'R-1002',
    },
  ],
}

export const TEMPLATES: Record<string, ImportTemplate> = {
  students: STUDENTS_TEMPLATE,
  fees: FEES_TEMPLATE,
  payments: PAYMENTS_TEMPLATE,
}

/** Render a template as CSV text, headers plus the worked example rows. */
export function templateToCsv(template: ImportTemplate): string {
  const headers = template.columns.map((c) => c.header)
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

  const lines = [headers.join(',')]
  for (const row of template.sample) {
    lines.push(headers.map((h) => escape(row[h] ?? '')).join(','))
  }
  return lines.join('\r\n')
}

/**
 * Guess which uploaded column is which, so a school can drop in its own export
 * and usually not have to map anything by hand.
 */
export function autoMap(
  template: ImportTemplate,
  headers: string[]
): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const byNorm = new Map(headers.map((h) => [norm(h), h]))
  const mapping: Record<string, string> = {}

  for (const column of template.columns) {
    const candidates = [column.header, ...(column.aliases ?? [])]
    for (const candidate of candidates) {
      const hit = byNorm.get(norm(candidate))
      if (hit && !Object.values(mapping).includes(hit)) {
        mapping[column.key] = hit
        break
      }
    }
  }
  return mapping
}
