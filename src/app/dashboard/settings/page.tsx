"use client";

import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, Mail, Shield, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Settings</h1>
        <p className="text-foreground/60">Manage your account and preferences.</p>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold">Profile Information</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Full Name
            </label>
            <Input defaultValue={session?.user?.name || ""} disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" /> Email Address
            </label>
            <Input defaultValue={session?.user?.email || ""} disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Role
            </label>
            <Input defaultValue={session?.user?.role || "STUDENT"} disabled />
          </div>
        </div>
        <Button variant="outline" disabled>Update Profile (Coming Soon)</Button>
      </div>

      <div className="card space-y-4 border-red-500/30">
        <h2 className="text-xl font-semibold text-red-500">Danger Zone</h2>
        <p className="text-sm text-foreground/60">Sign out of your account on this device.</p>
        <Button variant="destructive" onClick={() => signOut({ callbackUrl: "/login" })}>
          <LogOut className="h-4 w-4 mr-2" /> Sign Out
        </Button>
      </div>
    </div>
  );
}