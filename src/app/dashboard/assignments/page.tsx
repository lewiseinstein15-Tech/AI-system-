"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, Plus } from "lucide-react";

interface Assignment {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  completed?: boolean; // Mock field for UI
}

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    fetchAssignments();
  }, []);

  const fetchAssignments = async () => {
    const res = await fetch("/api/assignments");
    const data = await res.json();
    setAssignments(data);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !dueDate) return;

    // Convert local date to ISO string
    const isoDate = new Date(dueDate).toISOString();

    await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, dueDate: isoDate }),
    });

    setTitle("");
    setDueDate("");
    fetchAssignments();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Assignments</h1>
        <p className="text-foreground/60">Track your upcoming assignments and deadlines.</p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" /> Add Assignment
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            placeholder="Assignment Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            className="cursor-pointer"
          />
        </div>
        <Button type="submit">Add to Tracker</Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Upcoming Deadlines</h2>
        {assignments.length === 0 ? (
          <p className="text-foreground/40 text-center py-8">No assignments tracked yet.</p>
        ) : (
          <div className="space-y-3">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="card flex items-center gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{assignment.title}</h3>
                  {assignment.description && <p className="text-sm text-foreground/60">{assignment.description}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-foreground/40">Due Date</p>
                  <p className="text-sm font-medium text-red-400">
                    {new Date(assignment.dueDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}