import { SignIn, SignUp } from "@clerk/react";

export default function ClerkAuthScreen({ mode }: { mode: "in" | "up" }) {
  return mode === "in" ? <SignIn routing="hash" /> : <SignUp routing="hash" />;
}
