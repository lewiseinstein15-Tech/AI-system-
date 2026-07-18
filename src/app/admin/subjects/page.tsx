"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookMarked, Plus, Trash2 } from "lucide-react";

interface Subject {
  id: string;
  name: string;
  description: string | null;
  _count?: { units: number; notes: number; pdfs: number };
}

export default function AdminSubjectsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (session && session.user?.role !== "ADMIN") router.push("/unauthorized");
    fetchSubjects();
  }, [session, status, router]);

  const fetchSubjects = async () => {
    const res = await fetch("/api/subjects");
    const data = await res.json();
    setSubjects(data);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/subjects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setName("");
    setDescription("");
    fetchSubjects();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/subjects/${id}`, { method: "DELETE" });
    setSubjects(subjects.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary font-mono">Manage Subjects</h1>
        <p className="text-foreground/60 font-mono">Add or remove academic subjects from the platform.</p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2 font-mono">
          <Plus className="h-5 w-5 text-primary" /> Add New Subject
        </h2>
        <Input
          placeholder="Subject Name (e.g., Data Structures)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="font-mono"
        />
        <Input
          placeholder="Short Description (Optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="font-mono"
        />
        <Button type="submit">Create Subject</Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold font-mono">Existing Subjects</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {subjects.map((subject) => (
            <div key={subject.id} className="card group relative">
              <button
                onClick={() => handleDelete(subject.id)}
                className="absolute right-4 top-4 text-foreground/30 hover:text-red-500 transition-colors z-10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="flex items-start gap-3">
                <BookMarked className="h-6 w-6 text-primary mt-1" />
                <div className="flex-1 pr-8">
                  <h3 className="font-semibold text-lg font-mono">{subject.name}</h3>
                  <p className="text-sm text-foreground/60 mt-1 font-mono">{subject.description || "No description provided."}</p>
                  <div className="flex gap-4 mt-3 text-xs text-foreground/40 font-mono">
                    <span>{subject._count?.units || 0} Units</span>
                    <span>{subject._count?.notes || 0} Notes</span>
                    <span>{subject._count?.pdfs || 0} PDFs</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}