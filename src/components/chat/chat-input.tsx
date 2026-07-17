"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileType, setFileType] = useState<"text" | "image">("text");
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
    if ((!input.trim() && !fileContent) || disabled) return;
    
    let finalMessage = input;
    if (fileContent) {
      if (fileType === "image") {
        // Display the image in the chat using markdown syntax
        finalMessage = `${input}\n\n[Attached Image: ${fileName}]\n![Image](${fileContent})`.trim();
      } else {
        finalMessage = `${input}\n\n[Attached File: ${fileName}]\n${fileContent}`.trim();
      }
    }
    
    onSend(finalMessage);
    setInput("");
    setFileName("");
    setFileContent("");
    setFileType("text");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 50MB limit (50,000,000 bytes)
    if (file.size > 50000000) {
      alert("File is too large. Please upload a file smaller than 50MB.");
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    
    // If it's an image, read it as a Data URL so it can be displayed
    if (file.type.startsWith("image/")) {
      setFileType("image");
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setFileContent(result);
      };
      reader.readAsDataURL(file);
    } else {
      // Otherwise, read it as text (for .py, .js, .txt, etc.)
      setFileType("text");
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setFileContent(text);
      };
      reader.onerror = () => {
        alert("Could not read this file. Please upload text files or images.");
        setFileName("");
      };
      reader.readAsText(file); 
    }
  };

  const clearFile = () => {
    setFileName("");
    setFileContent("");
    setFileType("text");
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-md">
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-end gap-2 p-4">
        <div className="flex flex-1 flex-col gap-2">
          {fileName && (
            <div className="flex items-center justify-between bg-accent border border-primary/30 text-primary px-3 py-1.5 rounded-md text-xs font-mono">
              <span className="truncate">📎 {fileName}</span>
              <button type="button" onClick={clearFile} className="ml-2 text-foreground/60 hover:text-red-500">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          
          <div className="flex flex-1 items-center rounded-lg border border-border bg-accent focus-within:ring-2 focus-within:ring-primary transition-all">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-foreground/40 hover:text-primary transition-colors">
              <Paperclip className="h-5 w-5" />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept=".txt,.js,.ts,.tsx,.py,.java,.c,.cpp,.md,.json,.csv,.html,.css,image/*" 
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={fileName ? "Type a message about your file..." : "Ask anything about Computer Science..."}
              rows={1}
              className="flex-1 resize-none bg-transparent py-3 text-sm font-mono focus:outline-none max-h-40"
              disabled={disabled}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={disabled || (!input.trim() && !fileContent)}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
            disabled || (!input.trim() && !fileContent)
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