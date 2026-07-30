# Contributing

Guidelines for working on the Palace Elite Membership Manager.

## Stack

- React + TypeScript + Vite
- Supabase (PostgreSQL + Authentication)
- Netlify hosting

## Getting started

1. Install dependencies and set up your local `.env` with Supabase credentials (never commit secrets).
2. Run the app locally and confirm you can sign in and load the Members page before making changes.

## Branching

- `main` is always deployable.
- Work happens on `feature/<short-description>` branches off `main`.
- Open a pull request using the provided template; don't merge directly to `main`.

## Schema changes

- All schema changes must be delivered as Supabase migrations, not applied ad hoc.
- Review every migration for destructive statements (dropped columns/tables, irreversible data loss).
- Member and ownership changes must preserve history — prefer non-destructive state changes (e.g. archive/restore) over deletion.
- Benefit balances must always be derived from the append-only benefit transaction ledger; never store them as an independently editable value.
- Shared and Golf benefit pools must remain modeled and handled separately across schema, services, and UI.

## Code

- Keep the service-layer pattern for Supabase access (see `src/services/`) rather than calling Supabase directly from components.
- Match existing component patterns (`PageHeader`, `SlideOver`) when building new UI.

## Pull requests

- Fill out the PR template, including the schema-change and testing checklists.
- Update `docs/PROJECT_STATUS.md` when a change affects milestone status or scope.

## Secrets

- Credentials and API keys belong in Supabase and Netlify environment configuration, never in the repository.
