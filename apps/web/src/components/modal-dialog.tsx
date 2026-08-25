import { useEffect, useRef, type ReactNode } from 'react'

export function ModalDialog(props: {
  children: (close: () => void) => ReactNode
  className: string
  closeLabel: string
  descriptionId: string
  eyebrow: string
  onClose: () => void
  title: string
  titleId: string
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const close = () => {
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    else props.onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className={props.className}
      aria-labelledby={props.titleId}
      aria-describedby={props.descriptionId}
      onClose={props.onClose}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <header className="feedback-head">
        <div>
          <span>{props.eyebrow}</span>
          <h2 id={props.titleId}>{props.title}</h2>
        </div>
        <button type="button" aria-label={props.closeLabel} onClick={close}>×</button>
      </header>
      {props.children(close)}
    </dialog>
  )
}

export function DialogSubmitActions(props: {
  disabled: boolean
  idleLabel: string
  onCancel: () => void
  pending: boolean
  pendingLabel: string
}) {
  return (
    <>
      <button type="button" className="chrome" onClick={props.onCancel}>CANCEL</button>
      <button className="primary" disabled={props.disabled}>
        {props.pending ? props.pendingLabel : props.idleLabel}
      </button>
    </>
  )
}
