import { siGmail, siGooglecalendar, siGoogledrive, siSalesforce } from "simple-icons";

type BrandMark = {
  path: string;
  color: string;
  label: string;
  /** Multi-stop marks keep brand colors inside the SVG. */
  colored?: boolean;
};

/**
 * Brand marks for connectors.
 * Google + Salesforce paths/colors from Simple Icons.
 * Microsoft product marks are the standard Fluent product tiles (not Lucide stand-ins).
 */
const BRAND: Record<string, BrandMark> = {
  gmail: {
    path: siGmail.path,
    color: `#${siGmail.hex}`,
    label: "Gmail",
  },
  "google-calendar": {
    path: siGooglecalendar.path,
    color: `#${siGooglecalendar.hex}`,
    label: "Google Calendar",
  },
  "google-drive": {
    path: siGoogledrive.path,
    color: `#${siGoogledrive.hex}`,
    label: "Google Drive",
  },
  salesforce: {
    path: siSalesforce.path,
    color: `#${siSalesforce.hex}`,
    label: "Salesforce",
  },
  // Fluent-style Microsoft product icons (official tile geometry).
  onedrive: {
    label: "OneDrive",
    color: "#0078D4",
    colored: true,
    path: "",
  },
  "outlook-mail": {
    label: "Outlook Mail",
    color: "#0078D4",
    colored: true,
    path: "",
  },
  "outlook-calendar": {
    label: "Outlook Calendar",
    color: "#0078D4",
    colored: true,
    path: "",
  },
  teams: {
    label: "Microsoft Teams",
    color: "#6264A7",
    colored: true,
    path: "",
  },
  sharepoint: {
    label: "SharePoint",
    color: "#038387",
    colored: true,
    path: "",
  },
  microsoft: {
    label: "Microsoft",
    color: "#00A4EF",
    colored: true,
    path: "",
  },
};

function MicrosoftMark({ service }: { service: string }) {
  switch (service) {
    case "onedrive":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#0364B8"
            d="M10.5 7.5c1.8-2.1 4.6-2.7 7-1.5 1.7.9 2.9 2.6 3.1 4.5 1.9.3 3.4 1.9 3.4 3.9 0 2.2-1.8 4-4 4H7.8C4.6 18.4 2 15.8 2 12.6c0-2.6 1.7-4.8 4.1-5.6 1.1-2.1 3.3-3.5 5.7-3.5.6 0 1.2.1 1.7.3-.7 1-1.1 2.2-1 3.7z"
          />
          <path
            fill="#0078D4"
            d="M10.6 9.1c-.1-1.4.3-2.7 1.1-3.8C13.1 3.9 15.2 3 17.4 3c2.6 0 4.9 1.6 5.8 4 .2 0 .4 0 .6.1-1.5-.3-3.1.1-4.3 1.1-1.4 1.1-2.1 2.8-2 4.5H9.9c.1-1.3.3-2.5.7-3.6z"
          />
        </svg>
      );
    case "outlook-mail":
    case "outlook-calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#0078D4"
            d="M2 5.5A2.5 2.5 0 0 1 4.5 3H14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4.5A2.5 2.5 0 0 1 2 18.5v-13z"
          />
          <path fill="#28A8EA" d="M14 5h5.5A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5H14V5z" />
          <path
            fill="#fff"
            d="M8.2 8.2c1.9 0 3.2 1.2 3.2 3.1S10.1 14.4 8.2 14.4 5 13.2 5 11.3s1.3-3.1 3.2-3.1zm0 1.2c-1.1 0-1.8.8-1.8 1.9s.7 1.9 1.8 1.9 1.8-.8 1.8-1.9-.7-1.9-1.8-1.9z"
          />
          <path fill="#0A5A9C" d="M14 10.2 22 6.8v1.7l-8 3.2v-1.5z" />
        </svg>
      );
    case "teams":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="17.6" cy="6.2" r="2.2" fill="#5059C9" />
          <path
            fill="#7B83EB"
            d="M19.8 9.4c1.5 0 2.7 1.2 2.7 2.7v3.1c0 .4-.3.7-.7.7h-3.4v-4.2c0-.9-.3-1.6-.7-2.3h2.1z"
          />
          <path
            fill="#4B53BC"
            d="M13.2 8.2h5.1c.9 0 1.6.7 1.6 1.6v8.6c0 1.5-1.2 2.7-2.7 2.7h-4c0-1.4-1.1-2.5-2.5-2.5H8.3V11c0-1.5 1.2-2.8 2.8-2.8h2.1z"
          />
          <path
            fill="#fff"
            d="M11.1 11.2h1.3v5.4h-1.8v-3.7l-1.7 3.7H7.4l-1.7-3.7v3.7H3.9v-5.4h1.4l1.9 4 1.9-4z"
          />
          <circle cx="9.4" cy="5.6" r="2.4" fill="#5059C9" />
        </svg>
      );
    case "sharepoint":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8.2" cy="14.8" r="6.2" fill="#038387" />
          <circle cx="15.8" cy="9.4" r="5.2" fill="#1A9BA1" />
          <circle cx="17.4" cy="17.2" r="3.6" fill="#37C6D0" />
          <path
            fill="#fff"
            d="M7.1 12.2h1.9c1.2 0 2 .6 2 1.6 0 .8-.5 1.3-1.2 1.5l1.4 2.3h-1.5l-1.2-2.1H8.4v2.1H7.1v-5.4zm1.3 1.1v1.4h.5c.5 0 .8-.2.8-.7s-.3-.7-.8-.7h-.5z"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
          <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
          <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
          <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
        </svg>
      );
  }
}

export function connectorBrand(service: string): BrandMark | null {
  return BRAND[service] ?? null;
}

export function ConnectorBrandIcon({
  service,
  size = 22,
  className,
  title,
}: {
  service: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const brand = connectorBrand(service);
  if (!brand) return null;

  if (brand.colored) {
    return (
      <span
        className={className ?? "connector-brand-icon"}
        title={title ?? brand.label}
        aria-hidden={title ? undefined : true}
      >
        <MicrosoftMark service={service} />
      </span>
    );
  }

  return (
    <span
      className={className ?? "connector-brand-icon"}
      title={title ?? brand.label}
      style={{ color: brand.color }}
      aria-hidden={title ? undefined : true}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" width={size} height={size}>
        <path d={brand.path} />
      </svg>
    </span>
  );
}
