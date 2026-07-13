import { Dialog, Box } from '@sanity/ui'
import type { ReactNode } from 'react'

interface InfoDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should close (X button, backdrop click, escape) */
  onClose: () => void
  /** Dialog title — string, or ReactNode (e.g. icon + text) */
  title: ReactNode
  /** Explicit ID for the dialog element (auto-derived from title when it's a string) */
  dialogId?: string
  /** Sanity UI Dialog width: 0=small, 1=medium (~750px), 2=large */
  width?: 0 | 1 | 2
  /** When false, hides close button and disables backdrop click-to-close (e.g. first-time setup) */
  closeable?: boolean
  /** Dialog content */
  children: ReactNode
}

export function InfoDialog({ open, onClose, title, dialogId, width = 1, closeable = true, children }: InfoDialogProps) {
  if (!open) return null

  const derivedId = dialogId
    ?? (typeof title === 'string'
      ? `info-dialog-${title.toLowerCase().replace(/\s+/g, '-')}`
      : 'info-dialog')

  return (
    <>
      {closeable && <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" onClick={onClose} />}
      <Dialog
        id={derivedId}
        header={typeof title === 'string' ? <span className="text-xl font-normal">{title}</span> : title}
        onClose={closeable ? onClose : undefined}
        onClickOutside={closeable ? onClose : undefined}
        width={width}
        animate
      >
        <Box padding={4} paddingTop={0}>
          {children}
        </Box>
      </Dialog>
    </>
  )
}
