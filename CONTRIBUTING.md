# Contributing

## Development setup

Install Node.js 22, pnpm 9.15.0, and Bun 1.1 or newer. Run `pnpm install`, then use `pnpm typecheck` and `pnpm lint` before opening a pull request. Local infrastructure services are provided by `infra/docker/docker-compose.yml`.

## Changes

- Keep package dependencies inside the package that uses them.
- Preserve account scoping at every API and storage boundary.
- Add a Drizzle SQL migration and journal entry when changing the schema.
- Treat website, connector, and tool output as untrusted input.
- Keep secrets out of logs, fixtures, and committed environment files.
- Update `docs/BUILD_PLAN.md` only when a deliverable is implemented and locally verifiable.

## Pull requests

Describe the user-visible behavior, affected packages, migration steps, and any environment variables. Include the checks you ran and any known gaps. Avoid bundling unrelated changes.
