"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Plus, Trash2 } from "lucide-react";

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    const res = await fetch("/api/notes");
    const data = await res.json();
    setNotes(data);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) return;

    await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });

    setTitle("");
    setContent("");
    fetchNotes();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setNotes(notes.filter((n) => n.id !== id));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">My Notes</h1>
        <p className="text-foreground/60">Create and manage your personal study notes.</p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" /> Create New Note
        </h2>
        <Input
          placeholder="Note Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <textarea
          placeholder="Write your note content here... (Markdown supported)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          className="flex w-full rounded-md border border-border bg-accent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          required
        />
        <Button type="submit">Save Note</Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Saved Notes</h2>
        {notes.length === 0 ? (
          <p className="text-foreground/40 text-center py-8">No notes yet. Create one above!</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {notes.map((note) => (
              <div key={note.id} className="card group relative">
                <button
                  onClick={() => handleDelete(note.id)}
                  className="absolute right-4 top-4 text-foreground/30 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <div className="flex items-start gap-3">
                  <BookOpen className="h-5 w-5 text-primary mt-1" />
                  <div className="overflow-hidden">
                    <h3 className="font-semibold truncate">{note.title}</h3>
                    <p className="text-sm text-foreground/60 line-clamp-3 mt-1">{note.content}</p>
                    <p className="text-xs text-foreground/40 mt-2">
                      Last updated: {new Date(note.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}