export interface StudentFee {
  id: number
  class: string
  studentName: string
  fatherName: string
  previousFees: number
  previousDeposit: number
  previousDiscount: number
  previousDue: number
  schoolFees: number
  schoolDeposit: number
  schoolDiscount: number
  schoolDue: number
  busFees: number
  busDeposit: number
  busDiscount: number
  busDue: number
  extraFees: number
  extraDeposit: number
  extraDiscount: number
  extraDue: number
  totalFees: number
  totalDeposit: number
  totalDiscount: number
  totalDue: number
  academicYear: string
  remarks: string | null
  createdAt: string
  updatedAt: string
}

export interface AnalyticsOverview {
  totalStudents: number
  totalFees: number
  totalDeposit: number
  totalDue: number
  previousDue: number
  schoolDue: number
  busDue: number
  extraDue: number
  recoveryRate: string
}

export interface ClassBreakdown {
  class: string
  _sum: {
    previousDue: number | null
    schoolDue: number | null
    busDue: number | null
    extraDue: number | null
    totalDue: number | null
    totalFees: number | null
    totalDeposit: number | null
  }
  _count: { id: number }
}

export interface Analytics {
  overview: AnalyticsOverview
  byClass: ClassBreakdown[]
}

export interface PaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

export interface StudentsResponse {
  data: StudentFee[]
  pagination: PaginationInfo
}

export interface FilterState {
  class: string
  minDue: string
  maxDue: string
  search: string
  feeType: string
}
