# ADR 0013: Trainer invitations and read-only athlete access

- Status: accepted
- Date: 2026-07-22

## Context

An athlete may deliberately share progress with one trainer, but ordinary account isolation must remain
the default. A share link is a bearer credential and must not be stored in plaintext, returned in roster
responses, or grant access before the athlete signs in with a verified Google account. Revoking access
must affect subsequent reads immediately. A trainer must never gain a mutation path that can silently
change the athlete's workouts, sets, or measurements.

## Decision

Accounts listed in the server-only `TRAINER_EMAILS` setting receive the `trainer` role at Google sign-in.
Trainer, admin, and superadmin roles may open the trainer console. They can create a cryptographically
random invitation valid for seven days, optionally restricted to one normalized Google email. Only the
SHA-256 token hash is stored. The plaintext token is returned once to the trainer and is absent from all
subsequent invitation and roster responses.

The invitee follows `/?trainerInvite=...`. That exact return path survives Google OAuth, after which the
PWA sends the token in a POST body and removes it from the address bar on success. Acceptance is bound
to the signed-in account, checks the optional email restriction, rejects self-linking, consumes the
invite atomically, deactivates any previous trainer link, and creates the single active link allowed by
the database constraint.

Trainer data is exposed only through dedicated GET endpoints for an actively linked athlete. The
existing workout, set, measurement, sync, and voice mutation endpoints continue to derive ownership
exclusively from the trainer's own session and accept no target-athlete parameter. Consequently, a
trainer can still log their own workouts but cannot mutate a linked athlete. Both athlete and trainer
can revoke the link. Link and invitation rows retain minimal timestamps for an audit trail, while every
read rechecks the current active link.

The trainer console displays a roster, invitation status, and read-only workout and measurement history.
It deliberately contains no athlete edit actions. The athlete's Settings screen shows the active trainer
and uses inline confirmation before revocation.

## Consequences

- Sharing is explicit, revocable, limited to one active trainer, and denied by default.
- Email-restricted invitations prevent a forwarded link from being accepted by the wrong Google account.
- A trainer who already saw data cannot be made to forget it, but revocation blocks every later server
  read immediately.
- Production must list approved trainer accounts in `TRAINER_EMAILS`; role administration through a
  superadmin UI remains separate work.
