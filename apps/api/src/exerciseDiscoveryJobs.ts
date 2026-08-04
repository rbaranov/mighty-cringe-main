import { randomUUID } from 'node:crypto';

import {
  exerciseDiscoveryPhases,
  type ExerciseDiscoveryJob,
  type ExerciseDiscoveryPhase,
} from '@mighty-cringe/contracts';

import type { ExerciseDiscovery, ExerciseDiscoveryOptions } from './exerciseDiscovery.js';

type MutableJob = ExerciseDiscoveryJob & {
  userId: string;
  controller: AbortController;
  finishedAt: number | null;
};

const retainedJobMs = 15 * 60 * 1_000;
const maximumJobMs = 90 * 1_000;

export class ExerciseDiscoveryJobs {
  private readonly jobs = new Map<string, MutableJob>();

  constructor(
    private readonly discovery: ExerciseDiscovery,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(
    userId: string,
    query: string,
    locale: 'ru' | 'en',
    context?: ExerciseDiscoveryOptions['context'],
  ) {
    this.prune();
    const job: MutableJob = {
      id: randomUUID(),
      userId,
      status: 'running',
      startedAt: this.now().toISOString(),
      phases: exerciseDiscoveryPhases.map((phase) => ({ phase, status: 'pending' })),
      result: null,
      error: null,
      controller: new AbortController(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    void this.run(job, query, locale, context);
    return publicJob(job);
  }

  get(userId: string, jobId: string) {
    this.prune();
    const job = this.jobs.get(jobId);
    return job?.userId === userId ? publicJob(job) : null;
  }

  cancel(userId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) return null;
    if (job.status === 'running') {
      job.status = 'cancelled';
      job.finishedAt = this.now().getTime();
      for (const phase of job.phases) {
        if (phase.status === 'running' || phase.status === 'pending') phase.status = 'skipped';
      }
      job.controller.abort();
    }
    return publicJob(job);
  }

  private async run(
    job: MutableJob,
    query: string,
    locale: 'ru' | 'en',
    context?: ExerciseDiscoveryOptions['context'],
  ) {
    const timeout = setTimeout(() => {
      if (job.status !== 'running') return;
      job.status = 'failed';
      job.error = 'discovery_unavailable';
      job.finishedAt = this.now().getTime();
      for (const phase of job.phases) {
        if (phase.status === 'running') phase.status = 'failed';
        else if (phase.status === 'pending') phase.status = 'skipped';
      }
      job.controller.abort();
    }, maximumJobMs);
    try {
      const result = await this.discovery.discover(query, locale, {
        signal: job.controller.signal,
        context,
        onProgress: (phase, status) => this.updatePhase(job, phase, status),
      });
      if (job.status !== 'running') return;
      job.result = result;
      job.status = 'completed';
      job.finishedAt = this.now().getTime();
    } catch {
      if (job.status === 'cancelled' || job.controller.signal.aborted) return;
      job.controller.abort();
      job.status = 'failed';
      job.error = 'discovery_unavailable';
      job.finishedAt = this.now().getTime();
      for (const phase of job.phases) {
        if (phase.status === 'running') phase.status = 'failed';
        else if (phase.status === 'pending') phase.status = 'skipped';
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private updatePhase(
    job: MutableJob,
    phaseName: ExerciseDiscoveryPhase,
    status: 'running' | 'completed' | 'failed' | 'skipped',
  ) {
    if (job.status !== 'running') return;
    const phase = job.phases.find((item) => item.phase === phaseName);
    if (phase) phase.status = status;
  }

  private prune() {
    const cutoff = this.now().getTime() - retainedJobMs;
    for (const [jobId, job] of this.jobs) {
      if (job.finishedAt !== null && job.finishedAt < cutoff) this.jobs.delete(jobId);
    }
  }
}

function publicJob(job: MutableJob): ExerciseDiscoveryJob {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    phases: job.phases.map((phase) => ({ ...phase })),
    result: job.result,
    error: job.error,
  };
}
