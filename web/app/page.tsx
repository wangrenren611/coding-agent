import { redirect } from 'next/navigation'

export default function HomePage() {
  // Redirect to sessions page or create new session
  redirect('/sessions')
}
