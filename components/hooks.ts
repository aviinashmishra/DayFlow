'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { afterWake, soundsLikeStory, stripEnd, wordCount } from '@/lib/voice';
import type { VoiceApi, WakeState } from './ctx';

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Re-renders every `ms` while enabled; returns the current time. */
export function useNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms, enabled]);
  return now;
}

interface SpeechResultLike extends ArrayLike<{ transcript: string }> {
  isFinal?: boolean;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: { results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

// Pause length that ends a tap-to-talk recording. Long enough to think between "next task"s.
const SILENCE_MS = 3500;
// After "Hey Dayflow": a short command ends quickly; a story (or one that is starting) gets room to breathe between sentences.
const WAKE_SHORT_MS = 1400;
const WAKE_STORY_MS = 3200;
const WAKE_INTERIM_EXTRA_MS = 1000;
const WAKE_EMPTY_MS = 7000;
const HARD_MS = 90000;
// Background chatter is dropped (by restarting the session) once it grows past this.
const IDLE_MAX_CHARS = 1500;

/**
 * Joins recognition results into one transcript. Android Chrome and Safari can
 * repeat or grow earlier results ("fix", "fix the bug", "fix the bug next task"),
 * so a result that extends the previous one replaces it and exact repeats are skipped.
 */
export function joinResults(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const t = (results[i][0]?.transcript || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const prev = parts[parts.length - 1];
    const a = t.toLowerCase(), b = prev?.toLowerCase();
    if (b && a.startsWith(b)) parts[parts.length - 1] = t;
    else if (b && b.endsWith(a)) continue;
    else parts.push(t);
  }
  return parts.join(' ');
}

const VOICE_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone is blocked. Allow it from the lock icon in the address bar. Typing still works.',
  'service-not-allowed': 'Microphone is blocked for this page. Allow it in browser settings. Typing still works.',
  'no-speech': 'Didn’t catch anything. Tap the mic and try again.',
  'audio-capture': 'No microphone found. Plug one in or type instead.',
  network: 'The browser speech service is unreachable. Check your connection or type instead.',
  'language-not-supported': 'This speech language is not supported here. Change it in Settings.'
};

type Perm = 'unknown' | 'prompt' | 'granted' | 'denied';

interface Session {
  kind: 'manual' | 'wake';
  /** A wake session sits in 'idle' until it hears "Hey Dayflow", then captures like the mic button. */
  phase: 'idle' | 'capture';
  text: string;
  failed: boolean;
  finishing: boolean;
  heard: boolean;
  startedAt: number;
  /** Set when the mic button is tapped during a wake session: start a manual one when this ends. */
  next: 'manual' | null;
}

/** Two soft notes so you know Dayflow heard its name. Silent when the browser blocks audio. */
function chime() {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const g = ac.createGain();
    g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.32);
    [660, 880].forEach((f, i) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      o.start(ac.currentTime + i * 0.1);
      o.stop(ac.currentTime + 0.32);
    });
    setTimeout(() => void ac.close().catch(() => {}), 600);
  } catch { /* no audio */ }
}

/**
 * Browser speech capture with an optional hands-free mode.
 *
 * Tap-to-talk: live text goes to onText; when speech ends (tap again, or a pause)
 * the full transcript goes to onFinal.
 *
 * Hands-free (`wakeEnabled`): once the microphone is allowed, the page listens for
 * "Hey Dayflow" while it is visible. Only what follows the wake phrase reaches
 * onText/onFinal, and the pause after the last sentence ends it. Nothing heard
 * before the wake phrase is kept. Audio goes to the browser's own speech service;
 * Dayflow never records it.
 */
export function useVoice(lang: string, onText: (t: string) => void, onFinal: (t: string) => void, onStart?: () => void, wakeEnabled = false): VoiceApi {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<VoiceApi['status']>(null);
  const [supported, setSupported] = useState(true);
  const [perm, setPerm] = useState<Perm>('unknown');
  const [visible, setVisible] = useState(true);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const sess = useRef<Session | null>(null);
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hard = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restart = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(0);
  const wantWake = useRef(false);
  const dead = useRef(false);
  const langRef = useRef(lang);
  langRef.current = lang;
  const cb = useRef({ onText, onFinal, onStart });
  cb.current = { onText, onFinal, onStart };

  const Ctor = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  };
  useEffect(() => { setSupported(!!Ctor()); }, []);
  // Declared before the wake effect so a StrictMode remount clears `dead` before that effect runs.
  useEffect(() => {
    dead.current = false;
    return () => {
      dead.current = true;
      wantWake.current = false;
      if (restart.current) clearTimeout(restart.current);
      clearTimers();
      try { rec.current?.abort(); } catch { /* ended */ }
      rec.current = null;
      sess.current = null;
    };
  }, []);

  // Hands-free mode never asks for the microphone by itself. It waits until the browser reports it allowed.
  useEffect(() => {
    let ps: PermissionStatus | null = null;
    let gone = false;
    const on = () => { if (ps) setPerm(ps.state as Perm); };
    navigator.permissions?.query({ name: 'microphone' as PermissionName })
      .then((s) => { if (gone) return; ps = s; on(); s.addEventListener('change', on); })
      .catch(() => { /* Firefox and older Safari: learn it from the first successful start */ });
    return () => { gone = true; ps?.removeEventListener('change', on); };
  }, []);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const clearTimers = () => {
    if (silence.current) clearTimeout(silence.current);
    if (hard.current) clearTimeout(hard.current);
    silence.current = hard.current = null;
  };

  // Ends the current capture. Final words may still arrive; onend hands the text over.
  const finish = useCallback(() => {
    const s = sess.current;
    if (!s || s.phase !== 'capture' || s.finishing) return;
    s.finishing = true;
    clearTimers();
    try { rec.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const begin = useRef<(kind: Session['kind']) => boolean>(() => false);

  const scheduleWake = useCallback((prev?: Session) => {
    if (restart.current) clearTimeout(restart.current);
    restart.current = null;
    if (!wantWake.current || rec.current || dead.current) return;
    // A session that dies at once without hearing anything (offline, service hiccup) backs off up to 30 s.
    if (prev && !prev.heard && Date.now() - prev.startedAt < 2000) backoff.current = Math.min(Math.max(backoff.current * 2, 1000), 30000);
    else backoff.current = 0;
    restart.current = setTimeout(() => {
      restart.current = null;
      if (wantWake.current && !rec.current && !dead.current) begin.current('wake');
    }, Math.max(250, backoff.current));
  }, []);

  begin.current = (kind) => {
    const SR = Ctor();
    if (!SR) {
      if (kind === 'manual') setStatus({ msg: 'Voice capture is not supported in this browser. Use Chrome, Edge or Safari, or just type — it understands the same words.', error: true });
      return false;
    }
    if (rec.current) return false;
    const r = new SR();
    r.lang = langRef.current;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    const s: Session = { kind, phase: kind === 'manual' ? 'capture' : 'idle', text: '', failed: false, finishing: false, heard: false, startedAt: Date.now(), next: null };

    const capture = (wake: boolean) => {
      s.phase = 'capture';
      setListening(true);
      setStatus({ msg: wake ? 'Listening… say a task, or tell me what you did and plan to do. Pause when you’re done.' : 'Listening… Say “next task” between tasks. Tap the mic again when you are done.', error: false });
      cb.current.onStart?.();
      hard.current = setTimeout(finish, HARD_MS);
      if (wake) {
        chime();
        silence.current = setTimeout(finish, WAKE_EMPTY_MS);
      }
    };

    r.onstart = () => {
      if (rec.current !== r) return;
      setPerm('granted'); // the browser let us in, whatever the Permissions API said
      if (s.kind === 'manual') capture(false);
    };
    r.onresult = (e) => {
      if (rec.current !== r) return;
      s.heard = true;
      backoff.current = 0;
      const all = joinResults(e.results);
      let said: string;
      if (s.kind === 'wake') {
        const rest = afterWake(all);
        if (rest === null) {
          if (s.phase === 'idle' && all.length > IDLE_MAX_CHARS) { try { r.abort(); } catch { /* ended */ } }
          return;
        }
        if (s.phase === 'idle') capture(true);
        said = rest;
      } else said = all;

      const { text, ended } = stripEnd(said);
      s.text = text;
      cb.current.onText(text);
      if (s.finishing) return;
      if (ended) { finish(); return; }
      if (silence.current) clearTimeout(silence.current);
      const last = e.results[e.results.length - 1];
      const n = wordCount(text);
      const wait = s.kind === 'manual' ? SILENCE_MS
        : !n ? WAKE_EMPTY_MS
        : (n < 10 && !soundsLikeStory(text) ? WAKE_SHORT_MS : WAKE_STORY_MS) + (last?.isFinal ? 0 : WAKE_INTERIM_EXTRA_MS);
      silence.current = setTimeout(finish, wait);
    };
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      const blocked = e.error === 'not-allowed' || e.error === 'service-not-allowed';
      if (blocked) { setPerm('denied'); wantWake.current = false; }
      // While waiting for the wake phrase, stay quiet: timeouts and hiccups just restart the session.
      if (s.kind === 'wake' && s.phase === 'idle') {
        if (e.error === 'audio-capture' || e.error === 'language-not-supported') wantWake.current = false;
        s.failed = true;
        return;
      }
      s.failed = e.error !== 'no-speech';
      setStatus({ msg: VOICE_ERRORS[e.error] || `Voice error: ${e.error}. Typing still works.`, error: true });
    };
    r.onend = () => {
      if (rec.current === r) rec.current = null;
      if (sess.current === s) sess.current = null;
      if (dead.current) return;
      clearTimers();
      if (s.phase === 'capture') {
        setListening(false);
        if (!s.failed) setStatus(null);
        if (s.text && !s.failed) cb.current.onFinal(s.text);
      }
      if (s.next === 'manual') { begin.current('manual'); return; }
      scheduleWake(s);
    };

    rec.current = r;
    sess.current = s;
    try {
      r.start();
    } catch {
      rec.current = null;
      sess.current = null;
      if (kind === 'manual') setStatus({ msg: 'Could not start the microphone. Try again.', error: true });
      return false;
    }
    return true;
  };

  const start = useCallback(() => {
    const s = sess.current;
    if (s?.phase === 'capture') return;
    if (s?.kind === 'wake') {
      // Hand the microphone over: end the wake session, then start tap-to-talk from its onend.
      s.next = 'manual';
      try { rec.current?.abort(); } catch { /* ended */ }
      return;
    }
    if (restart.current) { clearTimeout(restart.current); restart.current = null; }
    begin.current('manual');
  }, []);

  const stop = useCallback(() => finish(), [finish]);
  const toggle = useCallback(() => (sess.current?.phase === 'capture' ? finish() : start()), [start, finish]);

  // Keep a wake session running while it is wanted; drop an idle one as soon as it is not.
  const wakeOn = wakeEnabled && supported && visible && perm === 'granted';
  useEffect(() => {
    wantWake.current = wakeOn;
    const s = sess.current;
    if (wakeOn) scheduleWake();
    else {
      if (restart.current) { clearTimeout(restart.current); restart.current = null; }
      if (s?.kind === 'wake' && s.phase === 'idle') { try { rec.current?.abort(); } catch { /* ended */ } }
    }
  }, [wakeOn, scheduleWake]);
  // A new speech language takes effect on the next session.
  useEffect(() => {
    const s = sess.current;
    if (s?.kind === 'wake' && s.phase === 'idle') { try { rec.current?.abort(); } catch { /* ended */ } }
  }, [lang]);

  // Turning hands-free on from Settings is a tap, so it may ask for the microphone.
  const armWake = useCallback(() => {
    if (!sess.current && perm !== 'granted') begin.current('wake');
  }, [perm]);
  const note = useCallback((msg: string | null, error = false) => setStatus(msg ? { msg, error } : null), []);

  const wake: WakeState = !wakeEnabled || !supported ? 'off' : perm === 'denied' ? 'blocked' : perm === 'granted' ? 'on' : 'waiting';
  return { supported, listening, status, start, stop, toggle, wake, armWake, note };
}
