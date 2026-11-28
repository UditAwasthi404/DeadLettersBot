import { Bookmark, Check, Inbox, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useThemeMode } from "./theme.tsx";
import { ApprovalCard } from "./components/ApprovalCard.tsx";
import { Avatar } from "./components/Avatar.tsx";
import { Badge } from "./components/Badge.tsx";
import { Button } from "./components/Button.tsx";
import { CodeBlock } from "./components/CodeBlock.tsx";
import { ContextMenu } from "./components/ContextMenu.tsx";
import { Dialog } from "./components/Dialog.tsx";
import { EmptyState } from "./components/EmptyState.tsx";
import { IconButton } from "./components/IconButton.tsx";
import { Input } from "./components/Input.tsx";
import { Kbd } from "./components/Kbd.tsx";
import { ListRow } from "./components/ListRow.tsx";
import { LivePill } from "./components/LivePill.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { Menu, type MenuItem } from "./components/Menu.tsx";
import { PlanChecklist, type PlanStep } from "./components/PlanChecklist.tsx";
import { Popover } from "./components/Popover.tsx";
import { ResizeHandle } from "./components/ResizeHandle.tsx";
import { SegmentedControl, THEME_CHOICES } from "./components/SegmentedControl.tsx";
import { Select } from "./components/Select.tsx";
import { Sheet } from "./components/Sheet.tsx";
import { Skeleton } from "./components/Skeleton.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { Switch } from "./components/Switch.tsx";
import { Tabs } from "./components/Tabs.tsx";
import { Textarea } from "./components/Textarea.tsx";
import { Timeline } from "./components/Timeline.tsx";
import { ToastStack } from "./components/Toast.tsx";
import { ToolCard } from "./components/ToolCard.tsx";
import { Tooltip } from "./components/Tooltip.tsx";
import "./components.css";

const INITIAL_PLAN: PlanStep[] = [
  { id: "inspect", title: "Inspect the request", state: "completed" },
  { id: "draft", title: "Draft the response", state: "running", detail: "A local preview, not an agent execution." },
  { id: "review", title: "Review the draft", state: "pending" },
  { id: "retry", title: "Recover an interrupted step", state: "failed" },
  { id: "send", title: "Send externally", state: "skipped", detail: "No backend actions run in this gallery." },
];
const MARKDOWN_SAMPLE = "### Safe GFM\n\nA **design preview** with `inline code`, ~~deleted text~~ and a table.\n\n| Component | State |\n| --- | --- |\n| ToolCard | Ready |\n| Approval | Waiting |\n\n- [x] Keyboard states\n- [ ] Review the design\n\n> External links use the AgentOS bridge.\n\n[React documentation](https://react.dev)\n\n```ts\nconst preview = { local: true };\n```";

function Example({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className="aos-gallery-example" aria-labelledby={id}><h3 id={id}>{title}</h3>{children}</section>;
}
function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="aos-gallery-section" aria-labelledby={`${id}-heading`}><h2 id={`${id}-heading`}>{title}</h2><div className="aos-gallery-grid">{children}</div></section>;
}

export default function ComponentGallery() {
  const { mode, resolved, setMode } = useThemeMode();
  const [name, setName] = useState("Research assistant");
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState("personal");
  const [enabled, setEnabled] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [menuAction, setMenuAction] = useState("No local action selected");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skeletonVisible, setSkeletonVisible] = useState(true);
  const [live, setLive] = useState(true);
  const [selectedRow, setSelectedRow] = useState("research");
  const [approvalDecision, setApprovalDecision] = useState<"allowed" | "denied">();
  const [plan, setPlan] = useState(INITIAL_PLAN);
  const [panelWidth, setPanelWidth] = useState(180);
  const [compactEmpty, setCompactEmpty] = useState(false);
  const items: MenuItem[] = [
    { id: "rename", label: "Rename preview", icon: <Settings />, shortcut: "F2", onSelect: () => setMenuAction("Rename selected locally") },
    { id: "archive", label: "Archive preview", icon: <Inbox />, onSelect: () => setMenuAction("Archive selected locally") },
    { id: "disabled", label: "Unavailable action", disabled: true, onSelect: () => {} },
    { id: "delete", label: "Remove preview", danger: true, separatorBefore: true, icon: <Trash2 />, onSelect: () => setMenuAction("Remove selected locally; no data was deleted") },
  ];
  return <main className="aos-gallery" aria-label="Component design gallery"><div className="aos-gallery-inner">
    <header className="aos-gallery-header"><div><h1>Design gallery</h1><p className="aos-field-hint">AgentOS 2 · interactive component previews. All example actions update local state only.</p></div>
      <div className="aos-stack"><SegmentedControl label="Gallery theme" value={mode} options={THEME_CHOICES} onValueChange={setMode} /><span className="aos-field-hint">Resolved appearance: {resolved}</span></div>
    </header>
    <nav aria-label="Gallery sections" className="aos-gallery-nav"><a href="#controls">Controls</a><a href="#overlays">Overlays</a><a href="#feedback">Feedback</a><a href="#content">Content</a><a href="#agent">Agent patterns</a></nav>

    <Group id="controls" title="Controls">
      <Example title="Button · variants and sizes"><div className="aos-inline">
        <Button onClick={() => setNotice("Primary preview clicked")}>Primary</Button>
        <Button variant="secondary" onClick={() => setNotice("Secondary preview clicked")}>Secondary</Button>
        <Button variant="ghost" onClick={() => setName("")}>Clear preview</Button>
        <Button variant="danger" onClick={() => setError("Danger style preview only; nothing was deleted")}>Danger</Button>
        <Button size="sm" onClick={() => setNotice("Small button clicked")}>Small</Button><Button disabled>Disabled</Button>
      </div><div className="aos-inline"><Button loading={loading} onClick={() => setLoading(true)}>Loading state</Button><Button variant="ghost" size="sm" onClick={() => setLoading(false)}>Reset</Button></div></Example>
      <Example title="IconButton · Tooltip · Kbd"><div className="aos-inline">
        <Tooltip content="Bookmark preview" shortcut="B"><IconButton label="Bookmark preview" aria-pressed={bookmarked} onClick={() => setBookmarked(!bookmarked)}><Bookmark /></IconButton></Tooltip>
        <IconButton label="Disabled settings" disabled><Settings /></IconButton><Kbd>⌘</Kbd><Kbd>K</Kbd>
      </div><span role="status" className="aos-field-hint">{bookmarked ? "Bookmarked locally" : "Not bookmarked"}. Tooltip appears after 500 ms or on focus.</span></Example>
      <Example title="Input"><Input label="Assistant name" value={name} onChange={(event) => setName(event.target.value)} hint="A controlled text field." />
        <Input label="Invalid example" defaultValue="" error="A name is required." placeholder="Enter a name" /><Input label="Disabled example" defaultValue="Read only preview" disabled /></Example>
      <Example title="Textarea · 1–12 lines"><Textarea label="Preview message" value={message} onChange={(event) => setMessage(event.target.value)} hint="Type or paste multiple lines; height is capped at twelve lines." />
        <div className="aos-inline"><Button size="sm" variant="secondary" onClick={() => setMessage(Array.from({ length: 16 }, (_, i) => `Preview line ${i + 1}`).join("\n"))}>Fill sixteen lines</Button><Button size="sm" variant="ghost" onClick={() => setMessage("")}>Clear</Button></div></Example>
      <Example title="Select"><Select label="Workspace preview" value={selection} onValueChange={setSelection} options={[{ value: "personal", label: "Personal" }, { value: "team", label: "Team" }, { value: "locked", label: "Unavailable", disabled: true }]} />
        <span className="aos-field-hint" role="status">Selected: {selection}</span><Select label="Disabled select" defaultValue="personal" disabled options={[{ value: "personal", label: "Personal" }]} /></Example>
      <Example title="Switch · SegmentedControl"><Switch label="Local notifications" description="This switch does not change account settings." checked={enabled} onCheckedChange={setEnabled} />
        <Switch label="Disabled switch" checked={false} disabled /><SegmentedControl label="Appearance" value={mode} options={THEME_CHOICES} onValueChange={setMode} /><p className="aos-field-hint">Arrow keys, Home and End move between choices.</p></Example>
    </Group>

    <Group id="overlays" title="Overlays and navigation">
      <Example title="Menu"><Menu label="Preview actions" trigger={<Button variant="secondary"><MoreHorizontal />Open menu</Button>} items={items} /><p role="status" className="aos-field-hint">{menuAction}</p></Example>
      <Example title="ContextMenu"><ContextMenu label="Context actions" items={items}><button type="button" className="aos-list-row">Right-click, press Menu, or Shift+F10 here</button></ContextMenu><p role="status" className="aos-field-hint">{menuAction}</p></Example>
      <Example title="Popover"><Popover title="Preview preferences" trigger={<Button variant="secondary">Open popover</Button>}><Switch label="Local notifications" checked={enabled} onCheckedChange={setEnabled} /><p className="aos-field-hint">Escape closes the popover and returns focus.</p></Popover></Example>
      <Example title="Dialog"><Dialog title="Edit design preview" description="Local state only. No account or backend changes are made." open={dialogOpen} onOpenChange={setDialogOpen} trigger={<Button variant="secondary">Open dialog</Button>}
        footer={<><Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={() => { setDialogOpen(false); setNotice("Dialog preview closed locally"); }}>Done</Button></>}><Input label="Preview name" value={name} onChange={(event) => setName(event.target.value)} /><Textarea label="Preview notes" /></Dialog><p className="aos-field-hint">Tab stays inside; Escape closes; focus returns to the trigger.</p></Example>
      <Example title="Sheet"><Sheet title="Design details" description="A modal side panel built on the current Radix dialog." open={sheetOpen} onOpenChange={setSheetOpen} trigger={<Button variant="secondary">Open sheet</Button>} footer={<Button onClick={() => setSheetOpen(false)}>Close details</Button>}><Input label="Preview name" value={name} onChange={(event) => setName(event.target.value)} /><Switch label="Local notifications" checked={enabled} onCheckedChange={setEnabled} /></Sheet></Example>
      <Example title="Tabs"><Tabs label="Preview details" items={[{ value: "overview", label: "Overview", content: <p className="aos-field-hint">The overview panel is selected.</p> }, { value: "activity", label: "Activity", content: <p className="aos-field-hint">All activity in this gallery is local.</p> }, { value: "disabled", label: "Unavailable", disabled: true, content: null }]} /></Example>
    </Group>

    <Group id="feedback" title="Feedback and identity">
      <Example title="Badge · Avatar"><div className="aos-inline"><Badge>Neutral</Badge><Badge tone="accent">Accent</Badge><Badge tone="success">Success</Badge><Badge tone="warning">Warning</Badge><Badge tone="danger">Danger</Badge></div>
        <div className="aos-inline"><Avatar name={name || "Research assistant"} /><Avatar size="sm" name="Agent OS" /><span className="aos-field-hint">Initials follow the name field.</span></div></Example>
      <Example title="Spinner · Skeleton"><Spinner label="Preview loading" /><Button size="sm" variant="secondary" onClick={() => setSkeletonVisible(!skeletonVisible)}>{skeletonVisible ? "Show loaded preview" : "Show skeleton"}</Button>
        {skeletonVisible ? <><Skeleton lines={3} /><div className="aos-inline"><Skeleton shape="circle" /><Skeleton shape="block" /></div></> : <p className="aos-gallery-message">Loaded design content. This is a local display toggle.</p>}</Example>
      <Example title="LivePill"><div className="aos-inline"><LivePill live={live} /><LivePill live={false} label="Disconnected" /></div><Switch label="Live preview state" checked={live} onCheckedChange={setLive} /></Example>
      <Example title="EmptyState · preserved contract"><EmptyState icon={Inbox} title="Nothing here yet" description="A local empty-state preview." compact={compactEmpty} action={<Button size="sm" variant="secondary" onClick={() => setNotice("Empty-state action clicked locally")}>Add preview</Button>} /><Switch label="Compact empty state" checked={compactEmpty} onCheckedChange={setCompactEmpty} /></Example>
      <Example title="ToastStack · preserved contract"><div className="aos-inline"><Button size="sm" variant="secondary" onClick={() => setNotice("Success preview. Automatically dismisses in 3.5 seconds.")}>Success toast</Button><Button size="sm" variant="danger" onClick={() => setError("Error preview. Automatically dismisses in 8 seconds.")}>Error toast</Button></div>
        <div className="aos-gallery-toast-preview"><ToastStack error={error} notice={notice} onDismissError={() => setError("")} onDismissNotice={() => setNotice("")} /></div></Example>
    </Group>

    <Group id="content" title="Content and layout">
      <Example title="ListRow"><div className="aos-stack"><ListRow title="Research assistant" description="Local selection preview" leading={<Avatar name="Research assistant" />} trailing={<Badge tone="accent">Agent</Badge>} selected={selectedRow === "research"} onClick={() => setSelectedRow("research")} />
        <ListRow title="Writing assistant" description="Click to select" leading={<Avatar name="Writing assistant" />} selected={selectedRow === "writing"} onClick={() => setSelectedRow("writing")} /><ListRow title="Unavailable assistant" disabled onClick={() => {}} /><ListRow title="Static information row" description="No interactive semantics" /></div></Example>
      <Example title="CodeBlock · language, copy and wrap"><CodeBlock language="typescript" code={'const preview = { workspace: "personal", localOnly: true, description: "A long line demonstrates horizontal scrolling and optional wrapping." };\nconsole.log(preview);'} /></Example>
      <Example title="Markdown · safe GFM"><Markdown content={MARKDOWN_SAMPLE} /></Example>
      <Example title="ResizeHandle"><div className="aos-gallery-resize-demo"><div id="gallery-resizable-panel" className="aos-gallery-resize-panel" style={{ width: panelWidth }}>Preview panel<br />{Math.round(panelWidth)} px</div>
        <ResizeHandle label="Preview panel width" value={panelWidth} min={100} max={280} controls="gallery-resizable-panel" onValueChange={setPanelWidth} /><div className="aos-gallery-resize-rest">Flexible content</div></div><p className="aos-field-hint">Drag the divider or focus it and use Left/Right, Home/End. Shift changes the step.</p></Example>
    </Group>

    <Group id="agent" title="Agent patterns · local previews">
      <Example title="ToolCard"><ToolCard name="ReadFile" status="success" durationMs={240} args={{ path: "/workspace/preview.txt" }} result="This is sample content, not a tool result." /><ToolCard name="Search preview" status="running" args={{ query: "design system" }} /><ToolCard name="Unavailable preview" status="error" result={{ error: "A display-only example" }} /></Example>
      <Example title="ApprovalCard"><ApprovalCard action={'Send email to design@example.com\nSubject: Design preview\nBody: This exact sample action is shown for review.'} description="Allow and Deny update only the card state; no email is sent." decision={approvalDecision} onAllow={() => setApprovalDecision("allowed")} onDeny={() => setApprovalDecision("denied")} /><Button size="sm" variant="ghost" onClick={() => setApprovalDecision(undefined)}>Reset approval preview</Button></Example>
      <Example title="PlanChecklist"><PlanChecklist steps={plan} /><div className="aos-inline"><Button size="sm" variant="secondary" onClick={() => setPlan((steps) => steps.map((step) => step.state === "running" || step.state === "pending" ? { ...step, state: "completed" } : step))}>Complete local steps</Button><Button size="sm" variant="ghost" onClick={() => setPlan(INITIAL_PLAN)}>Reset plan</Button></div></Example>
      <Example title="Timeline"><Timeline events={[{ id: "created", title: "Preview created", time: "10:30", tone: "accent", description: "Static sample activity." }, { id: "reviewed", title: "Design reviewed", time: "10:32", tone: "success", icon: <Check /> }, { id: "waiting", title: "Waiting for approval", time: "10:33", tone: "warning", description: "No live agent is running." }]} /></Example>
    </Group>
    <footer className="aos-field-hint">Design gallery · use Tab to inspect focus rings. Reduced-motion preferences disable continuous loading animations.</footer>
  </div></main>;
}
