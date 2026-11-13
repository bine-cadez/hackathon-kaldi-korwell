import { parseCsv } from '#shared/utils/csv'
import { decodeTextBytes } from '#shared/utils/text'

// Previews of the original uploaded file, shown in the document reader next to
// the extracted text. PDFs open in the browser's own viewer. CSV and Excel are
// parsed here in the browser into plain string grids, which the template
// renders as text (never as HTML).

export type SourcePreviewKind = 'pdf' | 'csv' | 'spreadsheet'

const SPREADSHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'xls']

export function sourcePreviewKind (filename: string | undefined): SourcePreviewKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(filename || '')?.[1]?.toLowerCase() ?? ''
  if (extension === 'pdf') return 'pdf'
  if (extension === 'csv') return 'csv'
  if (SPREADSHEET_EXTENSIONS.includes(extension)) return 'spreadsheet'
  return null
}

// Big sheets would freeze the tab and make an unreadable wall of cells. The
// full file is always one click away through "Download original".
export const PREVIEW_MAX_ROWS = 500

export interface PreviewSheet {
  name: string
  // Column headings: the CSV header row, or A, B, C… for Excel.
  columns: string[]
  rows: string[][]
  // Spreadsheet row number of each row in `rows` (Excel only).
  rowNumbers?: number[]
  // Rows in the whole sheet, and whether only the first PREVIEW_MAX_ROWS are shown.
  totalRows: number
  truncated: boolean
}

// Rows and columns that are empty all the way to the edge only add scrolling.
function trimGrid (rows: string[][]): string[][] {
  let width = 0
  for (const row of rows) {
    for (let index = row.length - 1; index >= width; index -= 1) {
      if (row[index]?.trim()) {
        width = index + 1
        break
      }
    }
  }
  return rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? ''))
}

export function csvPreview (bytes: Uint8Array, name: string): PreviewSheet {
  const [header = [], ...rows] = parseCsv(decodeTextBytes(bytes).text)
  const grid = trimGrid([header, ...rows.slice(0, PREVIEW_MAX_ROWS)])
  return {
    name,
    columns: grid[0]!.map((cell, index) => cell.trim() || `Column ${index + 1}`),
    rows: grid.slice(1),
    totalRows: rows.length,
    truncated: rows.length > PREVIEW_MAX_ROWS
  }
}

export async function spreadsheetPreview (bytes: Uint8Array): Promise<PreviewSheet[]> {
  // SheetJS is large, so it loads only when someone opens a spreadsheet.
  const XLSX = await import('xlsx')
  // sheetRows stops parsing early. SheetJS then keeps the real size in !fullref.
  const workbook = XLSX.read(bytes, { type: 'array', dense: true, sheetRows: PREVIEW_MAX_ROWS })
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]!
    const ref = sheet['!ref']
    if (!ref) return { name, columns: [], rows: [], totalRows: 0, truncated: false }
    const range = XLSX.utils.decode_range(ref)
    const full = XLSX.utils.decode_range(sheet['!fullref'] ?? ref)
    // raw: false gives the text Excel shows (formatted numbers and dates).
    const grid = trimGrid(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true })
      .map(row => row.map(cell => String(cell ?? ''))))
    // Drop empty rows at the end, which Excel often keeps in the used range.
    while (grid.length && grid.at(-1)!.every(cell => !cell.trim())) grid.pop()
    return {
      name,
      columns: (grid[0] ?? []).map((_, index) => XLSX.utils.encode_col(range.s.c + index)),
      rows: grid,
      rowNumbers: grid.map((_, index) => range.s.r + index + 1),
      totalRows: full.e.r - full.s.r + 1,
      truncated: full.e.r > range.e.r
    }
  })
}
