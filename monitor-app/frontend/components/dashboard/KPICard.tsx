interface KPICardProps {
  title: string
  value: number
  color: string
  subtitle?: string
}

export default function KPICard({ title, value, color, subtitle }: KPICardProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-border overflow-hidden flex flex-col">
      <div className="h-1 w-full" style={{ backgroundColor: color }} />
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider leading-tight"
          style={{ color, fontFamily: 'var(--font-poppins)' }}
        >
          {title}
        </span>
        <p className="font-mulish font-bold text-3xl text-text-primary leading-none">{value}</p>
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
    </div>
  )
}
