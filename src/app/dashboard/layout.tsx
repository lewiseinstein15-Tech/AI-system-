"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LayoutDashboard, BookOpen, FileText, Brain, Settings, Menu, X, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);

  if (status === "loading") return <div className="flex h-screen items-center justify-center bg-background">Loading...</div>;

  const navItems = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/dashboard/notes", label: "Notes", icon: BookOpen },
    { href: "/dashboard/assignments", label: "Assignments", icon: FileText },
    { href: "/dashboard/flashcards", label: "Flashcards", icon: Brain },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between p-4 border-b border-border bg-background">
        <button onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X className="h-6 w-6 text-primary" /> : <Menu className="h-6 w-6 text-primary" />}
        </button>
        <h1 className="text-lg font-bold text-primary">CS Hub</h1>
        <div className="w-6"></div>
      </div>

      {/* Sidebar */}
      <aside className={`fixed md:relative z-20 w-64 border-r border-border bg-accent/20 flex flex-col transition-transform duration-300 ${menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="p-6 border-b border-border hidden md:block">
          <h2 className="text-xl font-bold text-primary">CS Hub</h2>
        </div>
        <nav className="flex-1 p-4 space-y-1 mt-12 md:mt-0">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-accent hover:text-primary transition-colors">
              <item.icon className="h-5 w-5" /> {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border">
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors w-full">
            <LogOut className="h-5 w-5" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 pt-20 md:pt-8 overflow-y-auto" onClick={() => menuOpen && setMenuOpen(false)}>
        {children}
      </main>
    </div>
  );
}