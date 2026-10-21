"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/actions/auth";

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  // Controlled so the address survives React's form reset after a failed action.
  const [email, setEmail] = useState("");
  const [signInState, signInAction, signingIn] = useActionState(signIn, null);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, null);
  const state = mode === "signin" ? signInState : signUpState;
  const pending = signingIn || signingUp;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "signin" ? "Sign in" : "Create your account"}</h1>
        <p className="text-sm text-muted-foreground">
          {mode === "signin" ? "Welcome back. Use your email and password." : "Each account has its own private contacts, media and campaigns."}
        </p>
      </div>

      {initialError && !state ? (
        <Alert variant="destructive">
          <AlertDescription>{initialError}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state?.ok && state.message ? (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <form action={mode === "signin" ? signInAction : signUpAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        {mode === "signup" ? (
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" autoComplete="name" />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
        <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
