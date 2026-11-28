import { Dialog } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { type SearchableCommand, searchCommands } from "./command-search.ts";
import { t } from "./i18n/index.ts";

export type Command = SearchableCommand & { shortcut?: string; run: () => void };

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => searchCommands(commands, query), [commands, query]);
  const selected = Math.min(index, Math.max(0, matches.length - 1));
  const choose = (command: Command) => {
    onOpenChange(false);
    setQuery("");
    setIndex(0);
    command.run();
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setIndex(0);
        }
      }}
    >
      <Dialog.Content className="command-content" aria-describedby="command-description">
        <Dialog.Title>{t("commandTitle")}</Dialog.Title>
        <Dialog.Description id="command-description">{t("commandDescription")}</Dialog.Description>
        <input
          className="command-input"
          aria-label={t("openSearch")}
          aria-controls="command-options"
          aria-activedescendant={matches.length ? `command-option-${selected}` : undefined}
          autoComplete="off"
          placeholder={t("search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (matches.length)
                setIndex(
                  (selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
                    matches.length,
                );
            } else if (event.key === "Enter" && matches[selected]) {
              event.preventDefault();
              choose(matches[selected]);
            }
          }}
        />
        <div className="command-list" id="command-options" aria-label={t("commandTitle")}>
          {matches.map((command, itemIndex) => (
            <button
              key={command.id}
              type="button"
              id={`command-option-${itemIndex}`}
              className="command-option"
              aria-current={selected === itemIndex ? "true" : undefined}
              tabIndex={-1}
              onPointerMove={() => setIndex(itemIndex)}
              onClick={() => choose(command)}
            >
              <span>
                {command.label}
                <small className="command-group"> · {command.group}</small>
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
        {!matches.length && (
          <p className="command-empty" aria-live="polite">
            {t("commandEmpty")}
          </p>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
