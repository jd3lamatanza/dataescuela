import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('las probanzas históricas se desvinculan sin enviar el archivo original a la papelera', async () => {
  const source = await readFile(new URL('../supabase/functions/labores-drive/index.ts', import.meta.url), 'utf8')
  const quitar = source.split("if (action === 'quitar')")[1].split("if (action === 'eliminar')")[0]
  assert.match(quitar, /select\('id, labor_id, drive_file_id, historico'\)/)
  assert.match(quitar, /if \(!a\.historico\) \{[\s\S]*trashed: true/)
  assert.match(quitar, /from\('labor_archivos'\)\.delete\(\)/)
})

test('los campos históricos se muestran y exportan sin mezclarlos', async () => {
  const page = await readFile(new URL('../src/pages/Labores.tsx', import.meta.url), 'utf8')
  const exportacion = await readFile(new URL('../src/lib/laboresExport.ts', import.meta.url), 'utf8')
  assert.match(page, /escuela_historica/)
  assert.match(page, /acuerdos_pendientes_historicos/)
  assert.match(exportacion, /Escuela: \$\{l\.escuela_historica\}/)
  assert.match(exportacion, /Pendientes: \$\{l\.acuerdos_pendientes_historicos\}/)
})
