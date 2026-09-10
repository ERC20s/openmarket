export function parsePageSize(pageRaw?: string | null, sizeRaw?: string | null): { page: number; size: number; skip: number; error?: string } {
  const pageStr = pageRaw ?? '1'
  const sizeStr = sizeRaw ?? '20'

  const page = parseInt(pageStr, 10)
  const size = parseInt(sizeStr, 10)

  if (Number.isNaN(page) || page < 1 || Number.isNaN(size) || size < 1 || size > 100) {
    return { page: 1, size: 20, skip: 0, error: 'Invalid page or size' }
  }

  const skip = (page - 1) * size
  return { page, size, skip }
}
