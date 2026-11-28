import { Minus, PanelLeft, Search, Square, X } from "lucide-react";
import { t } from "./i18n/index.ts";

export function WindowTitlebar({
  collapsed,
  onToggleSidebar,
  onSearch,
  onError,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onSearch: () => void;
  onError: (error: unknown) => void;
}) {
  const platform = window.agentOS?.platform;
  const modifier = platform === "darwin" ? "⌘" : "Ctrl+";
  const control = (action: "minimize" | "maximize" | "close") => {
    void window.agentOS?.windowControl?.(action).catch(onError);
  };
  return (
    <div className="window-titlebar">
      <div className="titlebar-leading">
        <button
          type="button"
          className="titlebar-button"
          aria-label={t("toggleSidebar")}
          aria-expanded={!collapsed}
          onClick={onToggleSidebar}
        >
          <PanelLeft aria-hidden="true" />
        </button>
        <span className="titlebar-name">{t("appName")}</span>
      </div>
      <button
        type="button"
        className="titlebar-search"
        onClick={onSearch}
        aria-label={t("openSearch")}
      >
        <Search aria-hidden="true" />
        <span>{t("openSearch")}</span>
        <kbd>{modifier}K</kbd>
      </button>
      {platform && platform !== "darwin" ? (
        <div className="titlebar-controls">
          <button
            type="button"
            className="titlebar-button"
            aria-label={t("minimize")}
            onClick={() => control("minimize")}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="titlebar-button"
            aria-label={t("maximize")}
            onClick={() => control("maximize")}
          >
            <Square aria-hidden="true" />
          </button>
          <button
            type="button"
            className="titlebar-button is-close"
            aria-label={t("closeWindow")}
            onClick={() => control("close")}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : (
        <span />
      )}
    </div>
  );
}
