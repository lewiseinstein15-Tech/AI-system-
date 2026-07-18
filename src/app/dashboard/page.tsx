"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BookOpen, Brain, FileText, Layers, Calendar, Loader2 } from "lucide-react";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState({ notes: 0, chats: 0, assignments: 0, flashcards: 0 });
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    
    const fetchDashboardData = async () => {
      if (session) {
        try {
          const [notesRes, chatsRes, assignRes, flashRes] = await Promise.all([
            fetch("/api/notes"),
            fetch("/api/conversations"),
            fetch("/api/assignments"),
            fetch("/api/flashcards")
          ]);

          const notesData = await notesRes.json();
          const chatsData = await chatsRes.json();
          const assignData = await assignRes.json();
          const flashData = await flashRes.json();

          setStats({
            notes: notesData.length || 0,
            chats: chatsData.length || 0,
            assignments: assignData.length || 0,
            flashcards: flashData.length || 0
          });

          const activity = [
            ...notesData.map((n: any) => ({ type: "Note", title: n.title, date: n.updatedAt })),
            ...assignData.map((a: any) => ({ type: "Assignment", title: a.title, date: a.dueDate }))
          ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3);

          setRecentActivity(activity);
        } catch (error) {
          console.error("Failed to fetch dashboard data", error);
        } finally {
          setIsLoading(false); // Stop loading spinner
        }
      }
    };

    fetchDashboardData();
  }, [session, status, router]);

  const handleTopicClick = (topic: string) => {
    router.push(`/?prompt=${encodeURIComponent("Give me a comprehensive overview of " + topic + " with examples.")}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <p className="text-primary font-mono animate-pulse">Loading Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-primary font-mono">Dashboard</h1>
          <p className="text-foreground/60 font-mono">Welcome back, {session?.user?.name}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60 font-mono">Saved Notes</h3>
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold font-mono text-primary">{stats.notes}</p>
          </div>
          
          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60 font-mono">AI Chats</h3>
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold font-mono text-primary">{stats.chats}</p>
          </div>

          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60 font-mono">Assignments</h3>
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold font-mono text-primary">{stats.assignments}</p>
          </div>

          <div className="card hover:border-primary transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground/60 font-mono">Flashcards</h3>
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <p className="text-3xl font-bold font-mono text-primary">{stats.flashcards}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-4 text-lg font-semibold font-mono text-primary">Recent Activity</h3>
            <div className="space-y-4">
              {recentActivity.length === 0 ? (
                <p className="text-foreground/40 text-sm font-mono">No recent activity yet. Create a note or assignment!</p>
              ) : (
                recentActivity.map((activity, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-border pb-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-mono">{activity.title}</p>
                      <p className="text-xs text-foreground/40 font-mono">{activity.type} - {new Date(activity.date).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-4 text-lg font-semibold font-mono text-primary">Recommended Topics</h3>
            <div className="space-y-3">
              {["Dynamic Programming", "Neural Networks", "System Design", "Graph Algorithms"].map((topic) => (
                <div 
                  key={topic} 
                  onClick={() => handleTopicClick(topic)}
                  className="cursor-pointer rounded-md border border-border p-3 hover:border-primary hover:bg-primary/5 transition-all"
                >
                  <p className="text-sm font-medium font-mono">{topic}</p>
                  <p className="text-xs text-foreground/40 font-mono">Tap to learn this topic</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}