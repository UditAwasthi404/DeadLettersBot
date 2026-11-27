# Resource sizing (initial estimates)

These are planning estimates from the current Compose and VM defaults, not measured production capacity. Browser-heavy workloads can exceed them; run a load test with the intended model provider and task mix before sizing production hosts.

## Starting point

| Deployment | Suggested starting capacity | Notes |
| --- | --- | --- |
| Development, no browser work | 4 vCPU, 8 GiB RAM, 20 GiB free disk | Host, PostgreSQL, Redis, and MinIO in one machine; mock or light model traffic. |
| One active browser VM | 4 vCPU, 8 GiB RAM, 30 GiB free disk | Includes the services above and one Chromium VM with the current 2 GiB/2 CPU container limits. |
| Several concurrent browser VMs | Add up to 2 vCPU and 2 GiB RAM per active VM, plus 1–2 GiB host headroom | Capacity is capped by the VM resource settings; measure actual peak usage before increasing concurrency. |

Disk needs depend on conversation blobs, browser profiles, database growth, and retention. Keep PostgreSQL and S3-compatible blob backups off-host, monitor free space, and size persistent volumes from observed growth rather than these initial values.

## Indicative cloud compute costs

List-price snapshot checked 2026-11-26. These estimates use 730 hours per month and Linux/on-demand rates where applicable; they cover one VM only, not a production topology. The shapes are close starting points rather than exact matches, and none has been benchmarked with AgentOS.

| Provider and region | Example shape | Compute rate | 730-hour monthly estimate | Exclusions and notes |
| --- | --- | ---: | ---: | --- |
| AWS `us-east-1` | `c7g.xlarge`, 4 vCPU, 8 GiB, Arm64 | $0.1450/hour | $105.85 | EC2 compute only. EBS, public IPv4, data transfer, and managed services are extra. Check the current [AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.json) and [On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/) before purchase. |
| Google Cloud `us-central1` | `e2-standard-4`, 4 vCPU, 16 GiB | $0.13402284/hour | $97.84 | Instance compute only. Persistent disks, external IPs, and network transfer are extra. See [Compute Engine prices](https://cloud.google.com/products/compute/pricing/general-purpose?hl=en). |
| Hetzner U.S. (`ASH`/`HIL`) | `CPX31`, 4 vCPU, 8 GB | $0.1178/hour | $73.49 monthly cap | Public IPv4 and applicable taxes are extra. The provider caps the bill at the listed monthly amount; see [Hetzner’s June 2026 price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/). |

The monthly figures are compute-only comparisons. AgentOS also needs storage, backups, ingress, and outbound traffic, and a managed database or object store changes the total. Recheck provider calculators and regional availability immediately before provisioning.

## Scaling inputs

- Active browser sessions drive CPU and RAM; idle bots do not need a live Chromium process.
- Inference calls consume provider capacity and network bandwidth. The model provider's own rate limits and pricing are outside these host estimates.
- PostgreSQL and MinIO storage grow with transcript, memory, skill, and attachment volume. Desktop attachments are stored in the conversation blob bucket; budget additional storage and transfer for them.
- Redis stores queues and short-lived coordination state; configure persistence and memory limits for the chosen deployment.
- Prometheus/Grafana add their own storage and memory use when the observability profile is enabled.

These list-price estimates do not establish production capacity. Measure CPU, RAM, disk, and egress under the intended task mix, then recalculate provider costs before purchasing capacity.
