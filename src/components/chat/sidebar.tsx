"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Plus, Search, Trash2, Edit, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export function Sidebar({ onConversationSelect }: { onConversationSelect: (id: string) => void }) {
  const { data: session } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchConversations = async () => {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      setConversations(data);
    };
    if (session) fetchConversations();
  }, [session]);

  const handleDelete = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations(conversations.filter((c) => c.id !== id));
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-full w-72 flex-col border-r border-border bg-accent/20 backdrop-blur-sm">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-xl font-bold text-primary">CS Hub AI</h1>
        <Button variant="ghost" size="icon">
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
          <Input
            placeholder="Search chats..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {filteredConversations.map((conv) => (
          <div
            key={conv.id}
            className="group flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent cursor-pointer transition-colors"
            onClick={() => onConversationSelect(conv.id)}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <MessageSquare className="h-4 w-4 text-primary/70 flex-shrink-0" />
              <span className="truncate text-sm">{conv.title}</span>
            </div>
            <div className="hidden group-hover:flex items-center gap-1">
              <button className="p-1 hover:text-primary">
                <Edit className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(conv.id);
                }}
                className="p-1 hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-4">
        {session ? (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
              {session.user?.name?.[0] || "U"}
            </div>
            <div className="flex-1 truncate">
              <p className="text-sm font-medium">{session.user?.name}</p>
              <Link href="/dashboard" className="text-xs text-foreground/60 hover:text-primary">
                View Dashboard
              </Link>
            </div>
          </div>
        ) : (
          <Link href="/login">
            <Button className="w-full">Login</Button>
          </Link>
        )}
      </div>
    </div>
  );
}