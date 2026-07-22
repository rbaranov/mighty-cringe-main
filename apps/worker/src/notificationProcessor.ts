import postgres, { type Sql } from 'postgres';

import type { PushSubscriptionInput } from '@mighty-cringe/contracts';
import {
  nextNotificationAt,
  PushDeliveryError,
  type NotificationPayload,
  type PushSender,
} from '@mighty-cringe/push';

const maximumAttempts = 5;

export type NotificationJob = {
  id: string;
  attempts: number;
  payload: NotificationPayload;
  subscriptions: PushSubscriptionInput[];
};

export interface NotificationJobStore {
  scheduleDue(now: Date, limit?: number): Promise<number>;
  claim(now: Date): Promise<NotificationJob | null>;
  confirm(id: string): Promise<void>;
  fail(id: string, message: string, retryAt: Date | null): Promise<void>;
  subscriptionSucceeded(endpoint: string): Promise<void>;
  subscriptionFailed(endpoint: string, expired: boolean): Promise<void>;
  close(): Promise<void>;
}

type DuePreference = {
  userId: string;
  frequency: 'daily' | 'weekdays' | 'weekly';
  weekday: number;
  reminderTime: string;
  quietStart: string;
  quietEnd: string;
  timeZone: string;
  scheduledFor: Date;
  locale: 'ru' | 'en';
};

type ClaimedJobRow = {
  id: string;
  userId: string;
  attempts: number;
  payload: NotificationPayload;
};

export class PostgresNotificationJobStore implements NotificationJobStore {
  private readonly sql: Sql;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, { max: 2, prepare: false });
  }

  async scheduleDue(now: Date, limit = 50) {
    let scheduled = 0;
    while (scheduled < limit) {
      const created = await this.sql.begin(async (transaction) => {
        const rows = await transaction<DuePreference[]>`
          select
            preferences.user_id as "userId",
            preferences.frequency,
            preferences.weekday,
            preferences.reminder_time as "reminderTime",
            preferences.quiet_start as "quietStart",
            preferences.quiet_end as "quietEnd",
            preferences.time_zone as "timeZone",
            preferences.next_reminder_at as "scheduledFor",
            users.locale
          from notification_preferences as preferences
          inner join users on users.id = preferences.user_id
          where preferences.enabled = true and preferences.next_reminder_at <= ${now}
          order by preferences.next_reminder_at
          for update of preferences skip locked
          limit 1
        `;
        const preference = rows[0];
        if (!preference) return false;
        const nextReminderAt = nextNotificationAt(preference, now);
        await transaction`
          insert into notification_jobs (id, user_id, scheduled_for, payload)
          values (
            gen_random_uuid(),
            ${preference.userId},
            ${preference.scheduledFor},
            ${transaction.json({
              title: 'Mighty & Cringe',
              body:
                preference.locale === 'en'
                  ? 'Time to train. Open your plan and log the result.'
                  : 'Время тренировки. Открой план и зафиксируй результат.',
              url: '/',
            })}
          )
          on conflict (user_id, kind, scheduled_for) do nothing
        `;
        await transaction`
          update notification_preferences
          set next_reminder_at = ${nextReminderAt}, updated_at = now()
          where user_id = ${preference.userId}
        `;
        return true;
      });
      if (!created) break;
      scheduled += 1;
    }
    return scheduled;
  }

  async claim(now: Date) {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<ClaimedJobRow[]>`
        with candidate as (
          select jobs.id
          from notification_jobs as jobs
          inner join notification_preferences as preferences
            on preferences.user_id = jobs.user_id and preferences.enabled = true
          where
            jobs.scheduled_for <= ${now}
            and (
              (jobs.status = 'pending' and (jobs.next_attempt_at is null or jobs.next_attempt_at <= ${now}))
              or (jobs.status = 'processing' and jobs.claimed_at <= ${now} - interval '10 minutes')
            )
          order by coalesce(jobs.next_attempt_at, jobs.scheduled_for), jobs.created_at
          for update of jobs skip locked
          limit 1
        )
        update notification_jobs as jobs
        set
          status = 'processing',
          attempts = jobs.attempts + 1,
          next_attempt_at = null,
          claimed_at = ${now},
          last_error = null,
          updated_at = now()
        from candidate
        where jobs.id = candidate.id
        returning jobs.id, jobs.user_id as "userId", jobs.attempts, jobs.payload
      `;
      const job = rows[0];
      if (!job) return null;
      const subscriptions = await transaction<
        Array<{
          endpoint: string;
          expirationTime: Date | null;
          p256dh: string;
          auth: string;
        }>
      >`
        select
          endpoint,
          expiration_time as "expirationTime",
          p256dh,
          auth
        from push_subscriptions
        where
          user_id = ${job.userId}
          and disabled_at is null
          and (expiration_time is null or expiration_time > ${now})
      `;
      return {
        id: job.id,
        attempts: job.attempts,
        payload: job.payload,
        subscriptions: subscriptions.map((subscription) => ({
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime?.getTime() ?? null,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        })),
      };
    });
  }

  async confirm(id: string) {
    await this.sql`
      update notification_jobs
      set status = 'sent', claimed_at = null, last_error = null, updated_at = now()
      where id = ${id} and status = 'processing'
    `;
  }

  async fail(id: string, message: string, retryAt: Date | null) {
    await this.sql`
      update notification_jobs
      set
        status = ${retryAt ? 'pending' : 'failed'},
        next_attempt_at = ${retryAt},
        claimed_at = null,
        last_error = ${message.slice(0, 2_000)},
        updated_at = now()
      where id = ${id} and status = 'processing'
    `;
  }

  async subscriptionSucceeded(endpoint: string) {
    await this.sql`
      update push_subscriptions
      set failure_count = 0, updated_at = now()
      where endpoint = ${endpoint}
    `;
  }

  async subscriptionFailed(endpoint: string, expired: boolean) {
    await this.sql`
      update push_subscriptions
      set
        failure_count = failure_count + 1,
        disabled_at = case when ${expired} then now() else disabled_at end,
        updated_at = now()
      where endpoint = ${endpoint}
    `;
  }

  async close() {
    await this.sql.end();
  }
}

export class NotificationProcessor {
  constructor(
    private readonly jobs: NotificationJobStore,
    private readonly sender: PushSender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async scheduleDue(limit = 50) {
    return this.jobs.scheduleDue(this.now(), limit);
  }

  async processOne() {
    const job = await this.jobs.claim(this.now());
    if (!job) return null;

    let delivered = 0;
    let permanentFailures = 0;
    const retryableMessages: string[] = [];
    for (const subscription of job.subscriptions) {
      try {
        await this.sender.send(subscription, job.payload);
        await this.jobs.subscriptionSucceeded(subscription.endpoint);
        delivered += 1;
      } catch (error) {
        const deliveryError =
          error instanceof PushDeliveryError
            ? error
            : new PushDeliveryError(
                error instanceof Error ? error.message : 'Unknown push delivery error',
                null,
              );
        await this.jobs.subscriptionFailed(subscription.endpoint, deliveryError.expired);
        if (deliveryError.retryable) retryableMessages.push(deliveryError.message);
        else if (!deliveryError.expired) permanentFailures += 1;
      }
    }

    if (retryableMessages.length && job.attempts < maximumAttempts) {
      const retryAt = this.retryAt(job.attempts);
      await this.jobs.fail(job.id, retryableMessages.join('; '), retryAt);
      return { id: job.id, status: 'pending' as const, attempts: job.attempts, delivered };
    }
    if (permanentFailures > 0 && delivered === 0) {
      await this.jobs.fail(job.id, 'Push provider permanently rejected delivery', null);
      return { id: job.id, status: 'failed' as const, attempts: job.attempts, delivered };
    }

    await this.jobs.confirm(job.id);
    return { id: job.id, status: 'sent' as const, attempts: job.attempts, delivered };
  }

  private retryAt(attempt: number) {
    const delayMs = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
    return new Date(this.now().getTime() + delayMs);
  }
}
