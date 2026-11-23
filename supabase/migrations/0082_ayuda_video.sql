create function public.ayuda_video_sesion_valida(p_actor uuid, p_sesion uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions ses
    join public.profiles actor on actor.id = ses.user_id and actor.active
    left join public.simulaciones sim on sim.actor_id = actor.id
    join public.profiles efectivo on efectivo.id = coalesce(sim.target_id, actor.id) and efectivo.active
    where ses.id = p_sesion and ses.user_id = p_actor
      and (ses.not_after is null or ses.not_after > now())
      and ((efectivo.role = 'escolar' and actor.role in ('escolar', 'distrital'))
        or (actor.role = 'distrital' and efectivo.id = actor.id and actor.permiso_avanzado))
  )
$$;
revoke all on function public.ayuda_video_sesion_valida(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ayuda_video_sesion_valida(uuid, uuid) to service_role;
