"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Brain, Plus, Trash2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export default function FlashcardsPage() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [flippedId, setFlippedId] = useState<string | null>(null);

  useEffect(() => {
    fetchFlashcards();
  }, []);

  const fetchFlashcards = async () => {
    const res = await fetch("/api/flashcards");
    const data = await res.json();
    setFlashcards(data);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!front || !back) return;

    await fetch("/api/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front, back }),
    });

    setFront("");
    setBack("");
    fetchFlashcards();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/flashcards/${id}`, { method: "DELETE" });
    setFlashcards(flashcards.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Flashcards</h1>
        <p className="text-foreground/60">Create and review flashcards to memorize key concepts.</p>
      </div>

      <form onSubmit={handleCreate} className="card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" /> Create New Flashcard
        </h2>
        <Input
          placeholder="Front (Question/Term)"
          value={front}
          onChange={(e) => setFront(e.target.value)}
          required
        />
        <Input
          placeholder="Back (Answer/Definition)"
          value={back}
          onChange={(e) => setBack(e.target.value)}
          required
        />
        <Button type="submit">Add Flashcard</Button>
      </form>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Your Flashcards ({flashcards.length})</h2>
        {flashcards.length === 0 ? (
          <p className="text-foreground/40 text-center py-8">No flashcards yet. Create one to start studying!</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {flashcards.map((card) => (
              <div
                key={card.id}
                className="group relative h-48 perspective-[1000px]"
                onClick={() => setFlippedId(flippedId === card.id ? null : card.id)}
              >
                <div
                  className={cn(
                    "absolute inset-0 rounded-lg border border-border p-4 transition-transform duration-500 [transform-style:preserve-3d]",
                    flippedId === card.id && "[transform:rotateY(180deg)]"
                  )}
                >
                  {/* Front */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 [backface-visibility:hidden]">
                    <Brain className="h-6 w-6 text-primary mb-2" />
                    <p className="text-center font-medium">{card.front}</p>
                    <p className="absolute bottom-2 text-xs text-foreground/40 flex items-center gap-1">
                      <RotateCw className="h-3 w-3" /> Click to flip
                    </p>
                  </div>
                  {/* Back */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-accent p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                    <p className="text-center text-sm text-foreground/80">{card.back}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(card.id); }}
                  className="absolute right-2 top-2 z-10 text-foreground/30 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}