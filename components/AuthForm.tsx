'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Cube, Icon } from './Icons';

export type SignupMode = 'personal' | 'org' | 'join';

const MODES: Array<{ key: SignupMode; icon: string; title: string; sub: string }> = [
  { key: 'personal', icon: 'i-user', title: 'Just me', sub: 'A private space for your own tasks. Add a team any time.' },
  { key: 'org', icon: 'i-org', title: 'My team or company', sub: 'Teams, leads, invites and a company dashboard.' },
  { key: 'join', icon: 'i-user-plus', title: 'I have an invite', sub: 'Join with the code or link you were sent.' }
];

const COPY: Record<SignupMode, { h1: string; lead: string; cta: string; points: Array<[string, string]> }> = {
  personal: {
    h1: 'Your day, in one flow',
    lead: 'Capture tasks by voice or typing, focus on one at a time, and see your progress grow.',
    cta: 'Create my space',
    points: [
      ['i-lock', 'Private by default: only you see your tasks'],
      ['i-mic', 'Say several tasks in one breath: “next task” between them'],
      ['i-users', 'Ready to share? Create a team and pick what it sees']
    ]
  },
  org: {
    h1: 'Set up your organization',
    lead: 'One place for every team to plan, track and report daily work, by voice or by typing.',
    cta: 'Create organization',
    points: [
      ['i-mic', 'Add several tasks in one breath: say “next task” between them'],
      ['s2', 'Teams, leads and a company dashboard: blocked work surfaces on its own'],
      ['i-copy', 'Standup and weekly report in one click']
    ]
  },
  join: {
    h1: 'Join your organization',
    lead: 'Your team is already waiting. Use the invite code or link your admin sent you.',
    cta: 'Join organization',
    points: [
      ['i-bell', 'Get told when work is assigned to you or needs your review'],
      ['i-lock', 'Keep a private list of your own next to the team board']
    ]
  }
};

/** Rough strength: length plus variety. Just a nudge; the server only requires 8 characters. */
function strength(p: string): number {
  if (!p) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((r) => r.test(p)).length;
  return Math.min(4, (p.length >= 8 ? 1 : 0) + (p.length >= 12 ? 1 : 0) + (p.length >= 16 ? 1 : 0) + (variety >= 3 ? 1 : 0));
}
const STRENGTH = ['Too short', 'Okay', 'Good', 'Strong', 'Excellent'];

export function AuthForm({ mode, invite, teamId, start }: { mode: 'login' | 'signup'; invite?: string; teamId?: string; start?: SignupMode }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<SignupMode>(invite ? 'join' : start ?? 'personal');
  const [orgName, setOrgName] = useState('');
  const [firstTeam, setFirstTeam] = useState('');
  const [code, setCode] = useState(invite || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const copy = COPY[kind];
  const pw = strength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (signup) {
        await api('POST', '/api/auth/signup', {
          name, email, password,
          ...(kind === 'join' ? { inviteCode: code, teamId: teamId || undefined }
            : kind === 'personal' ? { mode: 'personal' }
            : { mode: 'org', orgName: orgName || undefined, firstTeam: firstTeam || undefined })
        });
      } else {
        await api('POST', '/api/auth/login', { email, password });
      }
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <div className={`auth-card glass${signup ? ' is-signup' : ''}`}>
        <div className="auth-brand"><Cube /><b>Dayflow</b></div>
        <div>
          <h1 key={signup ? kind : 'login'} className="auth-h1">{signup ? copy.h1 : 'Welcome back'}</h1>
          <p className="lead">{signup ? copy.lead : 'Sign in to your space or organization.'}</p>
        </div>
        {signup && (
          <div className="auth-modes" role="radiogroup" aria-label="Account type">
            {MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={kind === m.key} className="auth-mode" onClick={() => { setKind(m.key); setError(''); }}>
                <span className="auth-mode-ico"><Icon name={m.icon} /></span>
                <b>{m.title}</b>
                <span>{m.sub}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} noValidate={false}>
          {error && <div className="auth-error" role="alert">{error}</div>}
          {signup && (
            <div>
              <label className="field-label" htmlFor="name">Your name</label>
              <input id="name" className="field" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="email">{signup && kind === 'personal' ? 'Email' : 'Work email'}</label>
            <input id="email" className="field" type="email" autoComplete="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="password">Password</label>
            <input id="password" className="field" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : 1} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={signup ? 'pwHint' : undefined} />
            {signup && (
              <div className="pw-meter" data-level={pw} id="pwHint">
                <span className="pw-bars" aria-hidden="true"><i /><i /><i /><i /></span>
                <span>{password ? STRENGTH[pw] : 'At least 8 characters. A short sentence works well.'}</span>
              </div>
            )}
          </div>
          {signup && kind === 'org' && (
            <>
              <div>
                <label className="field-label" htmlFor="org">Organization name</label>
                <input id="org" className="field" maxLength={80} placeholder="e.g. Acme Inc." value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="team">Your first team</label>
                <input id="team" className="field" maxLength={60} placeholder="e.g. Product (you can add more later)" value={firstTeam} onChange={(e) => setFirstTeam(e.target.value)} />
                <p className="field-hint">You become the owner and lead of this team. Invite people and add teams from the Organization page.</p>
              </div>
            </>
          )}
          {signup && kind === 'join' && (
            <div>
              <label className="field-label" htmlFor="code">Invite code</label>
              <input id="code" className="field" required maxLength={20} style={{ textTransform: 'uppercase', letterSpacing: '.12em', fontFamily: 'var(--mono)' }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
          )}
          <button className="btn btn-3d btn-primary" disabled={busy}>
            {busy ? 'One moment…' : signup ? copy.cta : 'Sign in'}
          </button>
        </form>
        {signup && (
          <ul className="auth-points" key={kind}>
            {copy.points.map(([icon, text]) => <li key={text}><Icon name={icon} />{text}</li>)}
          </ul>
        )}
        <p className="auth-foot">
          {signup ? <>Already have an account? <Link href="/login">Sign in</Link></> : <>New here? <Link href="/signup">Create an account</Link></>}
        </p>
      </div>
    </main>
  );
}
