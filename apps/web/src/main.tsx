import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { installChunkReloadRecovery } from '#/lib/chunk-reload'
import { PurpleApp } from '#/purple-app'
import './styles.css'

installChunkReloadRecovery()

interface CrashScreenState {
  error: Error | null
}

/** A render crash replaces the studio with the same message page routes used to show. */
class CrashScreen extends Component<{ children: ReactNode }, CrashScreenState> {
  state: CrashScreenState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="route-message">
          <h1>PURPLE</h1>
          <p role="alert">{this.state.error.message}</p>
          <a href="/">Reload the studio</a>
        </main>
      )
    }
    return this.props.children
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing the #root element.')

createRoot(root).render(
  <CrashScreen>
    <PurpleApp />
  </CrashScreen>,
)
