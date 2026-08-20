import handler from '@tanstack/react-start/server-entry'

// The Worker only serves the app shell. There are no accounts, no billing and
// no server-side inference: patterns, chat history and the Gemini key live in
// the visitor's browser, and generation requests go straight to Google.
export default handler
