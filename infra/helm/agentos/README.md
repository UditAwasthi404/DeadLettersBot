# AgentOS Helm chart

This chart packages one `box-host` replica with PostgreSQL, Redis, and MinIO. It creates persistent volume claims for all three stateful services and uses Kubernetes Secrets for application, database, object-store, and inference credentials. An Ingress is optional.

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

Install with `helm upgrade --install agentos ./infra/helm/agentos -f deployment-values.yaml`. Set ingress hosts and TLS secrets for public access. Back up the PostgreSQL and MinIO PVC data independently; this chart does not configure backup jobs or high availability.

## Runtime limitation

This is not yet a complete Kubernetes deployment for browser and shell automation. The repository currently runs Docker VM management inside `box-host` and relies on Docker container network attachment and per-bot browser routing. A Kubernetes pod cannot provide those semantics through this chart. VM execution, isolated `vm-manager`, HPA, cert-manager resources, and cluster acceptance remain unsupported. Keep one host replica; the chart rejects a larger replica count until turn routing and VM management are externalized. The API and background workers can start, but browser and shell tools require the Docker runtime architecture that is not supplied here.
