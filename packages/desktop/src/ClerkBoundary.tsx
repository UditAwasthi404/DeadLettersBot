import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import type { ReactNode } from "react";

export type ClerkBridge = {
  enabled: true;
  loaded: boolean;
  signedIn: boolean;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

export function ClerkBoundary({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: (clerk: ClerkBridge) => ReactNode;
}) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkSession>{children}</ClerkSession>
    </ClerkProvider>
  );
}

function ClerkSession({ children }: { children: (clerk: ClerkBridge) => ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  return (
    <>
      {children({
        enabled: true,
        loaded: isLoaded,
        signedIn: Boolean(isSignedIn),
        getToken,
        signOut: () => signOut(),
      })}
    </>
  );
}
