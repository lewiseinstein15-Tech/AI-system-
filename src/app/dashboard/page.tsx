"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BookOpen, Brain, FileText, TrendingUp, Calendar } from "lucide-react";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState({ notes: 0, chats: 0, assignments: 0 });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (session) {
      // In a real app, fetch stats from /api/dashboard/stats
      setStats({ notes: 12, chats: 34, assignments: 4 });
    }
  }, [session, status, router]);

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-primary">Dashboard</h1>
          <p className="text-foreground/60">Welcome back, {session?.user?.name}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60">Saved Notes</h3>
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold">{stats.notes}</p>
          </div>
          
          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60">AI Chats</h3>
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold">{stats.chats}</p>
          </div>

          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60">Assignments</h3>
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold">{stats.assignments}</p>
          </div>

          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60">Progress</h3>
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold">78%</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-4 text-lg font-semibold">Recent Activity</h3>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border pb-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm">Completed Data Structures Quiz</p>
                    <p className="text-xs text-foreground/40">2 hours ago</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-4 text-lg font-semibold">Recommended Topics</h3>
            <div className="space-y-3">
              {["Dynamic Programming", "Neural Networks", "System Design", "Graph Algorithms"].map((topic) => (
                <div key={topic} className="cursor-pointer rounded-md border border-border p-3 hover:border-primary hover:bg-primary/5 transition-all">
                  <p className="text-sm font-medium">{topic}</p>
                  <p className="text-xs text-foreground/40">Recommended for you</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}