update public.ayuda_guias
set secciones = jsonb_set(secciones, '{0,pasos,0}',
    to_jsonb('Tocá el botón Reporte de error en la barra superior. Se genera automáticamente un PNG de toda la página; revisalo antes de enviar o cancelá si no querés compartirlo.'::text)),
    version = version + 1,
    actualizado = now()
where id = 'reporte-error'
  and secciones #>> '{0,pasos,0}' = 'Tocá el botón Reporte de error en la barra superior. Si el navegador lo permite, elegí la pantalla o pestaña que querés capturar; de lo contrario, adjuntá una imagen PNG o JPEG de hasta 2 MB.';
