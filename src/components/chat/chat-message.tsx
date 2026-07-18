"use client";

import { cn } from "@/lib/utils";
import { User, Bot, Check, Copy, Volume2, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState, useEffect } from "react";
import remarkGfm from "remark-gfm";

interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

const MermaidRenderer = ({ code }: { code: string }) => {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    const fetchDiagram = async () => {
      try {
        const res = await fetch(`https://mermaid.ink/svg/${btoa(code)}`);
        if (res.ok) {
          const text = await res.text();
          setSvg(text);
        }
      } catch (e) {
        console.error("Failed to render diagram");
      }
    };
    fetchDiagram();
  }, [code]);

  if (svg) {
    return <div className="my-4 flex justify-center bg-white p-4 rounded-lg overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return <pre className="my-4 p-4 bg-accent rounded-lg overflow-x-auto"><code>{code}</code></pre>;
};

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Clean up markdown so the voice sounds natural
  const cleanTextForSpeech = (text: string) => {
    return text
      .replace(/```[a-zA-Z]*\n?|\n```/g, ' ') // remove code block ticks
      .replace(/`([^`]*)`/g, '$1') // remove inline code ticks
      .replace(/[*_#>]/g, '') // remove markdown symbols
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // read link text instead of url
      .replace(/\n/g, '. '); // pause at line breaks
  };

  const handleSpeak = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      } else {
        const utterance = new SpeechSynthesisUtterance(cleanTextForSpeech(content));
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
      }
    }
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
      <div className="flex-1 overflow-hidden min-w-0" style={{ maxWidth: "calc(100% - 48px)" }}>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-semibold font-mono">{isIncoming ? "CS Hub AI" : "You"}</span>
          {isIncoming && !isStreaming && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/40 hover:text-primary"
                title="Copy text"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
              <button
                onClick={handleSpeak}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/40 hover:text-primary"
                title={isSpeaking ? "Stop speaking" : "Read aloud"}
              >
                {isSpeaking ? <Square className="h-3 w-3" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>
        
        {/* LIVE SEARCH STEPS UI */}
        {searchSteps && searchSteps.length > 0 && (
          <div className="mb-4 p-3 border border-border rounded-lg bg-accent/20 space-y-2">
            <p className="text-xs text-primary/80 font-mono flex items-center gap-2 mb-2">
              <Search className="h-3 w-3 animate-pulse" /> Searching Live Web...
            </p>
            {searchSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-foreground/70 font-mono">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                {step}
              </div>
            ))}
            {isStreaming && content === "" && (
              <p className="text-xs text-foreground/50 font-mono animate-pulse mt-2">Synthesizing answer...</p>
            )}
          </div>
        )}

        <div
          className={cn(
            "prose prose-invert max-w-none text-sm leading-relaxed font-mono break-words",
            isStreaming && "typing-cursor"
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const codeString = String(children).replace(/\n$/, "");
                
                if (match && match[1] === "mermaid") {
                  return <MermaidRenderer code={codeString} />;
                }

                if (!inline && match) {
                  return (
                    <div className="my-4 overflow-hidden rounded-md border border-border bg-accent/50">
                      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-foreground/60 font-mono">
                        <span>{match[1]}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(codeString)}
                          className="hover:text-primary font-mono"
                        >
                          Copy code
                        </button>
                      </div>
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        className="!bg-transparent !text-sm font-mono"
                        {...props}
                      >
                        {codeString}
                      </SyntaxHighlighter>
                    </div>
                  );
                }
                
                return (
                  <code className="rounded bg-accent px-1 py-0.5 text-primary font-mono" {...props}>
                    {children}
                  </code>
                );
              },
              img({ node, ...props }) {
                return <img alt="AI Generated" className="max-w-full h-auto rounded-lg my-4 border border-border" {...props} />;
              },
              table({ node, ...props }) {
                return (
                  <div className="my-4 w-full max-w-full">
                    <p className="md:hidden text-xs text-primary/60 mb-2 text-center animate-pulse font-mono">
                      ↔ Swipe horizontally to view full table ↔
                    </p>
                    <div className="overflow-x-auto max-w-full rounded-md border border-border bg-accent/20">
                      <table className="w-full max-w-full border-collapse" {...props} />
                    </div>
                  </div>
                );
              },
              thead({ node, ...props }) {
                return <thead className="sticky top-0 z-10 bg-accent" {...props} />;
              },
              th({ node, ...props }) {
                return <th className="border border-border p-3 text-left whitespace-nowrap text-xs sm:text-sm" {...props} />;
              },
              td({ node, ...props }) {
                return <td className="border border-border p-3 break-words whitespace-normal text-xs sm:text-sm align-top" {...props} />;
              }
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}