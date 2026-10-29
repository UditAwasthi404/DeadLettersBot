# Manual security review checklist

Run only against an isolated development deployment with test accounts and disposable data. These checks are a review plan, not evidence that the controls have passed. Record the build revision, setup, expected result, observed result, and any issue for each item.

## Authentication and authorization

- [ ] Modify JWT payload/signature and confirm protected routes reject it.
- [ ] Rotate `JWT_SECRET` with the former key in `JWT_SECRET_PREVIOUS`; confirm valid existing sessions still work only during the overlap, then remove the previous key and confirm it is rejected.
- [ ] Revoke account sessions and confirm existing JWTs fail while individually scoped API keys retain only their documented access.
- [ ] Use read-only, read-write, and admin API keys against read, write, and administrative routes; confirm scope violations are rejected.
- [ ] Use two accounts and two bots to try reading or modifying each other's turns, memory, skills, routines, connector records, webhook deliveries, and subagent results.

## Tools and external content

- [ ] Request an unadvertised tool and a tool disallowed by the bot policy; confirm neither executes.
- [ ] Deny an approval and confirm the action does not run; interrupt a long shell command and confirm its process group exits.
- [ ] Serve a web page containing hidden text, script instructions, prompt-injection text, and oversized content; confirm extraction is bounded and no embedded instruction gains authority.
- [ ] Configure an MCP endpoint that redirects to another host and confirm redirects are rejected. Separately test DNS rebinding/private-address resolution; DNS pinning is currently an open finding.
- [ ] Attempt path traversal and symlink escape through file tools in a disposable VM; confirm access stays within the permitted workspace.
- [ ] Inspect browser rendering and desktop UI for stored/reflected XSS using harmless test payloads.

## Secrets, connectors, and recovery

- [ ] Confirm connector tokens and webhook secrets are encrypted at rest and are not returned by list/read APIs.
- [ ] Rotate connector encryption keys with concurrent connector updates; confirm conflicts are reported and a repeat rotation completes without losing credentials.
- [ ] Replay OAuth state and webhook signatures; confirm one-time state and timestamp/signature checks reject replays.
- [ ] Stop the host while durable memory and webhook jobs are queued; restart and verify lease recovery and bounded retries.
- [ ] Restore a backup in an isolated environment and verify database/blob consistency before relying on the backup procedure.

Do not use production credentials or send real email/calendar actions during these checks. The checklist is incomplete until a full route/tool review, dependency audit, and runtime findings are recorded in `SECURITY_AUDIT.md`.
