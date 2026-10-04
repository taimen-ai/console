# Contributing to Taimen Console

Thank you for taking the time to contribute. Taimen is an organizational
runtime in which people, AI agents, workflows and services execute the work
of an organization; the platform is developed in the open under the
Apache License 2.0. This repository holds the **Console** — the web interface of the
runtime: a React SPA and a thin BFF on Hono that signs people in through OIDC and IAM
and talks to the Control Plane and the assistant on their behalf.

## Before you start

- Read the platform
  [guide](https://github.com/taimen-ai/taimen/tree/main/guide/docs) in the umbrella
  repository. Architecture decisions are recorded as ADRs (in Russian, with an English
  title line); English summaries are provided on request in the ADR's discussion.
- Check the open issues before starting a large change. For anything that changes the
  BFF's contract with the Control Plane, IAM or the harness, the session model or the
  set of proxied operations, open an issue first.
- The design system in `design-system/` is the only source of visual decisions: new UI
  uses its tokens and components rather than ad-hoc styles.

## Contributor License Agreement

We require a signed Contributor License Agreement (CLA) for every
contribution, so that the project can be relicensed or defended without
tracking down every author. You sign once for all Taimen repositories.

- Individuals: [`cla/CLA-individual.md`](https://github.com/taimen-ai/taimen/blob/main/cla/CLA-individual.md)
- Companies contributing on behalf of employees: [`cla/CLA-entity.md`](https://github.com/taimen-ai/taimen/blob/main/cla/CLA-entity.md)

The CLA grants the project a copyright and patent licence to your
contribution; you keep your copyright.

## Development setup

The console is a pnpm workspace on Node.js 24 (`.nvmrc`); the pnpm version is pinned by
`packageManager` in `package.json` (`corepack enable` picks it up). It does not need the
rest of the platform: the devstack (`apps/devstack`) fakes the identity provider, IAM,
Control Plane and harness launcher in process.

```bash
pnpm install --frozen-lockfile
pnpm dev                     # console at http://localhost:5173/console/
pnpm check                   # typecheck, lint, unit tests, translation coverage
pnpm e2e                     # end-to-end tests (Playwright) against the devstack
```

## Pull requests

- One logical change per pull request; keep the history linear (rebase, no
  merge commits).
- `pnpm check` must pass; behaviour changes come with tests (unit tests next to the
  code's package, an end-to-end scenario for a new screen or action).
- User-facing strings are written in English with Lingui macros and translated into
  Russian in `apps/web/src/locales/ru/messages.po` (`pnpm --filter @console/web i18n:extract`).
- A new proxied Control Plane operation is added to the explicit allow-list in
  `apps/bff/src/allowlist.ts` and must exist in the `openapi/control-plane.json` snapshot.
- A new production dependency: regenerate `THIRD_PARTY.md` with `pnpm third-party`.
- Commit messages explain *why*, not *what*; reference the issue.
- Do not include secrets, customer data or internal hostnames — test data uses
  fictional names and synthetic identifiers.

## Reporting bugs and security issues

Bugs: open an issue in this repository with the version, steps to reproduce
and logs. Security issues: see [SECURITY.md](SECURITY.md) and do not open a
public issue.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
