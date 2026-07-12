import { inngest } from './inngest'

/**
 * Best-effort event emit: async work must never fail its caller (webhooks,
 * usage recording). Returns whether Inngest accepted the event so callers can
 * run an inline fallback when it didn't (no keys, dev server down).
 */
export async function emit(name: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    await inngest.send({ name, data })
    return true
  } catch (e) {
    console.error(`inngest send ${name} failed:`, e instanceof Error ? e.message : e)
    return false
  }
}
