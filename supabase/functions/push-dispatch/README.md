# Notificaciones Web Push

Cada notificación o mensaje recibido genera una tarea por suscripción registrada del destinatario en ese momento. En el buzón compartido de JD3, se avisa a los usuarios distritales activos; no se avisa al remitente por la copia enviada. Un trabajo de `pg_cron` invoca el despachador cada minuto; procesa hasta 100 tareas por ejecución y reintenta los errores con espera exponencial de hasta una hora. Los proveedores y el sistema operativo pueden retrasar o no entregar un aviso. Un fallo después del envío y antes de confirmarlo puede generar un duplicado.

El aviso no contiene datos de la notificación o del mensaje: el usuario debe abrir DataEscuela e iniciar sesión para consultar su bandeja. Las suscripciones permanecen al cerrar sesión y se registran para la cuenta real, también durante el ingreso simulado. Las suscripciones vencidas se eliminan; si un navegador renueva o pierde la suscripción, hay que activarla nuevamente.

## Configuración

Generar una pareja VAPID P-256 y un secreto aleatorio para el despachador; no versionar sus valores ni rotar la pareja sin planificar la nueva activación de los dispositivos. Configurar los secretos de Edge Functions `PUSH_VAPID_PUBLIC`, `PUSH_VAPID_PRIVATE` y `PUSH_DISPATCH_SECRET`. La clave pública y la privada son las coordenadas públicas sin comprimir y la clave privada, respectivamente, codificadas en base64url.

En Vault, registrar `dataescuela_push_public` con la clave pública, `dataescuela_push_private` con una copia de respaldo de la clave privada, `dataescuela_push_dispatch` con el mismo secreto del despachador y `dataescuela_push_url` con la URL del proyecto Supabase sin barra final. La función debe publicarse con `verify_jwt = false`: el planificador autentica cada llamada con una firma HMAC de corta duración, sin colocar el secreto en la cola de `pg_net`. Restringir el acceso administrativo a Vault y a los secretos de Edge Functions.

Para supervisar, revisar los errores de la función, `cron.job_run_details`, `net._http_response` y la cantidad de filas, reintentos y códigos de `push_cola`. No registrar endpoints, credenciales ni datos de notificaciones. Una solicitud aceptada por el proveedor no garantiza su entrega al dispositivo.
