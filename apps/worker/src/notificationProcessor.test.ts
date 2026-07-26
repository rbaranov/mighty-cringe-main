import assert from 'node:assert/strict';
import test from 'node:test';

import { PushDeliveryError, type PushSender } from '@mighty-cringe/push';

import {
  NotificationProcessor,
  type NotificationJob,
  type NotificationJobStore,
} from './notificationProcessor.js';

class MemoryNotificationJobs implements NotificationJobStore {
  claimed: NotificationJob | null = {
    id: '86000000-0000-4000-8000-000000000001',
    attempts: 1,
    payload: { title: 'MightyCringe', body: 'Пора тренироваться', url: '/' },
    subscriptions: [
      {
        endpoint: 'https://push.example.test/one',
        expirationTime: null,
        keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(32) },
      },
    ],
  };
  scheduled = 0;
  confirmed: string | null = null;
  failure: { id: string; message: string; retryAt: Date | null } | null = null;
  succeeded: string[] = [];
  failedSubscriptions: Array<{ endpoint: string; expired: boolean }> = [];

  async scheduleDue() {
    return this.scheduled;
  }
  async claim() {
    const job = this.claimed;
    this.claimed = null;
    return job;
  }
  async confirm(id: string) {
    this.confirmed = id;
  }
  async fail(id: string, message: string, retryAt: Date | null) {
    this.failure = { id, message, retryAt };
  }
  async subscriptionSucceeded(endpoint: string) {
    this.succeeded.push(endpoint);
  }
  async subscriptionFailed(endpoint: string, expired: boolean) {
    this.failedSubscriptions.push({ endpoint, expired });
  }
  async close() {}
}

test('confirms a durable notification job after delivery', async () => {
  const jobs = new MemoryNotificationJobs();
  const sender: PushSender = { async send() {} };
  const result = await new NotificationProcessor(jobs, sender).processOne();
  assert.equal(result?.status, 'sent');
  assert.equal(jobs.confirmed, '86000000-0000-4000-8000-000000000001');
  assert.deepEqual(jobs.succeeded, ['https://push.example.test/one']);
});

test('retries transient push failures with exponential backoff', async () => {
  const jobs = new MemoryNotificationJobs();
  const sender: PushSender = {
    async send() {
      throw new PushDeliveryError('rate limited', 429);
    },
  };
  const result = await new NotificationProcessor(
    jobs,
    sender,
    () => new Date('2026-07-22T00:00:00.000Z'),
  ).processOne();
  assert.equal(result?.status, 'pending');
  assert.equal(jobs.failure?.retryAt?.toISOString(), '2026-07-22T00:00:30.000Z');
});

test('disables expired subscriptions without retrying the job', async () => {
  const jobs = new MemoryNotificationJobs();
  const sender: PushSender = {
    async send() {
      throw new PushDeliveryError('gone', 410);
    },
  };
  const result = await new NotificationProcessor(jobs, sender).processOne();
  assert.equal(result?.status, 'sent');
  assert.deepEqual(jobs.failedSubscriptions, [
    { endpoint: 'https://push.example.test/one', expired: true },
  ]);
  assert.equal(jobs.confirmed, '86000000-0000-4000-8000-000000000001');
});
