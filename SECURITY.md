# Security Policy

## Supported versions

Taimen is pre-1.0. Security fixes are made on the `main` branch of each
component and included in the next platform release; there are no long-term
support branches yet.

| Platform version | Supported |
|---|---|
| latest `main` / latest `v0.x` tag | yes |
| older tags | no |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub's private vulnerability reporting: open the
**Security** tab of the affected repository and choose **Report a vulnerability**.
If that option is not available to you, open an issue that only says
"security: please contact me" without any details, and a maintainer will reach
out through a private channel. Include in the private report:

- the component and version (tag or commit),
- steps to reproduce or a proof of concept,
- the impact you expect (what an attacker gains),
- whether the issue is already public.

You will get an acknowledgement within 5 business days and a status update at
least every 14 days until the issue is resolved. We ask for coordinated
disclosure: please give us up to 90 days to ship a fix before publishing details.
Credit is given in the release notes unless you prefer to stay anonymous.

## Scope

In scope: the code in this repository, in particular the BFF (`apps/bff`), which is the
security boundary of the console:

- sign-in: OIDC Authorization Code with PKCE (S256) as a confidential client, state and
  nonce checks, the pending login kept in an AES-256-GCM encrypted cookie;
- sessions: the browser holds only an opaque random session id signed with HMAC; the
  identity provider's tokens and the short-lived IAM audience tokens stay in the BFF
  process and never reach the browser; the optional session file is encrypted with
  AES-256-GCM and written with mode `0600`;
- token exchange: the login is exchanged in the IAM Service (`federation:exchange`) for
  audience tokens with an explicit scope ceiling;
- the proxy to the Control Plane and the harness launcher: reads only for
  paths of the bundled OpenAPI snapshot, changes only for an explicit allow-list of
  operations, request and response headers filtered by allow-lists, origin check on every
  change (CSRF), `nosniff` and a sandboxing CSP on proxied responses, body size limits,
  a WebSocket tunnel limited per session;
- people management: calls to the IAM Service with the signed-in person's own token and,
  optionally, to the Keycloak Admin API with the console's dedicated service-account client;
- the assistant's screen context, which the BFF builds itself from Control Plane data and
  never takes from the browser;
- the SPA (`apps/web`), including the rendering of Markdown and documents (sanitized with
  DOMPurify) and the Content Security Policy it is served with.

Out of scope: third-party dependencies (report upstream; tell us if a fix requires a
coordinated update), the identity provider, IAM Service, Control Plane and harness
themselves (report to their repositories), the development stand `apps/devstack` and its
fake services, which are not meant to be exposed, demo data, and deployments run by
third parties.

## Hardening notes for operators

- Serve the console over HTTPS only: secure cookies are enabled when `CONSOLE_PUBLIC_URL`
  is `https://`.
- Keep the cookie secret (at least 32 random bytes), the OIDC client secret and the
  Keycloak admin client secret in files under `secrets/` mounted read-only, never in the
  environment or in Git. Rotating the cookie secret signs everyone out.
- Give the Keycloak admin client (`CONSOLE_IDP_ADMIN=keycloak`) only the
  `realm-management` roles `manage-users`, `view-users` and `query-users`, or leave the
  feature off.
- Expose only the edge proxy; the Control Plane, IAM and launcher addresses of the BFF
  should be internal network addresses.
- Keep `/data/sessions` on a volume readable only by the console's uid `10001`.
