'use client';
import { useMemo, useState } from 'react';
import { confetti, toast } from '@/lib/client/bus';
import { copyText } from '@/lib/client/util';
import { STATUS_NAMES, type OrgTeam, type Task } from '@/lib/types';
import { useDayflow, useStore, useUI } from './ctx';
import { Icon } from './Icons';
import { Modal } from './Overlays';
import { Avatar } from './TaskCard';
import { TEAM_COLORS } from './OrgView';
import './wow.css';

type Step = 'name' | 'bring' | 'done';

/** Personal space → team workspace, in three steps: name it, pick what to share, invite people. */
export function TeamUp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="tuTitle" wide>
      {open && <Wizard onClose={onClose} />}
    </Modal>
  );
}

function Wizard({ onClose }: { onClose: () => void }) {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();
  const first = s.me.name.split(' ')[0];
  const [step, setStep] = useState<Step>('name');
  const [orgName, setOrgName] = useState(s.org.name.replace(/'s space$/, "'s team"));
  const [teamName, setTeamName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[1]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ team: OrgTeam; inviteCode: string; moved: number } | null>(null);

  // Starter cards are about learning the app, so they are not offered for sharing.
  const shareable = useMemo(() => s.tasks.filter((t) => t.private && !t.tags.includes('start')).sort((a, b) => a.status - b.status || a.position - b.position), [s.tasks]);
  const open = shareable.filter((t) => t.status !== 4);
  const team = teamName.trim() || 'Your team';

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) { setError('Name your workspace.'); return; }
    if (!teamName.trim()) { setError('Name your first team.'); return; }
    setError('');
    setStep('bring');
  };

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await store.teamUp({ orgName: orgName.trim(), team: { name: teamName.trim(), description: description.trim() || null, color }, taskIds: [...picked] });
      setResult(res);
      setStep('done');
      setTimeout(() => confetti(innerWidth / 2, innerHeight / 3, 180), 120);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="tu">
      <header className="panel-head">
        <div>
          <p className="eyebrow tu-steps" aria-label={`Step ${step === 'name' ? 1 : step === 'bring' ? 2 : 3} of 3`}>
            {(['name', 'bring', 'done'] as Step[]).map((k, i) => <span key={k} className={k === step ? 'on' : ''}>{i + 1}</span>)}
          </p>
          <h2 id="tuTitle">{step === 'name' ? 'Start a team' : step === 'bring' ? 'Bring tasks along?' : `${result?.team.name ?? team} is live`}</h2>
        </div>
        <button className="icon-btn" data-cancel aria-label="Close" onClick={onClose}><Icon name="i-x" /></button>
      </header>

      {step === 'name' && (
        <form className="tu-grid" onSubmit={next}>
          <div className="tu-form">
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div>
              <label className="field-label" htmlFor="tuOrg">Workspace name</label>
              <input id="tuOrg" className="field" maxLength={80} value={orgName} onChange={(e) => setOrgName(e.target.value)} data-autofocus />
              <p className="field-hint">Your company, club or household. You can rename it later.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="tuTeam">First team</label>
              <input id="tuTeam" className="field" maxLength={60} placeholder="e.g. Design, Family, Launch crew" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="tuDesc">What it works on <span className="muted">(optional)</span></label>
              <input id="tuDesc" className="field" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <span className="field-label">Color</span>
              <div className="swatches" role="radiogroup" aria-label="Team color">
                {TEAM_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className="swatch" style={{ background: c }} onClick={() => setColor(c)} />)}
              </div>
            </div>
            <p className="tu-note"><Icon name="i-lock" />Everything you have now stays private. You pick what to share on the next step.</p>
            <div className="modal-actions"><button className="btn btn-3d btn-primary">Next<Icon name="i-arrow" /></button></div>
          </div>

          <div className="tu-stage" aria-hidden="true">
            <div className="tu-card" style={{ ['--tc' as string]: color }}>
              <span className="tu-card-org">{orgName.trim() || 'Workspace'}</span>
              <div className="tu-card-team"><i className="team-dot" style={{ background: color }} />{team}</div>
              {description.trim() && <p className="tu-card-desc">{description.trim()}</p>}
              <div className="tu-card-bar">{[3, 2, 1, 1, 2].map((n, i) => <i key={i} style={{ flexGrow: n, background: `var(--st${i})` }} />)}</div>
              <div className="tu-card-people">
                <Avatar name={s.me.name} cls="xs" />
                {[0, 1, 2].map((i) => <span key={i} className="tu-ghost"><Icon name="i-plus" /></span>)}
                <span className="muted">{first} leads</span>
              </div>
            </div>
            <div className="tu-orbit"><i /><i /><i /></div>
          </div>
        </form>
      )}

      {step === 'bring' && (
        <div className="tu-bring">
          {error && <div className="auth-error" role="alert">{error}</div>}
          <p className="muted">Everything in your space is private. Tick what the <b style={{ color: 'var(--text)' }}>{team}</b> team should see. The rest stays yours alone, under <b style={{ color: 'var(--text)' }}>Personal</b>.</p>
          {shareable.length > 0 ? (
            <>
              <div className="seg" role="group" aria-label="Quick pick">
                <button type="button" aria-pressed={picked.size === 0} onClick={() => setPicked(new Set())}>Keep all private</button>
                <button type="button" aria-pressed={open.length > 0 && picked.size === open.length && open.every((t) => picked.has(t.id))} onClick={() => setPicked(new Set(open.map((t) => t.id)))}>All open ({open.length})</button>
                <button type="button" aria-pressed={picked.size === shareable.length} onClick={() => setPicked(new Set(shareable.map((t) => t.id)))}>Everything ({shareable.length})</button>
              </div>
              <ul className="tu-list">
                {shareable.map((t) => <PickRow key={t.id} t={t} on={picked.has(t.id)} toggle={toggle} />)}
              </ul>
            </>
          ) : <p className="empty-note muted">No tasks of your own yet, apart from the getting-started cards. Nothing to move.</p>}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setStep('name')} disabled={busy}>Back</button>
            <button className="btn btn-3d btn-primary" onClick={create} disabled={busy}>
              {busy ? 'Creating…' : <>Create {team}{picked.size ? ` with ${picked.size} ${picked.size === 1 ? 'task' : 'tasks'}` : ''}</>}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && <Invite result={result} onClose={onClose} openBoard={() => { ui.setBoardTeam(result.team.id); ui.setView('board'); onClose(); }} />}
    </div>
  );
}

function PickRow({ t, on, toggle }: { t: Task; on: boolean; toggle: (id: string) => void }) {
  return (
    <li>
      <label className={`tu-pick${on ? ' on' : ''}`}>
        <input type="checkbox" checked={on} onChange={() => toggle(t.id)} />
        <Icon name={`s${t.status}`} style={{ color: `var(--st${t.status})` }} />
        <span className="tu-pick-title">{t.title}</span>
        <span className="muted tu-pick-st">{STATUS_NAMES[t.status]}</span>
      </label>
    </li>
  );
}

function Invite({ result, onClose, openBoard }: { result: { team: OrgTeam; inviteCode: string; moved: number }; onClose: () => void; openBoard: () => void }) {
  const link = `${location.origin}/signup?invite=${result.inviteCode}&team=${result.team.id}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="tu-done">
      <div className="tu-burst" style={{ ['--tc' as string]: result.team.color }} aria-hidden="true"><Icon name="i-users" /></div>
      <p className="muted">
        You lead <b style={{ color: 'var(--text)' }}>{result.team.name}</b>.{result.moved ? ` ${result.moved} ${result.moved === 1 ? 'task is' : 'tasks are'} now shared with it.` : ''} Send this link to anyone who should join. They land straight in the team.
      </p>
      <div className="tu-link">
        <input className="field" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn-3d btn-primary" data-autofocus onClick={async () => toast((await copyText(link)) ? 'Invite link copied' : 'Select the link and copy it', { icon: 'i-user-plus' })}>
          <Icon name="i-copy" /><span>Copy</span>
        </button>
        {canShare && (
          <button className="btn btn-ghost" onClick={() => navigator.share({ title: `Join ${result.team.name} on Dayflow`, url: link }).catch(() => {})}><Icon name="i-send" /><span>Share</span></button>
        )}
      </div>
      <p className="tu-code">or share the code <b>{result.inviteCode.split('').map((c, i) => <span key={i}>{c}</span>)}</b></p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Invite later</button>
        <button className="btn btn-3d btn-primary" onClick={openBoard}>Open the {result.team.name} board</button>
      </div>
    </div>
  );
}
