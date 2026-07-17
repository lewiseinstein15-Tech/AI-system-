"use client";

import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isIncoming = role === "assistant";

  return (
    <div className={cn("group flex gap-4 px-4 py-6 sm:px-6", isIncoming ? "bg-transparent" : "bg-accent/30")}>
      <div className="flex-shrink-0">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border",
            isIncoming
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-accent text-foreground"
          )}
        >
          {isIncoming ? <Bot className="h-5 w-5" /> : <User className="h-5 w-5" />}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-semibold">{isIncoming ? "CS Hub AI" : "You"}</span>
          {isIncoming && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/40 hover:text-primary"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
        </div>
        <div
          className={cn(
            "prose prose-invert max-w-none text-sm leading-relaxed",
            isStreaming && "typing-cursor"
          )}
        >
          <ReactMarkdown
            components={{
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                return !inline && match ? (
                  <div className="my-4 overflow-hidden rounded-md border border-border bg-accent/50">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-foreground/60">
                      <span>{match[1]}</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(String(children))}
                        className="hover:text-primary"
                      >
                        Copy code
                      </button>
                    </div>
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      className="!bg-transparent !text-sm"
                      {...props}
                    >
                      {String(children).replace(/\n$/, "")}
                    </SyntaxHighlighter>
                  </div>
                ) : (
                  <code className="rounded bg-accent px-1 py-0.5 text-primary" {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}