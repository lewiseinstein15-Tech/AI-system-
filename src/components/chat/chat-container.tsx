"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "./sidebar";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Menu, X } from "lucide-react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export function ChatContainer() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (message: string) => {
    if (!session) return;

    const newUserMessage: Message = { role: "user", content: message };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, newUserMessage],
          conversationId,
        }),
      });

      if (!response.ok) throw new Error("API Error");
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.replace("data: ", "");
          if (data === "[DONE]") break;

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content || "";
            if (token) {
              assistantContent += token;
              setMessages((prev) => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                  role: "assistant",
                  content: assistantContent,
                };
                return newMessages;
              });
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: Unable to fetch response." },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSelectConversation = async (id: string) => {
    setConversationId(id);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
    setMobileSidebarOpen(false);
  };

  // FIX: If the app is checking login status, show a Loading screen instead of the chat page.
  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-primary font-mono">Loading CS Hub AI...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setMobileSidebarOpen(false)} />
      )}
      
      <div className={`fixed md:relative z-40 h-full transition-transform duration-300 ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <Sidebar onConversationSelect={handleSelectConversation} />
      </div>

      <div className="flex flex-1 flex-col">
        <header className="border-b border-border p-4 md:hidden flex items-center justify-between">
          <button onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}>
            {mobileSidebarOpen ? <X className="h-6 w-6 text-primary" /> : <Menu className="h-6 w-6 text-primary" />}
          </button>
          <h1 className="text-lg font-bold text-primary">CS Hub AI</h1>
          <div className="w-6"></div>
        </header>
        
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                </div>
                <h2 className="text-2xl font-bold">Computer Science Hub AI</h2>
                <p className="max-w-md text-foreground/60">
                  Ask me anything about algorithms, data structures, programming languages, mathematics, and more.
                </p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
}