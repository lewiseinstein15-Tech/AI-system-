"use client";

import { useState, useEffect, useRef } from "react";
import { Sidebar } from "./sidebar";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Menu, X, Bot } from "lucide-react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export function ChatContainer() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string>(""); // Dedicated state for live status
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [typedWelcome, setTypedWelcome] = useState("");
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStatus]); // Scroll when status updates too

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      const role = session.user.role === "ADMIN" ? "Admin " : "";
      const name = session.user.name || "User";
      const fullText = `Welcome back, ${role}${name}...`;
      let index = 0;
      const timer = setInterval(() => {
        if (index < fullText.length) {
          setTypedWelcome((prev) => prev + fullText.charAt(index));
          index++;
        } else {
          clearInterval(timer);
        }
      }, 50);
      return () => clearInterval(timer);
    }
  }, [status, session]);

  const handleStreamResponse = async (response: Response) => {
    if (!response.ok) {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg) lastMsg.content = "Error: Unable to fetch response.";
        return newMessages;
      });
      setIsStreaming(false);
      setCurrentStatus("");
      return;
    }
    if (!response.body) {
      setIsStreaming(false);
      setCurrentStatus("");
      return;
    }

    const reader = response.body.getReader();
    // FIX: Added { stream: true } to prevent UTF-8/Emoji character corruption on chunk boundaries
    const decoder = new TextDecoder();
    let assistantContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.replace("data: ", "").trim();
          if (data === "[DONE]") {
            setIsStreaming(false);
            setCurrentStatus("");
            break;
          }

          try {
            const parsed = JSON.parse(data);

            // FIX: Update dedicated status state instead of overwriting msg.content
            if (parsed.status) {
              setCurrentStatus(parsed.status);
            }

            if (parsed.choices?.[0]?.delta?.content) {
              const token = parsed.choices[0].delta.content;
              assistantContent += token;
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg && lastMsg.role === "assistant") {
                  lastMsg.content = assistantContent;
                }
                return newMessages;
              });
            }

            if (parsed.audioBase64) {
              const audio = new Audio(`data:audio/mp3;base64,${parsed.audioBase64}`);
              audio.play().catch((e) => console.error("Audio play failed:", e));
            }
          } catch (e) {
            // Ignore JSON parse errors on empty lines or incomplete chunks
          }
        }
      }
    }

    setIsStreaming(false);
    setCurrentStatus("");
  };

  const handleSend = async (message: string) => {
    if (!session) return;

    const newUserMessage: Message = { role: "user", content: message };
    
    // FIX: Explicitly define the history to send to prevent React stale closure bugs
    const messagesToSend = [...messages, newUserMessage];
    
    setMessages((prev) => [...prev, newUserMessage, { role: "assistant", content: "" }]);
    setIsStreaming(true);
    setCurrentStatus("🧠 Initializing...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: messagesToSend, 
          conversationId,
          mode: "text" 
        }),
      });

      await handleStreamResponse(response);
    } catch (error) {
      console.error("Chat Error:", error);
      setIsStreaming(false);
      setCurrentStatus("");
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined" && status === "authenticated" && !hasInitialized) {
      const params = new URLSearchParams(window.location.search);
      const prompt = params.get('prompt');
      if (prompt) {
        setHasInitialized(true);
        // FIX: Clean the URL so refreshing the page doesn't re-trigger the prompt
        window.history.replaceState({}, document.title, window.location.pathname);
        handleSend(prompt);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, hasInitialized]);

  const handleSelectConversation = async (id: string) => {
    setConversationId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (data && Array.isArray(data.messages)) {
        setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
      }
      setMobileSidebarOpen(false);
    } catch (e) {
      console.error("Failed to load conversation");
    }
  };

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-primary font-mono">Loading Noctryx AI...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-transparent text-foreground">
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setMobileSidebarOpen(false)} />
      )}
      
      <div className={`fixed md:relative z-40 h-full transition-transform duration-300 ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <Sidebar onConversationSelect={handleSelectConversation} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-border p-4 md:hidden flex items-center justify-between">
          <button onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}>
            {mobileSidebarOpen ? <X className="h-6 w-6 text-primary" /> : <Menu className="h-6 w-6 text-primary" />}
          </button>
          <h1 className="text-lg font-bold text-primary font-mono">Noctryx AI</h1>
          <div className="w-6"></div>
        </header>
        
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto max-w-3xl py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                </div>
                <h2 className="text-2xl font-bold font-mono">Noctryx AI</h2>
                <p className="max-w-md text-primary/80 typing-cursor h-6 font-mono">{typedWelcome}</p>
              </div>
            ) : (
              messages.map((msg, i) => {
                // FIX: Use currentStatus to show elegant live updates instead of generic "Thinking..."
                const isThinking = isStreaming && i === messages.length - 1 && msg.role === "assistant" && msg.content === "";
                
                if (isThinking) {
                  return (
                    <div key={i} className="group flex gap-4 px-4 py-6 sm:px-6 bg-transparent">
                      <div className="flex-shrink-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                          <Bot className="h-5 w-5" />
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-semibold font-mono">Noctryx AI</span>
                        </div>
                        <span className="text-sm font-mono text-primary animate-pulse">
                          {currentStatus || "Thinking..."}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <ChatMessage
                    key={i}
                    role={msg.role}
                    content={msg.content}
                    isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                  />
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        <ChatInput 
          onSend={handleSend} 
          disabled={isStreaming} 
        />
      </div>
    </div>
  );
}