"use client";

import { useState, useRef, useEffect } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  onSendLive?: (imageBase64: string, question: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, onSendLive, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [liveQuestion, setLiveQuestion] = useState("What do you see?");
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      setCameraStream(stream);
      setIsLiveMode(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      alert("Camera access denied or not available");
    }
  };

  const stopCamera = () => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setIsLiveMode(false);
  };

  const captureAndSend = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (!onSendLive) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0);
    
    const base64Image = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    onSendLive(base64Image, liveQuestion);
    stopCamera();
  };

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

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-md">
      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {isLiveMode && (
        <div className="mx-auto max-w-3xl px-4 pt-4">
          <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-48 object-cover" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-3 flex items-center gap-2">
              <input
                type="text"
                value={liveQuestion}
                onChange={(e) => setLiveQuestion(e.target.value)}
                placeholder="Ask about what you see..."
                className="flex-1 bg-transparent text-white text-sm border border-white/20 rounded px-2 py-1 focus:outline-none focus:border-primary"
              />
              <button onClick={captureAndSend} className="bg-primary text-black px-3 py-1 rounded text-sm font-medium hover:bg-primary/90">
                🔍 Analyze
              </button>
              <button onClick={stopCamera} className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600">
                ❌ Stop
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl p-4">
        <div className="flex items-center rounded-lg border border-border bg-accent focus-within:ring-2 focus-within:ring-primary transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about..."
            rows={1}
            className="flex-1 resize-none bg-transparent px-3 py-3 text-sm font-mono focus:outline-none max-h-40"
            disabled={disabled}
          />
          
          {!isLiveMode && onSendLive && (
            <button
              type="button"
              onClick={startCamera}
              className="flex flex-col items-center justify-center px-3 py-2 text-foreground/40 hover:text-primary transition-colors"
            >
              <Camera className="h-5 w-5" />
              <span className="text-[10px] text-primary font-mono mt-0.5">Noctryx Live</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
