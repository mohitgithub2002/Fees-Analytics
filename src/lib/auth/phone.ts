/**
 * Normalize a mobile number to a canonical digit string so the same person
 * always maps to the same stored value. Strips spaces, dashes, parentheses and
 * a leading "+"; a leading "91" country code on a 12-digit number is dropped so
 * "+91 98765 43210" and "9876543210" match. Returns null if it doesn't look
 * like a valid mobile number (10–15 digits after cleanup).
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null
  let digits = input.replace(/[^\d]/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length < 10 || digits.length > 15) return null
  return digits
}
