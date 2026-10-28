# What reviewers should look for in Post Social

Failure here means a post goes somewhere, or at a time, the user never approved, a customer is charged wrongly, or a customer gets an email they shouldn't.

- Rollbacks: when code undoes a failed change (for example `requeueAsBefore` in backend/lib/publishing/service.ts), check that every table the failed step wrote is put back, not just some of them. A half-restored post that goes back in the queue will publish.
- Emails to customers (backend/lib/nudges.ts): each kind is sent at most once per person, never to someone who unsubscribed, and a new kind needs its name added to `email_nudges`' check in a migration.
- Database changes need a migration in migrations/ and are applied to production by Aki; code must not depend on one before it runs.
