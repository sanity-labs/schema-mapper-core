import { ReactNode } from 'react'
import { Dialog, Box } from '@sanity/ui'

interface InfoDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should close (X button, backdrop click, escape) */
  onClose: () => void
  /** Dialog title text */
  title: string
  /** Sanity UI Dialog width: 0=small, 1=medium (~750px), 2=large */
  width?: 0 | 1 | 2
  /** Dialog content */
  children: ReactNode
}

export function InfoDialog({ open, onClose, title, width = 1, children }: InfoDialogProps) {
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" onClick={onClose} />
      <Dialog
        id={`info-dialog-${title.toLowerCase().replace(/\s+/g, '-')}`}
        header={<span className="text-xl font-normal">{title}</span>}
        onClose={onClose}
        onClickOutside={onClose}
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
