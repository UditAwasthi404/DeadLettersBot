# Resource sizing (initial estimates)

These are planning estimates from the current Compose and VM defaults, not measured production capacity. Browser-heavy workloads can exceed them; run a load test with the intended model provider and task mix before sizing production hosts.

## Starting point

| Deployment | Suggested starting capacity | Notes |
| --- | --- | --- |
| Development, no browser work | 4 vCPU, 8 GiB RAM, 20 GiB free disk | Host, PostgreSQL, Redis, and MinIO in one machine; mock or light model traffic. |
| One active browser VM | 4 vCPU, 8 GiB RAM, 30 GiB free disk | Includes the services above and one Chromium VM with the current 2 GiB/2 CPU container limits. |
| Several concurrent browser VMs | Add up to 2 vCPU and 2 GiB RAM per active VM, plus 1–2 GiB host headroom | Capacity is capped by the VM resource settings; measure actual peak usage before increasing concurrency. |

Disk needs depend on conversation blobs, browser profiles, database growth, and retention. Keep PostgreSQL and S3-compatible blob backups off-host, monitor free space, and size persistent volumes from observed growth rather than these initial values.

## Scaling inputs

- Active browser sessions drive CPU and RAM; idle bots do not need a live Chromium process.
- Inference calls consume provider capacity and network bandwidth. The model provider's own rate limits and pricing are outside these host estimates.
- PostgreSQL and MinIO storage grow with transcript, memory, skill, and attachment volume. Attachments are not yet supported by the desktop client.
- Redis stores queues and short-lived coordination state; configure persistence and memory limits for the chosen deployment.
- Prometheus/Grafana add their own storage and memory use when the observability profile is enabled.

There are no validated AWS, GCP, or Hetzner cost estimates yet. Convert the measured CPU, RAM, disk, and egress profile into current provider prices before purchasing capacity.
