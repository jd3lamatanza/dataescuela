import { test } from 'node:test'
import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import { PREINSCRIPCION_EAV_URL } from '../src/lib/preinscripcionEavUrl.ts'

test('el QR apunta al formulario público de preinscripción', () => {
  const url = 'https://jd3lamatanza.github.io/dataescuela/#/preinscripcion-eav'
  assert.equal(PREINSCRIPCION_EAV_URL, url)
  const qr = QRCode.create(PREINSCRIPCION_EAV_URL)
  assert.equal(qr.segments.map((segmento) => typeof segmento.data === 'string' ? segmento.data : new TextDecoder().decode(segmento.data)).join(''), url)
})
