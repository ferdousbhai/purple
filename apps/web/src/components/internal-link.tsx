import type { AnchorHTMLAttributes, MouseEvent } from 'react'

export type NavigateInApp = (href: string) => void

interface InternalLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  navigate?: NavigateInApp
}

/** Preserve native modified-click behavior while avoiding same-tab reloads. */
export function InternalLink({
  href,
  navigate,
  onClick,
  ...props
}: InternalLinkProps) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      !navigate ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    navigate(href)
  }

  return <a {...props} href={href} onClick={follow} />
}
