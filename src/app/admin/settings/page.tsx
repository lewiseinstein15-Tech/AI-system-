"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings, Save, Bell, ShieldCheck } from "lucide-react";

export default function AdminSettingsPage() {
  const [platformName, setPlatformName] = useState("Computer Science Hub AI");
  const [supportEmail, setSupportEmail] = useState("support@cshub.ai");
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // Fetch current settings from database on load
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.platformName) setPlatformName(data.platformName);
          if (data.supportEmail) setSupportEmail(data.supportEmail);
        }
      } catch (error) {
        console.error("Failed to fetch settings", error);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setIsLoading(true);
    setSaveStatus("Saving...");
    
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformName, supportEmail }),
      });

      if (res.ok) {
        setSaveStatus("✅ Saved successfully!");
      } else {
        setSaveStatus("❌ Failed to save.");
      }
    } catch (error) {
      setSaveStatus("❌ Network error.");
    } finally {
      setIsLoading(false);
      setTimeout(() => setSaveStatus(""), 3000);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary font-mono">System Settings</h1>
        <p className="text-foreground/60 font-mono">Configure global platform settings.</p>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 font-mono">
          <Settings className="h-5 w-5 text-primary" /> General Settings
        </h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium font-mono">Platform Name</label>
            <Input 
              value={platformName} 
              onChange={(e) => setPlatformName(e.target.value)} 
              className="font-mono" 
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium font-mono">Support Email</label>
            <Input 
              type="email" 
              value={supportEmail} 
              onChange={(e) => setSupportEmail(e.target.value)} 
              className="font-mono" 
            />
          </div>
        </div>
        <Button onClick={handleSave} disabled={isLoading}>
          <Save className="h-4 w-4 mr-2" /> {isLoading ? "Saving..." : "Save Changes"}
        </Button>
        {saveStatus && <p className="text-sm text-primary font-mono mt-2">{saveStatus}</p>}
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 font-mono">
          <ShieldCheck className="h-5 w-5 text-primary" /> Security & Rate Limiting
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium font-mono">Max API Requests per Minute</label>
            <Input type="number" defaultValue={60} className="font-mono" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium font-mono">Password Min Length</label>
            <Input type="number" defaultValue={6} className="font-mono" />
          </div>
        </div>
        <Button variant="outline">Update Security Settings</Button>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 font-mono">
          <Bell className="h-5 w-5 text-primary" /> Notifications
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium font-mono">Email Notifications</p>
            <p className="text-xs text-foreground/60 font-mono">Receive emails for new user signups and system errors.</p>
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