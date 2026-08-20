import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { PurpleStudio } from '#/components/purple-studio'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <ClientOnly fallback={<main className="boot-shell">PURPLE</main>}>
      <PurpleStudio />
    </ClientOnly>
  )
}
