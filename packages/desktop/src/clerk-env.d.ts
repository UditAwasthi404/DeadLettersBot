interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_CLERK_MOCK?: string;
  readonly CLERK_PUBLISHABLE_KEY?: string;
  readonly CLERK_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
