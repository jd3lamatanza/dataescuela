import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { remitente, validarConfiguracion, type ConfiguracionEmail } from '../_shared/configuracion-email.ts'

const APP_URL = Deno.env.get('APP_PUBLIC_URL') ?? ''
const APP_PARSED_URL = APP_URL ? new URL(APP_URL) : null
const APP_ORIGIN = APP_PARSED_URL?.origin ?? ''
const APP_REDIRECT_URL = APP_PARSED_URL ? `${APP_PARSED_URL.origin}${APP_PARSED_URL.pathname}` : ''
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
const genericResponse = () => json({
  message: 'Si la cuenta existe y tiene un correo registrado, recibirás un enlace para recuperar el acceso.',
}, 202)

async function hash(value: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const body = await req.json()
    const login = typeof body?.login === 'string' ? body.login.trim().slice(0, 120) : ''
    if (!login || !APP_REDIRECT_URL || !APP_ORIGIN.startsWith('https://')) return genericResponse()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const smtpUser = Deno.env.get('SMTP_USERNAME')
    const smtpPassword = Deno.env.get('SMTP_PASSWORD')
    if (!supabaseUrl || !serviceKey || !smtpUser || !smtpPassword) {
      console.error('Password recovery is missing server configuration')
      return json({ error: 'El servicio de recuperación no está disponible.' }, 503)
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown'
    const loginHash = await hash(login.toLowerCase(), serviceKey)
    const ipHash = await hash(forwarded, serviceKey)
    const { data: allowed, error: limitError } = await admin.rpc('password_recovery_allow', {
      p_login_hash: loginHash,
      p_ip_hash: ipHash,
    })
    if (limitError) {
      console.error('Password recovery rate limit failed:', limitError.message)
      return json({ error: 'El servicio de recuperación no está disponible.' }, 503)
    }
    if (!allowed) return genericResponse()

    const { data: rows, error: recipientError } = await admin.rpc('password_recovery_recipient', { p_login: login })
    if (recipientError) {
      console.error('Password recovery recipient lookup failed:', recipientError.message)
      return json({ error: 'El servicio de recuperación no está disponible.' }, 503)
    }
    const recipient = rows?.[0] as { auth_email: string; email: string; name: string } | undefined
    if (!recipient?.email) return genericResponse()

    const { data, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: recipient.auth_email,
      options: { redirectTo: APP_REDIRECT_URL },
    })
    if (linkError || !data.properties?.action_link) {
      console.error('Password recovery link generation failed:', linkError?.message ?? 'No action link returned')
      return json({ error: 'El servicio de recuperación no está disponible.' }, 503)
    }

    const { data: config, error: configError } = await admin.from('configuracion_email').select('salidas_destino,sistema_remitente,respuesta,nombre_remitente').eq('id', true).maybeSingle()
    if (configError) {
      console.error('Email configuration lookup failed:', configError.message)
      return json({ error: 'El servicio de recuperación no está disponible.' }, 503)
    }
    const configuracion = config as ConfiguracionEmail | null
    if (configuracion) validarConfiguracion(configuracion)
    const mailer = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: smtpUser, password: smtpPassword },
      },
    })
    try {
      await mailer.send({
        from: configuracion ? remitente(configuracion) : `DataEscuela <${smtpUser}>`,
        ...(configuracion ? { replyTo: configuracion.respuesta } : {}),
        to: recipient.email,
        subject: 'Recuperación de acceso a DataEscuela',
        content: `Hola ${recipient.name},\n\nRecibimos una solicitud para recuperar el acceso a tu cuenta de DataEscuela. Para elegir una contraseña nueva, abrí este enlace:\n\n${data.properties.action_link}\n\nEl enlace es de un solo uso y vence pronto. Si no solicitaste esta recuperación, podés ignorar este mensaje; tu contraseña actual no cambiará.\n\nDataEscuela`,
      })
    } finally {
      await mailer.close()
    }
    return genericResponse()
  } catch (error) {
    console.error('Password recovery request failed:', error instanceof Error ? error.message : String(error))
    return json({ error: 'El servicio de recuperación no está disponible.' }, 503)
  }
})
