"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, Database, Settings, Activity, Shield } from "lucide-react";
import Link from "next/link";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex h-screen items-center justify-center bg-background">Loading...</div>;
  }

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  if (session && session.user?.role !== "ADMIN") {
    router.push("/unauthorized");
    return null;
  }

  const stats = [
    { name: "Total Users", value: "1", icon: Users, href: "/admin/users" },
    { name: "Database Size", value: "30 MB", icon: Database, href: "/admin/database" },
    { name: "Active Sessions", value: "1", icon: Activity, href: "/admin" },
    { name: "Settings", value: "Configured", icon: Settings, href: "/admin/settings" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-foreground/60">Welcome back, {session?.user?.name}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link href={stat.href} key={stat.name}>
            <div className="card hover:border-primary transition-colors cursor-pointer">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-foreground/60">{stat.name}</h3>
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}