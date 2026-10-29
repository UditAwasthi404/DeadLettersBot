type Labels = Record<string, string>;
type Metric = { name: string; labels: Labels; value: number };
type Histogram = {
  name: string;
  labels: Labels;
  count: number;
  sum: number;
  buckets: number[];
};

const counters = new Map<string, Metric>();
const histograms = new Map<string, Histogram>();
const histogramBoundaries = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function key(name: string, labels: Labels): string {
  return `${name}:${JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))}`;
}

function labelText(labels: Labels): string {
  const entries = Object.entries(labels);
  if (!entries.length) return "";
  return `{${entries.map(([name, value]) => `${name}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`).join(",")}}`;
}

export function incrementCounter(name: string, labels: Labels = {}, amount = 1): void {
  const id = key(name, labels);
  const previous = counters.get(id);
  counters.set(id, { name, labels, value: (previous?.value ?? 0) + amount });
}

export function observeHistogram(name: string, value: number, labels: Labels = {}): void {
  if (!Number.isFinite(value) || value < 0) return;
  const id = key(name, labels);
  const previous = histograms.get(id);
  const buckets = previous?.buckets ?? Array(histogramBoundaries.length).fill(0);
  for (let i = 0; i < histogramBoundaries.length; i += 1) {
    const boundary = histogramBoundaries[i];
    if (boundary !== undefined && value <= boundary) buckets[i] = (buckets[i] ?? 0) + 1;
  }
  histograms.set(id, {
    name,
    labels,
    count: (previous?.count ?? 0) + 1,
    sum: (previous?.sum ?? 0) + value,
    buckets,
  });
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];
  const declared = new Set<string>();
  const declare = (name: string, type: "counter" | "histogram") => {
    if (declared.has(name)) return;
    declared.add(name);
    lines.push(`# HELP ${name} AgentOS ${name.replaceAll("_", " ")}`);
    lines.push(`# TYPE ${name} ${type}`);
  };
  for (const metric of counters.values()) {
    declare(metric.name, "counter");
    lines.push(`${metric.name}${labelText(metric.labels)} ${metric.value}`);
  }
  for (const metric of histograms.values()) {
    declare(metric.name, "histogram");
    for (let i = 0; i < histogramBoundaries.length; i += 1) {
      const boundary = histogramBoundaries[i];
      if (boundary === undefined) continue;
      const labels = labelText({ ...metric.labels, le: String(boundary) });
      lines.push(`${metric.name}_bucket${labels} ${metric.buckets[i] ?? 0}`);
    }
    lines.push(
      `${metric.name}_bucket${labelText({ ...metric.labels, le: "+Inf" })} ${metric.count}`,
    );
    lines.push(`${metric.name}_count${labelText(metric.labels)} ${metric.count}`);
    lines.push(`${metric.name}_sum${labelText(metric.labels)} ${metric.sum}`);
  }
  return `${lines.join("\n")}\n`;
}
