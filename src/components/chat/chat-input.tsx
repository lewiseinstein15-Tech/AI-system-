"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput("");
    setFileName("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const fileContent = event.target?.result as string;
      // Append file content to the input box so the AI can read it
      setInput(prev => `${prev}\n\n[Attached File: ${file.name}]\n${fileContent}`.trim());
    };
    // Reads text files, code files, etc.
    reader.readAsText(file); 
  };

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-md">
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-end gap-2 p-4">
        <div className="flex flex-1 items-center rounded-lg border border-border bg-accent focus-within:ring-2 focus-within:ring-primary transition-all">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-foreground/40 hover:text-primary transition-colors">
            <Paperclip className="h-5 w-5" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
            accept=".txt,.js,.ts,.tsx,.py,.java,.c,.cpp,.md,.json" 
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={fileName ? `Attached: ${fileName}` : "Ask anything about Computer Science..."}
            rows={1}
            className="flex-1 resize-none bg-transparent py-3 text-sm focus:outline-none max-h-40"
            disabled={disabled}
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
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