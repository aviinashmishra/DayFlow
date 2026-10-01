/*
 * Hands-free voice helpers: the "Hey Dayflow" wake phrase, the phrases that end a
 * recording early, and the check that tells a quick task apart from a story.
 * Pure and dependency-free, so the unit tests can run them directly.
 */
import type { Priority, Status } from './types';

/** One task Gemini found in a spoken story (POST /api/voice/classify). */
export interface StoryTask {
  title: string;
  status: Status;
  priority: Priority;
  due: string | null;
  assignee: string | null;
  tags: string[];
  blockedReason: string | null;
}

// Speech services hear "Dayflow" many ways ("day flow", "they flow", "day flo", "defs").
const WAKE_NAME = "day[\\s-]?flow|dayflo|day[\\s-]?flo|they[\\s-]?flow|the[\\s-]?flow|defs?|deaf";
const WAKE_HELLO = 'hey|hay|hi|hello|ok|okay';
const WAKE_HI = '(?:हे|है|हेलो|ओके)\\s*(?:डे\\s*फ्लो|डेफ्लो|डेफ्स|डेफ)';
const B = '[\\s,.!?।]';
const WAKE = new RegExp(`(?:^|${B})(?:(?:${WAKE_HELLO})${B}+(?:${WAKE_NAME})|${WAKE_HI})(?=$|${B})${B}*`, 'iu');

// Saying one of these ends the recording at once instead of waiting for a pause.
const END = new RegExp(`${B}*(?:that'?s it|that is it|that'?s all|that is all|bas itna(?: hi)?|बस इतना(?: ही)?)${B}*$`, 'iu');

/** Finds the wake phrase. Returns the words spoken after it, or null when it was not said. */
export function afterWake(transcript: string): string | null {
  const m = WAKE.exec(transcript);
  return m ? transcript.slice(m.index + m[0].length).trim() : null;
}

/** Strips a closing "that's it" / "bas itna". `ended` says whether one was there. */
export function stripEnd(text: string): { text: string; ended: boolean } {
  const ended = END.test(text);
  return { text: ended ? text.replace(END, '').trim() : text.trim(), ended };
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// Explicit separators mean the speaker already split the tasks; the local parser handles that.
const SPLIT_WORDS = /(^|\s)(next task|new task|another task|agla task|अगला टास्क)(?=$|[\s,.!?])/i;
// Narrative cues: past/present/future work told as a story, in English or Hinglish.
const STORY_CUES = /(^|\s)(i|i'?ve|i'?m|we|we'?ve|today|yesterday|this morning|then|after that|also|and then|already|finished|completed|working on|going to|gonna|planning|kiya|kar diya|ho gaya|karna hai|kar raha|kal|aaj)(?=$|[\s,.!?])/gi;

/**
 * True when a transcript reads like a story of several pieces of work rather than
 * one task line. Stories go to Gemini to be split and classified; short lines stay
 * with the instant local parser.
 */
export function looksLikeStory(text: string): boolean {
  const t = text.trim();
  if (SPLIT_WORDS.test(t)) return false;
  const words = wordCount(t);
  if (words >= 25) return true;
  if (words < 12) return false;
  const cues = t.match(STORY_CUES)?.length ?? 0;
  const clauses = t.split(/[.!?;]|,\s*(?:and|then|also|but)\s|\s(?:and then|after that|then|also)\s/i).filter((x) => wordCount(x) >= 2).length;
  return cues >= 2 || clauses >= 3;
}
