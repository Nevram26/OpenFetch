import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'

/** `scheme://host[:port]`. Node returns origin "null" for custom schemes like app://, so build it ourselves. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

/**
 * Wraps an ipcMain.handle() listener: rejects calls from any frame other than our own UI,
 * then validates the payload before the handler ever sees it.
 */
export function guard<S extends z.ZodType, R>(
  allowedOrigin: string,
  schema: S,
  fn: (input: z.output<S>) => R
): (event: Pick<IpcMainInvokeEvent, 'senderFrame'>, payload?: unknown) => R {
  return (event, payload) => {
    const url = event.senderFrame?.url // null once the frame is destroyed or navigated away
    if (!url || originOf(url) !== allowedOrigin)
      throw new Error('IPC call from an unexpected sender')
    return fn(schema.parse(payload))
  }
}
