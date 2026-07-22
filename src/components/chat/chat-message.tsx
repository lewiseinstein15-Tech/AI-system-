"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`group flex gap-4 px-4 py-6 sm:px-6 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-hidden ${isUser ? "max-w-[85%]" : ""}`}>
        {!isUser && (
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold font-mono text-primary">Noctryx AI</span>
          </div>
        )}

        <div className={`prose prose-invert max-w-none font-mono text-sm ${isUser ? "bg-primary/10 rounded-lg p-3" : ""}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h3: ({ node, ...props }) => (
                <h3 className="text-lg font-bold text-primary mb-2 mt-4" {...props} />
              ),
              h2: ({ node, ...props }) => (
                <h2 className="text-xl font-bold text-primary mb-2 mt-4" {...props} />
              ),
              ul: ({ node, ...props }) => (
                <ul className="list-disc list-inside my-2 space-y-1" {...props} />
              ),
              ol: ({ node, ...props }) => (
                <ol className="list-decimal list-inside my-2 space-y-1" {...props} />
              ),
              li: ({ node, ...props }) => (
                <li className="text-foreground/90" {...props} />
              ),
              strong: ({ node, ...props }) => (
                <strong className="font-bold text-primary" {...props} />
              ),
              p: ({ node, ...props }) => (
                <p className="mb-2 text-foreground/90 leading-relaxed" {...props} />
              ),
              code: ({ node, inline, ...props }: any) =>
                inline ? (
                  <code className="bg-primary/10 px-1 py-0.5 rounded text-primary font-mono" {...props} />
                ) : (
                  <code className="block bg-primary/10 p-3 rounded my-2 overflow-x-auto" {...props} />
                ),
            }}
          >
            {content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/20">
            <User className="h-5 w-5" />
          </div>
        </div>
      )}
    </div>
  );
}