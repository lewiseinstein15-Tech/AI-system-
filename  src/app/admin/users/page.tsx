"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";

interface User { id: string; name: string | null; email: string; role: string; createdAt: string; }

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (session && session.user?.role !== "ADMIN") router.push("/unauthorized");
    fetchUsers();
  }, [session, status, router]);

  const fetchUsers = async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">User Management</h1>
        <p className="text-foreground/60">View all users in the system.</p>
      </div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-accent/50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-left font-medium text-foreground/70">User</th>
                <th className="px-6 py-4 text-left font-medium text-foreground/70">Email</th>
                <th className="px-6 py-4 text-left font-medium text-foreground/70">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.length === 0 ? (
                <tr><td colSpan={3} className="px-6 py-12 text-center text-foreground/40">No users found.</td></tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-accent/30">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                          {user.name?.[0] || user.email[0].toUpperCase()}
                        </div>
                        <span className="font-medium">{user.name || "Unnamed"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-foreground/60">{user.email}</td>
                    <td className="px-6 py-4">
                      <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">{user.role}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}