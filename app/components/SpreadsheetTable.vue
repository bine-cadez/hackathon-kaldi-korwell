<script setup lang="ts">
import type { PreviewSheet } from '~/utils/sourcePreview'

// One sheet of a CSV or Excel preview. Cells are rendered as text.
defineProps<{ sheet: PreviewSheet }>()
</script>

<template>
  <div>
    <p v-if="!sheet.rows.length" class="py-6 text-muted">This sheet is empty.</p>
    <div v-else class="max-h-[70vh] overflow-auto rounded-lg border border-default">
      <table class="min-w-full border-collapse text-sm leading-snug">
        <thead class="sticky top-0 z-10 bg-muted">
          <tr>
            <th v-if="sheet.rowNumbers" class="sticky left-0 z-20 border-r border-b border-default bg-muted px-2 py-1.5" aria-label="Row" />
            <th
              v-for="(column, index) in sheet.columns"
              :key="index"
              scope="col"
              class="border-b border-default px-3 py-1.5 text-left font-semibold whitespace-nowrap text-highlighted"
              :class="sheet.rowNumbers ? 'text-center font-normal text-muted' : ''"
            >
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in sheet.rows" :key="rowIndex" class="even:bg-elevated/40">
            <th
              v-if="sheet.rowNumbers"
              scope="row"
              class="sticky left-0 border-r border-b border-default bg-muted px-2 py-1 text-right font-normal text-muted tabular-nums"
            >
              {{ sheet.rowNumbers[rowIndex] }}
            </th>
            <td
              v-for="(cell, cellIndex) in row"
              :key="cellIndex"
              class="max-w-[24rem] border-b border-default px-3 py-1 align-top whitespace-pre-wrap"
            >
              {{ cell }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="sheet.truncated" class="mt-2 text-sm text-muted">
      Showing the first {{ sheet.rows.length.toLocaleString() }} of {{ sheet.totalRows.toLocaleString() }} rows. Download the original to see them all.
    </p>
  </div>
</template>
