export default function MonitorLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal:    React.ReactNode
}) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
