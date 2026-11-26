# AgentOS Helm chart

This chart packages one `box-host` replica with PostgreSQL, Redis, MinIO, and the Kubernetes account-VM manager. It creates persistent volume claims for stateful services and one durable home volume per account VM. Kubernetes Secrets hold application, database, object-store, and inference credentials. An Ingress is optional.

Create a private values file (do not commit it) with unique secrets and a published AgentOS image:

```yaml
image:
  repository: your-registry/agentos-box-host
  tag: your-release-tag
secrets:
  jwtSecret: "<at least 32 random characters>"
  connectorEncryptionKey: "<64 hex characters from openssl rand -hex 32>"
postgres:
  password: "<random database password>"
minio:
  rootPassword: "<random object-store password>"
inference:
  providers: xai
  xaiApiKey: "<xAI API key>"
```

Install with `helm upgrade --install agentos ./infra/helm/agentos -f deployment-values.yaml`. Set ingress hosts and TLS secrets for public access. To have cert-manager issue the ingress certificate, enable `certManager.enabled`, set an existing `certManager.issuerName`, and set `certManager.secretName` to the TLS secret in `ingress.tls`. The chart then creates one Certificate with all configured ingress hostnames. Back up the PostgreSQL and MinIO PVC data independently; this chart does not configure backup jobs or high availability.

MCP catalog offloading is enabled by default with `agent.dynamicToolOffloading: true`; set it to `false` to retain the static `MCPCall` tool description in each prompt.

The chart sets `VM_BACKEND=kubernetes`. Each account gets a non-root VM pod and a `ReadWriteOnce` home-volume claim. `vmManager.image` selects the VM image, `vmManager.storageSize` and `vmManager.storageClassName` configure account storage, and `agent.vmMemoryBytes` / `agent.vmCpuNanos` set per-pod resource requests and limits. `agent.vmEgressPolicy` selects `allow_all`, `deny_all`, or `allowlist`; the default denies all VM egress.

For restricted outbound access, set `agent.vmEgressPolicy: allowlist` and enumerate destination CIDRs with their permitted protocol/port pairs:

```yaml
agent:
  vmEgressPolicy: allowlist
  vmEgressAllowlist:
    - cidr: 203.0.113.0/24
      ports:
        - protocol: TCP
          port: 443
    - cidr: 10.96.0.10/32 # Example cluster DNS resolver; replace with the cluster's address.
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

Rules are IP-based and do not resolve domain names. Add the actual DNS resolver CIDR and any destination ranges needed by your provider, connectors, and browser tasks. Helm validates rule structure and the API server validates CIDR syntax. This mode requires a CNI that enforces NetworkPolicies; Docker Compose does not support CIDR/port allowlists.

The chart always creates a VM `NetworkPolicy` that permits browser/CDP and VNC ingress only from box-host pods. Its egress rules follow `agent.vmEgressPolicy`. Kubernetes must use a CNI that enforces NetworkPolicies; clusters without enforcement leave VM pod ports reachable from other cluster workloads. `deny_all` blocks DNS and browser internet access; `allowlist` permits only the listed IP CIDRs and ports. Kubernetes does not expose a per-pod PID limit in the Pod API, so `agent.vmPidsLimit` is not a chart setting.

Optional gateway and state-store ingress policies can be enabled with `networkPolicy.enabled: true` and a non-empty `networkPolicy.ingressNamespaceSelector` matching the ingress-controller namespace labels. Box-host accepts ingress from itself and the selected ingress controller; PostgreSQL, Redis, and MinIO accept ingress only from box-host pods on their service ports. Egress for those workloads remains unchanged. Policies require a CNI that enforces Kubernetes NetworkPolicies; check monitoring, backup, and administrative access before enabling the state-store policies.

## Runtime limitation

VM execution and browser routing use Kubernetes pods when deployed by this chart; Compose continues to use Docker. The host service account can create, inspect, execute commands in, and delete VM pods and their PVCs within the release namespace. The chart keeps one host replica because queue draining still has a process-local ownership guard; HPA and multi-host scheduling require distributed turn ownership. A real cluster acceptance is still required, and storage deletion behavior follows the cluster's StorageClass reclaim policy.
