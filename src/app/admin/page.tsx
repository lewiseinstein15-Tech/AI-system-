"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, Database, Settings, Activity, Shield } from "lucide-react";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("users");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (session && session.user?.role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  if (status !== "authenticated" || session?.user?.role !== "ADMIN") {
    return <div className="flex h-screen items-center justify-center bg-background">Access Denied</div>;
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-foreground/60">Manage your platform</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-border">
          {[
            { id: "users", label: "User Management", icon: Users },
            { id: "database", label: "Database", icon: Database },
            { id: "analytics", label: "Analytics", icon: Activity },
            { id: "settings", label: "Settings", icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-foreground/60 hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="card">
          {activeTab === "users" && (
            <div>
              <h2 className="mb-4 text-xl font-semibold">User Management</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-foreground/60">
                    <th className="py-3 text-left">Name</th>
                    <th className="py-3 text-left">Email</th>
                    <th className="py-3 text-left">Role</th>
                    <th className="py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-3">Admin User</td>
                    <td className="py-3">admin@cshub.ai</td>
                    <td className="py-3"><span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">ADMIN</span></td>
                    <td className="py-3 text-right"><button className="text-red-500 hover:underline text-xs">Delete</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {activeTab === "database" && <div>Database Management Interface</div>}
          {activeTab === "analytics" && <div>Analytics Dashboard</div>}
          {activeTab === "settings" && <div>System Settings</div>}
        </div>
      </div>
    </div>
  );
}