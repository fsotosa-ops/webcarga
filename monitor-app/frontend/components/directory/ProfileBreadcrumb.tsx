import Link from 'next/link'

/** La ruta de una ficha: "Módulo › Lista › Quién". Si se llegó con `?next=`
 *  (`returnLink`), la vuelta reemplaza al módulo y la lista. */
export function ProfileBreadcrumb({ module, list, title, back }: {
  module: string
  list: { href: string; label: string }
  title: string
  back?: { href: string; label: string } | null
}) {
  return (
    <nav aria-label="Ruta" className="flex items-center gap-1.5 text-xs text-informativo">
      {back
        ? <Link href={back.href} className="hover:text-accion">{back.label}</Link>
        : <>{module} <span aria-hidden>›</span> <Link href={list.href} className="hover:text-accion">{list.label}</Link></>}
      <span aria-hidden>›</span> <span className="truncate font-semibold text-text-primary">{title}</span>
    </nav>
  )
}
