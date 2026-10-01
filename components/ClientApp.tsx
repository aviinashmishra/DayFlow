'use client';
import dynamic from 'next/dynamic';
import type { BoardData } from '@/lib/types';
import { Cube } from './Icons';

export function LoadingShell() {
  return (
    <div className="loading-shell" role="status">
      <Cube />
      <span>Loading your board…</span>
    </div>
  );
}

// The board is client-only: it depends on the viewer's clock, storage and
// browser APIs, so rendering it on the server would only cause hydration drift.
const DayflowApp = dynamic(() => import('./DayflowApp'), { ssr: false, loading: () => <LoadingShell /> });

export default function ClientApp({ initial }: { initial: BoardData }) {
  return <DayflowApp initial={initial} />;
}
