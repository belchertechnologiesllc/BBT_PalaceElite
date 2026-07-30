# Palace Elite Membership Manager Roadmap

This roadmap tracks delivery of the Palace Elite Membership Manager.

## Engineering principles

- React, TypeScript, and Vite for the application.
- Supabase PostgreSQL and Authentication.
- Netlify hosting.
- Feature branches and pull requests; no direct commits to `main`.
- Database schema changes through migrations.
- No passwords, access tokens, service-role keys, or other secrets in source control.
- Complete, immutable benefit transaction and audit history.
- Separate accounting pools:
  - Shared benefits: Belcher, Belcher Sr., and Tatro.
  - Golf benefits: Belcher and Belcher Sr. only.

## 01. Foundation

- [x] React/Vite and TypeScript application foundation.
- [x] Supabase connectivity and authentication foundation.
- [x] Shared layout, navigation, and responsive styling.
- [x] Service-layer pattern between UI and Supabase.
- [x] Initial core schema for people, profiles, ownership units, and unit access.

**Milestone status: Complete**

## 02. Membership Management

- [x] Display members grouped by ownership unit.
- [x] Display member details and benefit-pool eligibility.
- [x] Add Person workflow with validation and Supabase insert.
- [x] Refresh, close SlideOver, and show success notification after save.
- [ ] Edit an existing member.
- [ ] Archive and restore members without deleting history.
- [ ] Search, filter, and sort members.
- [ ] Detect likely duplicate member records.
- [ ] Add optional profile-photo support.

**Milestone status: In progress**

## 03. Ownership Administration

- [ ] Create and edit ownership units.
- [ ] Archive ownership units safely.
- [ ] Reassign members between ownership units with audit history.
- [ ] Validate ownership percentages and pool participation rules.

## 04. Benefit Catalog and Pools

- [ ] Define benefit types, categories, units, rules, availability, and expiration.
- [ ] Implement Shared and Golf pool configuration.
- [ ] Enforce pool participation rules.

## 05. Benefit Transaction Engine

- [ ] Implement an append-only benefit transaction ledger.
- [ ] Support earn, use, adjustment, transfer, correction, and import transactions.
- [ ] Preserve reversal and correction history rather than deleting transactions.
- [ ] Add transaction notes and source references.

## 06. Accounting and Balances

- [ ] Calculate balances from ledger transactions.
- [ ] Keep Shared and Golf accounting independent.
- [ ] Support allocation by owner, family, ownership unit, and pool.
- [ ] Provide historical balance calculations and reconciliation tools.

## 07. Dashboard and Reporting

- [ ] Dashboard with current balances, expirations, recent activity, and quick actions.
- [ ] Member, ownership, benefit-usage, pool-activity, and audit reports.
- [ ] CSV, Excel, and PDF export where appropriate.

## 08. Users, Roles, and Security

- [ ] Define administrator, owner, family member, and read-only roles.
- [ ] Enforce ownership-unit access and least-privilege authorization.
- [ ] Review Supabase Row Level Security policies.
- [ ] Add account-linking administration.

## 09. Audit and Compliance

- [ ] Record actor, timestamp, before/after state, and reason for material changes.
- [ ] Make audit history immutable to normal application users.
- [ ] Provide audit review and export workflows.

## 10. Production Readiness

- [ ] Automated build, type-check, test, and migration validation.
- [ ] Netlify deployment and environment configuration.
- [ ] Backup, recovery, monitoring, and operational runbooks.
- [ ] Security review and secret scanning.
- [ ] User acceptance testing and release checklist.

## Milestone completion standard

A milestone receives a green check only when all required issues are closed, related pull requests are merged, the production build succeeds, migrations are reviewed, acceptance criteria are verified, audit requirements are satisfied, documentation is current, and no secrets have been committed.
