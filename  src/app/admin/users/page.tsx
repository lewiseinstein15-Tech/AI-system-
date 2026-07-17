"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Users, Trash2, ShieldCheck, ShieldX } from "lucide-react";

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

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
    if (res.ok) {
      const data = await res.json();
      setUsers(data);
    }
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    // Optimistic UI update
    setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    // In a full app, you would send a PATCH request here to update the role
    // await fetch(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
    console.log(`User ${id} role changed to ${newRole}`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">User Management</h1>
        <p className="text-foreground/60">View, manage, and assign roles to users.</p>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-accent/50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-left font-medium text-foreground/70">User</th>
                <th className="px-6 py-4 text-left font-medium text-foreground/70">Email</th>
                <th className="px-6 py-4 text-left font-medium text-foreground/70">Role</th>
                <th className="px-6 py-4 text-right font-medium text-foreground/70">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-foreground/40">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                          {user.name?.[0] || user.email[0].toUpperCase()}
                        </div>
                        <span className="font-medium">{user.name || "Unnamed User"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-foreground/60">{user.email}</td>
                    <td className="px-6 py-4">
                      <select 
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        className="bg-accent border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="STUDENT">Student</option>
                        <option value="LECTURER">Lecturer</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-500/10">
                        <Trash2 className="h-4 w-4" />
                      </Button>
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