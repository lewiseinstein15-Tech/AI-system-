"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, Save, Bell, ShieldCheck } from "lucide-react";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">System Settings</h1>
        <p className="text-foreground/60">Configure global platform settings and AI parameters.</p>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" /> General Settings
        </h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Platform Name</label>
            <Input defaultValue="Computer Science Hub AI" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Support Email</label>
            <Input type="email" defaultValue="support@cshub.ai" />
          </div>
        </div>
        <Button><Save className="h-4 w-4 mr-2" /> Save Changes</Button>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" /> Security & Rate Limiting
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Max API Requests per Minute</label>
            <Input type="number" defaultValue={60} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Password Min Length</label>
            <Input type="number" defaultValue={6} />
          </div>
        </div>
        <Button variant="outline">Update Security Settings</Button>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" /> Notifications
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Email Notifications</p>
            <p className="text-xs text-foreground/60">Receive emails for new user signups and system errors.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" value="" className="sr-only peer" defaultChecked />
            <div className="w-11 h-6 bg-accent peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>
    </div>
  );
}