/**
 * Shared background-music hook: one looping <audio> per game view, fed by the
 * data-URL uploaded in settings. Playback follows the game's running state;
 * the user can mute per game without touching the persisted setting.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeDataUrl } from './security.ts'

export interface BgmControl {
  muted: boolean
  toggle: () => void
}

export function useBgm(src: string | null | undefined, active: boolean): BgmControl {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (typeof Audio === 'undefined') return // non-browser (tests) or legacy engines
    // Only self-contained base64 audio data URLs are ever played — anything
    // else (foreign URLs, crafted payloads) is ignored.
    const safe = sanitizeDataUrl(src, 'audio')
    if (safe === null) return
    if (audio === null) {
      const created = new Audio(safe)
      created.loop = true
      created.volume = 0.5
      audioRef.current = created
    }
    return () => {
      audioRef.current?.pause()
    }
  }, [src])

  useEffect(() => {
    const audio = audioRef.current
    if (audio === null) return
    if (active && !muted) void audio.play().catch(() => {})
    else audio.pause()
  }, [active, muted, src])

  const toggle = useCallback(() => { setMuted(value => !value) }, [])
  return useMemo(() => ({ muted, toggle }), [muted, toggle])
}
