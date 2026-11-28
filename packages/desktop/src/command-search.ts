export type SearchableCommand = { id: string; label: string; group: string };

export function searchCommands<T extends SearchableCommand>(commands: T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return commands;
  return commands.map((command, order) => {
    const text = `${command.label} ${command.group}`.toLocaleLowerCase();
    const direct = text.indexOf(needle);
    if (direct >= 0) return { command, score: direct, order };
    let position = 0;
    let gap = 0;
    for (const character of needle) {
      const found = text.indexOf(character, position);
      if (found < 0) return { command, score: Number.POSITIVE_INFINITY, order };
      gap += found - position;
      position = found + 1;
    }
    return { command, score: text.length + gap, order };
  }).filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.order - right.order)
    .map((entry) => entry.command);
}
