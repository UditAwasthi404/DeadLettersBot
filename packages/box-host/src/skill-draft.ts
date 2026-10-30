export type SkillDraft = {
  name: string;
  description: string;
  steps: Array<{ instruction: string }>;
};

export function parseSkillDraft(text: string): SkillDraft {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("skill draft was not JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    name?: unknown;
    description?: unknown;
    steps?: Array<{ instruction?: unknown } | string>;
  };
  if (typeof parsed.name !== "string" || !parsed.name.trim() || parsed.name.trim().length > 120)
    throw new Error("skill draft name is invalid");
  const description =
    typeof parsed.description === "string" ? parsed.description.slice(0, 2000) : "";
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0 || parsed.steps.length > 20)
    throw new Error("skill draft steps are invalid");
  const steps = parsed.steps.map((step) => {
    const instruction =
      typeof step === "string"
        ? step
        : typeof step?.instruction === "string"
          ? step.instruction
          : "";
    if (!instruction.trim() || instruction.length > 4000)
      throw new Error("skill draft step is invalid");
    return { instruction: instruction.trim() };
  });
  return { name: parsed.name.trim(), description, steps };
}
