'use client';
import { useEffect, useRef, useState } from 'react';
import type { DayOrb, OrbTask } from '@/lib/client/orb';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export function statusColors(): string[] {
  const cs = getComputedStyle(document.documentElement);
  return [0, 1, 2, 3, 4].map((i) => cs.getPropertyValue(`--st${i}`).trim() || '#888888');
}

/** Three.js Day Orb with an SVG ring fallback when WebGL is unavailable. */
export function Orb({ tasks, progress, focusId, reduced, dark }: { tasks: OrbTask[]; progress: number; focusId: string | null; reduced: boolean; dark: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const orb = useRef<DayOrb | null>(null);
  const latest = useRef({ tasks, progress, focusId });
  latest.current = { tasks, progress, focusId };
  const [webgl, setWebgl] = useState(true);
  const pct = Math.round(progress * 100);

  useEffect(() => {
    let disposed = false;
    if (!webglAvailable()) { setWebgl(false); return; }
    (async () => {
      try {
        const [THREE, mod] = await Promise.all([import('three'), import('@/lib/client/orb')]);
        if (disposed || !canvas.current) return;
        orb.current = new mod.DayOrb(THREE, canvas.current, { reduced, colors: statusColors() });
        const l = latest.current;
        orb.current.update(l.tasks, l.progress, l.focusId);
      } catch {
        setWebgl(false);
      }
    })();
    return () => { disposed = true; orb.current?.dispose(); orb.current = null; };
    // Init once; later changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { orb.current?.update(tasks, progress, focusId); }, [tasks, progress, focusId]);
  useEffect(() => { orb.current?.setReduced(reduced); }, [reduced]);
  // Theme is applied by the parent after this effect runs, so read colors next frame.
  useEffect(() => { const r = requestAnimationFrame(() => orb.current?.setColors(statusColors())); return () => cancelAnimationFrame(r); }, [dark]);

  return (
    <div className="orb-stage">
      {webgl ? <canvas id="orb" ref={canvas} aria-hidden="true" /> : (
        <svg className="orb-fallback" viewBox="0 0 120 120" aria-hidden="true" style={{ display: 'block' }}>
          <circle cx="60" cy="60" r="50" className="ring-track" />
          <circle cx="60" cy="60" r="50" className="ring-fill" style={{ strokeDashoffset: 314.16 * (1 - progress) }} />
        </svg>
      )}
      <div className="orb-center" role="img" aria-label={`Day progress ${pct} percent, weighted by status level`}>
        <span className="pct">{pct}<small>%</small></span>
        <span className="pct-label">of today</span>
      </div>
    </div>
  );
}
