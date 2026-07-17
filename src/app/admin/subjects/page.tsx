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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Manage Subjects</h1>
        <p className="text-foreground/60">Add or remove academic subjects from the platform.</p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" /> Add New Subject
        </h2>
        <Input
          placeholder="Subject Name (e.g., Data Structures)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          placeholder="Short Description (Optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit">Create Subject</Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Existing Subjects</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {subjects.map((subject) => (
            <div key={subject.id} className="card group">
              <div className="flex items-start gap-3">
                <BookMarked className="h-6 w-6 text-primary mt-1" />
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{subject.name}</h3>
                  <p className="text-sm text-foreground/60 mt-1">{subject.description || "No description provided."}</p>
                  <div className="flex gap-4 mt-3 text-xs text-foreground/40">
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