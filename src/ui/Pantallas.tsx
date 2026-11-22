import { href } from '../lib/router'
import { BTN_PRIMARY } from './kit'

export function Splash() {
  return <div class="app-splash" role="status" aria-label="Cargando DataEscuela">
    <img src={`${import.meta.env.BASE_URL}icon-512.png?v=2`} width="192" height="192" alt="" />
    <p class="app-splash-title">DataEscuela</p>
    <p class="app-splash-message">Cargando la aplicación…</p>
  </div>
}

export function ErrorPagina({ permiso = false }: { permiso?: boolean }) {
  return <section class="mx-auto flex max-w-2xl flex-col items-center px-4 py-8 text-center">
    <h1 class="text-xl font-bold text-slate-900">{permiso ? 'Sin acceso' : 'Página no encontrada'}</h1>
    <p class="mt-2 text-sm text-slate-600">{permiso ? 'No tenés permiso para este módulo.' : 'La página que buscás no existe.'}</p>
    <img src={`${import.meta.env.BASE_URL}error-acceso.png`} width="840" height="768" alt="" class="my-4 w-full max-w-lg" />
    <a href={href('/')} class={BTN_PRIMARY}>Volver al inicio</a>
  </section>
}
