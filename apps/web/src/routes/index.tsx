import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { RiffStudio } from '#/components/riff-studio'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <ClientOnly fallback={<main className="boot-shell">RIFF</main>}>
      <RiffStudio />
    </ClientOnly>
  )
}
