'use client'

import type { TooltipRenderProps } from 'react-joyride'

export function TourTooltip({
  index,
  size,
  step,
  isLastStep,
  backProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      style={{
        background: 'rgba(15,23,42,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(28,185,236,0.25)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        width: '280px',
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      {/* Accent top bar */}
      <div style={{
        height: '2px',
        background: 'linear-gradient(90deg, #1cb9ec, #0e8db5)',
      }} />

      <div style={{ padding: '14px 16px 12px' }}>
        {/* Header: title + step counter */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          {step.title && (
            <p style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 700,
              color: '#f1f5f9',
              lineHeight: 1.3,
              paddingRight: '8px',
            }}>
              {step.title as string}
            </p>
          )}
          <span style={{
            flexShrink: 0,
            fontSize: '10px',
            fontWeight: 600,
            color: '#38bdf8',
            background: 'rgba(28,185,236,0.12)',
            padding: '2px 7px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
          }}>
            {index + 1}/{size}
          </span>
        </div>

        {/* Content */}
        <p style={{
          margin: '0 0 12px',
          fontSize: '12px',
          color: '#94a3b8',
          lineHeight: 1.6,
        }}>
          {step.content as string}
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {Array.from({ length: size }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: '2px',
                borderRadius: '2px',
                background: i <= index ? '#1cb9ec' : 'rgba(255,255,255,0.1)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Skip */}
          <button
            {...skipProps}
            style={{
              background: 'none',
              border: 'none',
              padding: '4px 0',
              fontSize: '11px',
              color: '#475569',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ✕ Saltar
          </button>

          {/* Back + Next */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {index > 0 && (
              <button
                {...backProps}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.1)',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                ← Atrás
              </button>
            )}
            <button
              {...primaryProps}
              style={{
                background: 'linear-gradient(90deg, #1cb9ec, #0e8db5)',
                border: 'none',
                padding: '5px 14px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#fff',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {isLastStep ? 'Finalizar' : 'Siguiente →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
