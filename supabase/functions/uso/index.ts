// Solicitudes diarias del proyecto. El PAT vive como secreto (MGMT_PAT), nunca en el cliente.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = req.headers.get('Authorization') ?? ''
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  // servidor_estado solo responde al distrital y al admin
  const { error } = await sb.rpc('servidor_estado')
  if (error) return json({ error: 'Sin permiso' }, 403)

  const ref = Deno.env.get('SUPABASE_URL')!.split('//')[1].split('.')[0]
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/usage.api-counts?interval=7day`, {
    headers: { Authorization: `Bearer ${Deno.env.get('MGMT_PAT')}` },
  })
  if (!r.ok) return json({ error: 'No se pudo consultar el uso' }, 502)
  const { result } = await r.json()
  const dias = (result ?? []).map((d: Record<string, number | string>) => ({
    dia: String(d.timestamp).slice(0, 10),
    rest: Number(d.total_rest_requests), auth: Number(d.total_auth_requests),
    storage: Number(d.total_storage_requests), realtime: Number(d.total_realtime_requests),
  }))
  return json({ dias })
})
