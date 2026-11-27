# Security Audit Notes

**Review date:** 2026-11-27
**Status:** Partial static review; not a penetration test or release clearance.

## Areas reviewed

- Bearer JWT and API-key authentication in `packages/box-host/src/auth.ts` and `gateway.ts`.
- API-key secret generation, hashing, account binding, and scope enforcement.
- OAuth state/PKCE flow and connector secret encryption.
- Account and bot scoping on memory routes.
- Agent tool catalog and approval enforcement.
- Electron renderer isolation, Content Security Policy, and top-level navigation restrictions.
- `RunShell` dispatch identity, Docker VM capability restrictions, and Landlock filesystem confinement.
- MCP endpoint validation and outbound request behavior.

## Findings and actions

| Severity | Finding | Status |
| --- | --- | --- |
| Medium | MCP discovery and initialization followed server redirects. A configured public endpoint could redirect requests to an internal target. | Fixed: MCP requests now use manual redirect handling; non-2xx redirects are rejected. |
| Low | OAuth callback state was fetched and deleted in separate Redis operations, allowing concurrent callbacks to race. | Fixed: callback consumes the pending state atomically with Redis `GETDEL`. |
| Medium | Chromium remote-debugging endpoints on account VMs shared the Docker bridge network, allowing sibling VM containers to reach other accounts' browser sessions. | Fixed in code: each account VM now uses its own labeled bridge network, with only the trusted host attached. Docker runtime verification remains outstanding. |
| Medium | MCP hostname checks did not pin DNS results to the outbound connection, allowing DNS-rebinding attempts against private addresses; HTTPS loopback endpoints were also accepted. | Fixed in source: each MCP operation resolves once, rejects any private/reserved answer in the full result set, and pins the selected public address for initialization, notification, and tool requests while preserving TLS hostname verification. Plain HTTP loopback is the only local-development exception. DNS and transport acceptance against controlled records remains open; this is not a host-wide egress firewall. |
| Medium | Account VM networks had no configurable outbound-routing kill switch or destination allowlist. | Source implementation now includes per-account Docker helper namespaces for fail-closed CIDR/domain/port filtering. Domain rules refresh through Docker DNS TTLs and reject private/reserved answers; Helm currently supports CIDR/port NetworkPolicy only. Docker engine/account-provisioning and Kubernetes CNI acceptance remain open. |
| Medium | External web, file, shell, MCP, browser, and connected-service results could be passed to the model without a machine-readable trust boundary; fetched HTML could include hidden or executable markup and outbound requests could be exposed to DNS rebinding. | Partially hardened: external results are wrapped with `trust: untrusted_external_data`, system instructions explicitly reject embedded authority, FetchURL classifies IP ranges with ipaddr.js and pins public addresses for each request/redirect, bounds response reads, parses HTML with parse5, and removes hidden/executable elements; browser extraction also filters hidden/executable nodes. Adversarial runtime testing and complete source review remain open. |
| Low | JWT signing secret rotation and session revocation were initially missing. | Implemented in source: verification accepts `JWT_SECRET_PREVIOUS` during a bounded overlap; each JWT carries an account session version checked against PostgreSQL; `/v1/auth/sessions/revoke` increments that version; `/v1/auth/session` reissues a JWT with the caller's existing API scope. Compose and Helm expose the previous-key setting. Runtime rotation, revocation, and authorization acceptance remain unverified. |
| Informational | API keys are generated with 256 bits of randomness, stored as SHA-256 hashes, account-scoped, and checked for revocation and read/write/admin scope. Only an account session can create an admin key. | Reviewed in source; runtime authorization acceptance remains. |
| Informational | Connector OAuth uses a one-time Redis state key with a ten-minute TTL and PKCE verifier; connector secrets use AES-GCM with a 32-byte environment key. | Key rotation is implemented with a previous-key decrypt window and account-scoped transactional re-encryption of OAuth, MCP, and webhook secrets; concurrency conflicts can be retried. Runtime rotation acceptance remains. |
| Informational | Memory list/edit/delete routes verify account ownership of the bot and filter records by account plus scope. Tool dispatch checks the advertised catalog and approval policy. | Reviewed in source; cross-account penetration checks remain. |
| Medium | Shell commands share the VM container's PID namespace and could make outbound network connections. | Network side closed in source via Landlock + nested seccomp (deny IP sockets, connect/bind, io_uring, kill/ptrace family) under `CapDrop: ALL` and `no-new-privileges`. Per-command PID namespaces are **not** used: Docker's default seccomp and the capability-free VM reject nested `unshare`/`CLONE_NEWPID`, and granting short-lived `CAP_SYS_ADMIN` would widen the attack surface. Residual risk is accepted with compensating controls (seccomp signal/trace denial, Landlock without `/proc`, process-group cancel via `agentos-controlled-exec`, `PidsLimit`). Full `RunShell` dispatch acceptance against a live Docker/Kubernetes VM remains open. |
| Medium | File tools rejected `..` path segments but accepted absolute paths outside `/home/agent` and did not resolve symlinks before access. | File operations now use a compiled VM helper that walks parent components with `openat(O_NOFOLLOW)` and performs final opens without following symlinks; writes, appends, deletes, and listings use descriptor-relative operations. The isolated helper probe confirmed normal file operations and rejected symlink/`..` escapes; full API-level and deletion acceptance remains open. |
| Low | Electron top-level navigation used a string prefix check and treated every `file://` URL as internal in packaged mode. | Fixed in source: development navigation must match the exact configured origin and packaged navigation must target the bundled `index.html`; the Vite CSP now explicitly permits only its loopback HMR endpoint during development. Electron runtime navigation and CSP acceptance remain open. |

## Audit limits

The full dependency audit was run on 2026-11-24 after updating vulnerable direct and transitive dependencies; `pnpm audit` reported no known vulnerabilities. Direct package versions are pinned and Dependabot checks weekly. This review did not include a running deployment, a complete line-by-line audit of every route and tool, browser renderer assessment, or external penetration test. Do not treat these notes as a security certification. The release audit remains open until the outstanding findings are fixed or accepted and the planned runtime checks are completed.
