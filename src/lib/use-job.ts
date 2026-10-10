'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client-fetch';

export type JobView = { id: string; name: string; status: 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'FAILED'; error: string | null; result: unknown; progress: unknown };

/** Polls a worker job until it completes or fails. */
export function useJob(onDone?: (job: JobView) => void) {
  const [job, setJob] = useState<JobView | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const track = useCallback(
    (jobId: string) => {
      stop();
      const poll = async () => {
        try {
          const r = await api<{ job: JobView }>(`/api/jobs/${jobId}`);
          setJob(r.job);
          if (r.job.status === 'COMPLETED' || r.job.status === 'FAILED') {
            stop();
            doneRef.current?.(r.job);
          }
        } catch {
          stop();
        }
      };
      void poll();
      timer.current = setInterval(poll, 1500);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { job, track, running: !!job && (job.status === 'WAITING' || job.status === 'ACTIVE'), reset: () => setJob(null) };
}
