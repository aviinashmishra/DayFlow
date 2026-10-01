import type { CSSProperties } from 'react';

export function Icon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** One inline sprite for every icon; status glyphs carry meaning by shape so status is never color alone. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-mic" viewBox="0 0 24 24"><path {...S} d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path {...S} strokeWidth={2.4} d="M12 5v14M5 12h14" /></symbol>
        <symbol id="i-play" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" /></symbol>
        <symbol id="i-pause" viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></symbol>
        <symbol id="i-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24"><g {...S}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" /></g></symbol>
        <symbol id="i-gear" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></g></symbol>
        <symbol id="i-moon" viewBox="0 0 24 24"><path {...S} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></symbol>
        <symbol id="i-sun" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g></symbol>
        <symbol id="i-board" viewBox="0 0 24 24"><g {...S}><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></g></symbol>
        <symbol id="i-chart" viewBox="0 0 24 24"><path {...S} d="M4 20h16M7 16v-5M12 16V6M17 16v-8" /></symbol>
        <symbol id="i-help" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></g></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path {...S} strokeWidth={2.2} d="M6 6l12 12M18 6L6 18" /></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24"><path {...S} d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></g></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24"><g {...S}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></g></symbol>
        <symbol id="i-flame" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2s1 3.5-1.5 6C8 10.5 6 12.5 6 15.5A6 6 0 0 0 18 15.5c0-2.4-1.2-4.2-2.2-5.2.2 1.7-.6 3-1.8 3.5.6-3.6-.8-8.3-2-11.8z" /></symbol>
        <symbol id="i-bolt" viewBox="0 0 24 24"><path fill="currentColor" d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></symbol>
        <symbol id="i-comment" viewBox="0 0 24 24"><path {...S} d="M4 5h16v11H9l-5 4z" /></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><g {...S} strokeWidth={2.2}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></g></symbol>
        <symbol id="i-undo" viewBox="0 0 24 24"><path {...S} d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></symbol>
        <symbol id="i-send" viewBox="0 0 24 24"><path {...S} d="M21 3 3 10.5l7 2.5 2.5 7z" /></symbol>
        <symbol id="i-sparkle" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></symbol>
        <symbol id="i-mail" viewBox="0 0 24 24"><g {...S}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 6.5 8.5 7 8.5-7" /></g></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><g {...S}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20" /></g></symbol>
        <symbol id="i-logout" viewBox="0 0 24 24"><path {...S} d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path {...S} strokeWidth={2.4} d="m5 12.5 4.5 4.5L19 7.5" /></symbol>
        <symbol id="i-clip" viewBox="0 0 24 24"><path {...S} d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></symbol>
        <symbol id="i-link" viewBox="0 0 24 24"><path {...S} d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1" /></symbol>
        <symbol id="i-file" viewBox="0 0 24 24"><g {...S}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></g></symbol>
        <symbol id="i-download" viewBox="0 0 24 24"><path {...S} d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></symbol>
        <symbol id="i-upload" viewBox="0 0 24 24"><path {...S} d="M12 16V5M7 9.5l5-5 5 5M5 20h14" /></symbol>
        <symbol id="i-note" viewBox="0 0 24 24"><g {...S}><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8.5 12.5h7M8.5 16h4.5" /></g></symbol>
        <symbol id="i-text" viewBox="0 0 24 24"><path {...S} d="M4 6h16M4 10.5h16M4 15h10M4 19.5h7" /></symbol>
        <symbol id="i-list" viewBox="0 0 24 24"><g {...S}><path d="m4 6.5 1.5 1.5L8 5.5M4 12.5 5.5 14 8 11.5M4 18.5 5.5 20 8 17.5" /><path d="M11 7h9M11 13h9M11 19h9" /></g></symbol>
        <symbol id="i-external" viewBox="0 0 24 24"><path {...S} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></symbol>
        <symbol id="i-user" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></g></symbol>
        <symbol id="i-flag" viewBox="0 0 24 24"><path {...S} d="M5 21V4M5 4h11l-2 4 2 4H5" /></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path {...S} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><g {...S}><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M3.5 14.8h17M9.5 9.5V20" /></g></symbol>
        <symbol id="i-tag" viewBox="0 0 24 24"><g {...S}><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.3" /></g></symbol>
        <symbol id="i-org" viewBox="0 0 24 24"><g {...S}><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 9h5a1 1 0 0 1 1 1v11M2.5 21h19M8 8h2M8 12h2M8 16h2M17 13h.01M17 17h.01" /></g></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><g {...S}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" /></g></symbol>
        <symbol id="i-user-plus" viewBox="0 0 24 24"><g {...S}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></g></symbol>
        <symbol id="i-history" viewBox="0 0 24 24"><g {...S}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4M12 8v4l3 2" /></g></symbol>
        <symbol id="i-at" viewBox="0 0 24 24"><g {...S}><circle cx="12" cy="12" r="3.5" /><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9" /></g></symbol>
        <symbol id="i-edit" viewBox="0 0 24 24"><g {...S}><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></g></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><g {...S}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2" /></g></symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24"><path {...S} d="M5 12h14M13 6l6 6-6 6" /></symbol>
        <symbol id="i-command" viewBox="0 0 24 24"><path {...S} d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0v11m0-11h6m-6 11A2.5 2.5 0 1 1 6.5 15H9zm0 0h6m0-11A2.5 2.5 0 1 1 17.5 9H15zm0 0v11m0 0a2.5 2.5 0 1 0 2.5-2.5H15" /></symbol>
        <symbol id="s0" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth={2.4} strokeDasharray="3 3" /></symbol>
        <symbol id="s1" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth={2.4} /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></symbol>
        <symbol id="s2" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth={2.4}><circle cx="12" cy="12" r="8" /><path d="M6.5 17.5l11-11" /></g></symbol>
        <symbol id="s3" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" fill="currentColor" /></g></symbol>
        <symbol id="s4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" /><path d="m7.8 12.3 2.8 2.8 5.6-5.8" fill="none" stroke="var(--on-status, #fff)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></symbol>
      </defs>
    </svg>
  );
}

export function Cube() {
  return (
    <div className="cube" aria-hidden="true">
      <span className="f f1" /><span className="f f2" /><span className="f f3" /><span className="f f4" /><span className="f f5" /><span className="f f6" />
    </div>
  );
}

export function Background() {
  return (
    <div className="bg" aria-hidden="true">
      <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
      <div className="grid-floor" />
    </div>
  );
}
