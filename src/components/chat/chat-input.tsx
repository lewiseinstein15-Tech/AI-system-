"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const goToLive = () => {
    router.push("/live");
  };

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-md p-4">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl flex items-end gap-2">
        <div className="flex flex-1 items-center rounded-xl border-2 border-primary bg-accent/50 focus-within:ring-2 focus-within:ring-primary/50 transition-all overflow-hidden">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm font-mono focus:outline-none max-h-40"
            disabled={disabled}
          />
          
          <button
            type="button"
            onClick={goToLive}
            className="flex flex-col items-center justify-center px-3 py-2 text-foreground/40 hover:text-primary transition-colors"
          >
            <Camera className="h-5 w-5" />
            <span className="text-[10px] text-primary font-mono mt-0.5">Noctryx Live</span>
          </button>
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200",
            disabled || !input.trim()
              ? "bg-accent text-foreground/30 cursor-not-allowed"
              : "bg-primary text-black hover:bg-primary/90 scale-105"
          )}
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
