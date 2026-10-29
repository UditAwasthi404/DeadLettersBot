# Security Audit Notes

**Review date:** 2026-10-29  
**Status:** Partial static review; not a penetration test or release clearance.

## Areas reviewed

- Bearer JWT and API-key authentication in `packages/box-host/src/auth.ts` and `gateway.ts`.
- API-key secret generation, hashing, account binding, and scope enforcement.
- OAuth state/PKCE flow and connector secret encryption.
- Account and bot scoping on memory routes.
- Agent tool catalog and approval enforcement.
- `RunShell` dispatch identity, Docker VM capability restrictions, and namespace entry.
- MCP endpoint validation and outbound request behavior.

## Findings and actions

| Severity | Finding | Status |
| --- | --- | --- |
| Medium | MCP discovery and initialization followed server redirects. A configured public endpoint could redirect requests to an internal target. | Fixed: MCP requests now use manual redirect handling; non-2xx redirects are rejected. |
| Low | OAuth callback state was fetched and deleted in separate Redis operations, allowing concurrent callbacks to race. | Fixed: callback consumes the pending state atomically with Redis `GETDEL`. |
| Medium | Chromium remote-debugging endpoints on account VMs shared the Docker bridge network, allowing sibling VM containers to reach other accounts' browser sessions. | Fixed in code: each account VM now uses its own labeled bridge network, with only the trusted host attached. Docker runtime verification remains outstanding. |
| Medium | MCP hostname checks do not pin DNS results to the outbound connection. A malicious or compromised DNS answer could resolve to a private address or change after validation. | Open: use a resolver-aware egress proxy or transport that validates and pins addresses for each connection. |
| Medium | External web, file, shell, MCP, browser, and connected-service results could be passed to the model without a machine-readable trust boundary; fetched HTML could include hidden or executable markup. | Partially hardened: external results are wrapped with `trust: untrusted_external_data`, system instructions explicitly reject embedded authority, fetched web responses are reduced to bounded text, and browser extraction filters hidden/executable nodes. Regex-based HTML reduction is not a full parser; runtime adversarial testing and complete source review remain open. |
| Low | JWT signing secret rotation and session revocation were initially missing. | Implemented in source: verification accepts `JWT_SECRET_PREVIOUS` during a bounded overlap; each JWT carries an account session version checked against PostgreSQL; `/v1/auth/sessions/revoke` increments that version; `/v1/auth/session` reissues a JWT with the caller's existing API scope. Compose and Helm expose the previous-key setting. Runtime rotation, revocation, and authorization acceptance remain unverified. |
| Informational | API keys are generated with 256 bits of randomness, stored as SHA-256 hashes, account-scoped, and checked for revocation and read/write/admin scope. Only an account session can create an admin key. | Reviewed in source; runtime authorization acceptance remains. |
| Informational | Connector OAuth uses a one-time Redis state key with a ten-minute TTL and PKCE verifier; connector secrets use AES-GCM with a 32-byte environment key. | Key rotation is implemented with a previous-key decrypt window and account-scoped transactional re-encryption of OAuth, MCP, and webhook secrets; concurrency conflicts can be retried. Runtime rotation acceptance remains. |
| Informational | Memory list/edit/delete routes verify account ownership of the bot and filter records by account plus scope. Tool dispatch checks the advertised catalog and approval policy. | Reviewed in source; cross-account penetration checks remain. |
| Medium | Shell commands previously shared the VM container's PID and network namespaces. | Hardened in source: Docker exec runs as the unprivileged `agent` user, the container drops Linux capabilities and disables privilege gain, and `RunShell` enters user, PID, mount/proc, and network namespaces. Runtime namespace and image acceptance remain unverified. |

## Audit limits

The full dependency audit was run on 2026-10-29 after updating vulnerable direct and transitive dependencies; `pnpm audit` reported zero advisories. Direct package versions are pinned and Dependabot checks weekly. This review did not include a running deployment, a complete line-by-line audit of every route and tool, browser renderer assessment, or external penetration test. Do not treat these notes as a security certification. The release audit remains open until the outstanding findings are fixed or accepted and the planned runtime checks are completed.
