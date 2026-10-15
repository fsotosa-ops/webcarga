'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { driversApi } from '@/lib/api/drivers'
import { contactsApi } from '@/lib/api/contacts'
import { invalidateDirectory } from '@/lib/queries/directorio'
import { ContactCard, AddContactForm } from '@/components/dashboard/ContactCard'
import { Estado } from '@/components/ui/Estado'

const DRIVER_CONTACT_ROLE_OPTIONS = ['PERSONAL', 'EMERGENCIA', 'OTRO']

/** Los contactos de un conductor, en el panel lateral de su ficha (15/10). */
export function DriverContacts({ driverId, canEdit, canDelete }: { driverId: string; canEdit: boolean; canDelete: boolean }) {
  const queryClient = useQueryClient()
  const contactsQuery = useQuery({
    queryKey: ['driver-contacts', driverId],
    queryFn: () => driversApi.listContacts(driverId),
  })

  async function afterChange() {
    await queryClient.invalidateQueries({ queryKey: ['driver-contacts', driverId] })
    // El teléfono de la vista rápida sale del contacto principal.
    await invalidateDirectory(queryClient, { entity: 'driver', id: driverId, type: 'contact' })
  }

  if (contactsQuery.isPending) return <Estado tipo="cargando" />
  const contacts = contactsQuery.data ?? []
  return (
    <div className="grid grid-cols-1 gap-2">
      {contacts.map(c => (
        <ContactCard key={c.id} contact={c} canEdit={canEdit} canDelete={canDelete}
                     onSaved={async patch => { await contactsApi.patch(c.id, patch); await afterChange() }}
                     onDeleted={async () => { await contactsApi.delete(c.id); await afterChange() }} />
      ))}
      {canEdit && (
        <AddContactForm roleOptions={DRIVER_CONTACT_ROLE_OPTIONS}
                        onAdd={async body => { await driversApi.createContact(driverId, body); await afterChange() }} />
      )}
      {contacts.length === 0 && !canEdit && <p className="text-dato text-informativo">Sin contactos registrados.</p>}
    </div>
  )
}
