// Lightweight client-side types for the /api/v2 responses.

export type FeeCategory = 'SCHOOL' | 'BUS' | 'OTHER'
export type InstallmentStatus = 'PENDING' | 'PARTIAL' | 'PAID'

export interface SessionV2 {
  id: number
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
  _count?: { enrollments: number; classrooms: number }
}

export interface ClassV2 {
  id: number
  name: string
  displayOrder: number
  isActive: boolean
  _count?: { classrooms: number; feeStructures: number }
}

export interface ClassroomV2 {
  id: number
  classId: number
  sessionId: number
  section: string
  class?: ClassV2
  session?: { id: number; name: string; isCurrent?: boolean }
  _count?: { enrollments: number }
}

export interface InstallmentV2 {
  id: number
  sequence: number
  label: string
  dueDate: string | null
  originalAmount: number
  discountAmount: number
  netAmount: number
  paidAmount: number
  status: InstallmentStatus
}

export interface FeeItemV2 {
  id: number
  enrollmentId: number
  category: FeeCategory
  name: string
  originalAmount: number
  discountAmount: number
  netAmount: number
  paidAmount: number
  dueAmount: number
  installments: InstallmentV2[]
  discounts?: { id: number; amount: number; reason: string | null; createdAt: string }[]
}

export interface EnrollmentV2 {
  id: number
  studentId: number
  sessionId: number
  classroomId: number
  rollNo: number | null
  status: string
  session: { id: number; name: string; isCurrent: boolean }
  classroom: { id: number; section: string; class: { id: number; name: string } }
  feeItems: FeeItemV2[]
}

export interface StudentV2 {
  id: number
  admissionNo: string | null
  name: string
  fatherName: string
  motherName: string | null
  phone: string | null
  address: string | null
  isActive: boolean
  remarks: string | null
  enrollments: EnrollmentV2[]
  transactions?: TransactionV2[]
}

export interface AllocationV2 {
  id: number
  amount: number
  installment?: {
    id: number
    label: string
    feeItem: {
      id?: number
      name: string
      category: FeeCategory
      enrollment?: { session: { id?: number; name: string } }
    }
  }
}

export interface TransactionV2 {
  id: number
  receiptNo: string
  studentId: number
  category: FeeCategory | null
  amount: number
  mode: string
  reference: string | null
  remarks: string | null
  status: 'COMPLETED' | 'CANCELLED'
  paidAt: string
  student?: { id: number; name: string; fatherName: string }
  allocations: AllocationV2[]
}

export interface DuesV2 {
  studentId: number
  studentName: string
  totalDue: number
  pastSessionsDue: number
  bySession: {
    enrollmentId: number
    session: { id: number; name: string; isCurrent: boolean }
    class: string
    section: string
    dueByCategory: Record<FeeCategory, number>
    totalDue: number
    pendingInstallments: {
      installmentId: number
      feeItemId: number
      feeName: string
      category: FeeCategory
      label: string
      dueDate: string | null
      netAmount: number
      paidAmount: number
      dueAmount: number
      status: InstallmentStatus
    }[]
  }[]
}

export interface AnalyticsV2 {
  session: { id: number; name: string; isCurrent: boolean }
  overview: {
    totalStudents: number
    totalFees: number
    totalDiscount: number
    netFees: number
    totalCollected: number
    totalDue: number
    recoveryRate: string
  }
  byCategory: {
    category: FeeCategory
    _sum: { netAmount: number; paidAmount: number; dueAmount: number }
  }[]
  byClass: {
    classId: number
    class: string
    students: number
    netAmount: number
    paidAmount: number
    dueAmount: number
    schoolDue: number
    busDue: number
    otherDue: number
  }[]
  carriedForwardDues: { students: number; dueAmount: number }
}

export interface FeeStructureV2 {
  id: number
  sessionId: number
  classId: number
  class?: ClassV2
  session?: { id: number; name: string; isCurrent?: boolean }
  items: {
    id: number
    category: FeeCategory
    name: string
    amount: number
    installmentCount: number
    /** Optional per-installment due dates. Empty = undated installments. */
    schedule?: {
      id: number
      sequence: number
      label: string | null
      dueDate: string
      amount: number | null
    }[]
  }[]
}

export interface PaginationV2 {
  page: number
  limit: number
  total: number
  pages: number
}
