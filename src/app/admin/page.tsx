"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, Database, Settings, Shield, BookMarked } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [totalUsers, setTotalUsers] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/unauthorized");

    // Fetch REAL user count from the database
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (res.ok) {
          const data = await res.json();
          setTotalUsers(data.length);
        }
      } catch (error) {
        console.error("Failed to fetch users", error);
      }
    };
    fetchUsers();
  }, [session, status, router]);

  const stats = [
    { name: "Total Users", value: totalUsers.toString(), icon: Users, href: "/admin/users" },
    { name: "Subjects", value: "Manage", icon: BookMarked, href: "/admin/subjects" },
    { name: "Database", value: "Manage", icon: Database, href: "/admin/database" },
    { name: "Settings", value: "Config", icon: Settings, href: "/admin/settings" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold font-mono">Admin Dashboard</h1>
          <p className="text-foreground/60 font-mono">Welcome back, {session?.user?.name}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link href={stat.href} key={stat.name}>
            <div className="card hover:border-primary transition-colors cursor-pointer">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-foreground/60 font-mono">{stat.name}</h3>
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <p className="text-2xl font-bold font-mono text-primary">{stat.value}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}