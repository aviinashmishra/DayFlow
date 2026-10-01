'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fileKind, fmtBytes, isImage, linkHost, normalizeUrl, relTime } from '@/lib/client/util';
import { ATTACH_MAX_BYTES, type Attachment, type TaskLink } from '@/lib/types';
import { Icon } from './Icons';
// Styles for My tasks, the full task form and attachments (every user of them imports this module).
import './mytasks.css';

// ---------------------------------------------------------------- links
export function LinksEditor({ links, onChange, idPrefix }: { links: TaskLink[]; onChange: (next: TaskLink[]) => void; idPrefix: string }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const href = normalizeUrl(url);
    if (!href) { setError(url.trim() ? 'That does not look like a web address.' : 'Paste a link first.'); urlRef.current?.focus(); return; }
    if (links.some((l) => l.url === href)) { setError('That link is already added.'); return; }
    if (links.length >= 20) { setError('Up to 20 links per task.'); return; }
    onChange([...links, { url: href, label: label.trim().slice(0, 120) }]);
    setUrl(''); setLabel(''); setError('');
    urlRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };

  return (
    <div className="links-editor">
      {links.length > 0 && (
        <ul className="link-list">
          {links.map((l, i) => <LinkRow key={l.url} link={l} onRemove={() => onChange(links.filter((_, j) => j !== i))} />)}
        </ul>
      )}
      <div className="link-add">
        <label className="sr-only" htmlFor={`${idPrefix}-url`}>Link address</label>
        <div className="input-ico">
          <Icon name="i-link" />
          <input ref={urlRef} id={`${idPrefix}-url`} className="field" inputMode="url" placeholder="Paste a link: figma.com/file/…" value={url}
            onChange={(e) => { setUrl(e.target.value); setError(''); }} onKeyDown={onKey} />
        </div>
        <label className="sr-only" htmlFor={`${idPrefix}-label`}>Link name (optional)</label>
        <input id={`${idPrefix}-label`} className="field link-label-in" placeholder="Name (optional)" maxLength={120} value={label}
          onChange={(e) => setLabel(e.target.value)} onKeyDown={onKey} />
        <button type="button" className="btn btn-ghost" onClick={add}><Icon name="i-plus" />Add</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function LinkRow({ link, onRemove }: { link: TaskLink; onRemove?: () => void }) {
  const host = linkHost(link.url);
  return (
    <li className="link-row">
      <span className="link-fav" aria-hidden="true">{host.charAt(0).toUpperCase()}</span>
      <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="link-main">
        <b>{link.label || host}</b>
        <small>{link.label ? host : link.url.replace(/^https?:\/\//, '').slice(0, 80)}</small>
      </a>
      <Icon name="i-external" className="link-ext" />
      {onRemove && <button type="button" className="icon-btn sm danger" aria-label={`Remove link ${link.label || host}`} onClick={onRemove}><Icon name="i-x" /></button>}
    </li>
  );
}

// ---------------------------------------------------------------- file picking
export function FileDrop({ onFiles, busy, compact }: { onFiles: (files: File[]) => void; busy?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => { if (list?.length) onFiles(Array.from(list)); };
  return (
    <div
      className={`drop${over ? ' over' : ''}${compact ? ' compact' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      <span className="drop-ico"><Icon name={busy ? 'i-clock' : 'i-upload'} /></span>
      <div className="drop-text">
        <b>{busy ? 'Uploading…' : compact ? 'Add files' : 'Drop files here'}</b>
        <small>{compact ? `Up to ${ATTACH_MAX_BYTES / 1024 / 1024} MB each` : <>or <button type="button" className="link-btn inline" onClick={() => input.current?.click()}>browse</button> · images, PDFs, docs up to {ATTACH_MAX_BYTES / 1024 / 1024} MB each</>}</small>
      </div>
      {compact && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => input.current?.click()}><Icon name="i-clip" />Choose</button>}
    </div>
  );
}

/** Files picked in the new-task form, before they are uploaded. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const previews = useMemo(() => files.map((f) => (isImage(f.type) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  if (!files.length) return null;
  return (
    <ul className="file-grid">
      {files.map((f, i) => {
        const tooBig = f.size > ATTACH_MAX_BYTES;
        return (
          <li key={`${f.name}-${f.size}-${i}`} className={`file-tile${tooBig ? ' bad' : ''}`}>
            <Thumb src={previews[i]} name={f.name} mime={f.type} />
            <div className="file-meta">
              <b title={f.name}>{f.name}</b>
              <small>{tooBig ? `Too large (${fmtBytes(f.size)})` : fmtBytes(f.size)}</small>
            </div>
            <button type="button" className="icon-btn sm danger" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}><Icon name="i-x" /></button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- saved attachments
export function AttachmentList({ taskId, items, canRemove, onRemove }: {
  taskId: string;
  items: Attachment[];
  canRemove: (a: Attachment) => boolean;
  onRemove: (a: Attachment) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="file-grid">
      {items.map((a) => {
        const href = `/api/tasks/${taskId}/attachments/${a.id}`;
        const img = isImage(a.mime);
        return (
          <li key={a.id} className="file-tile">
            <a href={img ? href : `${href}?download=1`} target={img ? '_blank' : undefined} rel="noopener noreferrer" className="thumb-link" aria-label={img ? `Open ${a.name}` : `Download ${a.name}`}>
              <Thumb src={img ? href : null} name={a.name} mime={a.mime} />
            </a>
            <div className="file-meta">
              <b title={a.name}>{a.name}</b>
              <small>{fmtBytes(a.size)} · {a.uploaderName.split(' ')[0]} · {relTime(a.createdAt)}</small>
            </div>
            <a className="icon-btn sm" href={`${href}?download=1`} aria-label={`Download ${a.name}`} title="Download"><Icon name="i-download" /></a>
            {canRemove(a) && <button type="button" className="icon-btn sm danger" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => onRemove(a)}><Icon name="i-trash" /></button>}
          </li>
        );
      })}
    </ul>
  );
}

function Thumb({ src, name, mime }: { src: string | null; name: string; mime: string }) {
  if (src) return <span className="thumb img">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt="" loading="lazy" /></span>;
  const kind = fileKind(name, mime);
  return <span className="thumb" data-kind={kind}><Icon name="i-file" /><i>{kind}</i></span>;
}
