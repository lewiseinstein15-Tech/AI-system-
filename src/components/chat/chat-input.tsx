"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, X, Mic, Square, Camera, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  onSendVoice?: (audioBase64: string, enableTTS: boolean) => void;
  onSendLive?: (imageBase64: string, question: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, onSendVoice, onSendLive, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileType, setFileType] = useState<"text" | "image">("text");
  const [isListening, setIsListening] = useState(false);
  
  // NEW: Voice recording state (for backend Whisper)
  const [isRecording, setIsRecording] = useState(false);
  const [enableTTS, setEnableTTS] = useState(false);
  
  // NEW: Noctryx Live (camera) state
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [liveQuestion, setLiveQuestion] = useState("What do you see?");
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  
  // NEW: Refs for voice recording and camera
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  // Setup Browser Voice Recognition (fallback)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInput(prev => prev + (prev ? " " : "") + transcript);
        };
        
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);
        
        recognitionRef.current = recognition;
      }
    }
  }, []);

  // ─── BROWSER MIC (fallback) ───
  const handleMicClick = () => {
    if (!recognitionRef.current) {
      alert("Voice input is not supported on this browser. Try using Chrome or Safari.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Mic error:", e);
      }
    }
  };

  // ─── BACKEND VOICE RECORDING (Whisper STT) ───
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          if (onSendVoice) {
            onSendVoice(base64, enableTTS);
          }
        };
        stream.getTracks().forEach(t => t.stop());
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  // ─── NOCTRYX LIVE (CAMERA) ───
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

  // ─── NORMAL TEXT SUBMIT ───
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !fileContent) || disabled) return;
    
    let finalMessage = input;
    if (fileContent) {
      if (fileType === "image") {
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

    if (file.size > 50000000) {
      alert("File is too large. Please upload a file smaller than 50MB.");
      return;
    }

    setFileName(file.name);

    const reader = new FileReader();
    if (file.type.startsWith("image/")) {
      setFileType("image");
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setFileContent(result);
      };
      reader.readAsDataURL(file);
    } else {
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
      {/* Hidden video and canvas for camera capture */}
      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Noctryx Live Camera Preview */}
      {isLiveMode && (
        <div className="mx-auto max-w-3xl px-4 pt-4">
          <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-black">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted
              className="w-full h-48 object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-3 flex items-center gap-2">
              <input
                type="text"
                value={liveQuestion}
                onChange={(e) => setLiveQuestion(e.target.value)}
                placeholder="Ask about what you see..."
                className="flex-1 bg-transparent text-white text-sm border border-white/20 rounded px-2 py-1 focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={captureAndSend}
                className="bg-primary text-black px-3 py-1 rounded text-sm font-medium hover:bg-primary/90"
              >
                🔍 Analyze
              </button>
              <button
                type="button"
                onClick={stopCamera}
                className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600"
              >
                ❌ Stop
              </button>
            </div>
          </div>
        </div>
      )}

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
            {/* File attachment */}
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
            
            {/* Text input */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "Listening..." : isRecording ? "Recording..." : "Ask anything..."}
              rows={1}
              className="flex-1 resize-none bg-transparent py-3 text-sm font-mono focus:outline-none max-h-40"
              disabled={disabled || isRecording}
            />
            
            {/* TTS Toggle */}
            <button
              type="button"
              onClick={() => setEnableTTS(!enableTTS)}
              title={enableTTS ? "AI will speak responses" : "Enable AI voice"}
              className={cn(
                "p-2 transition-colors",
                enableTTS ? "text-primary" : "text-foreground/40 hover:text-primary"
              )}
            >
              {enableTTS ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>

            {/* Noctryx Live (Camera) */}
            {!isLiveMode && onSendLive && (
              <button
                type="button"
                onClick={startCamera}
                title="Noctryx Live - Camera"
                className="p-2 text-foreground/40 hover:text-primary transition-colors"
              >
                <Camera className="h-5 w-5" />
              </button>
            )}

            {/* Backend Voice Recording (Whisper) - hold to record */}
            {onSendVoice && (
              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                onMouseLeave={() => isRecording && stopRecording()}
                title="Hold to record voice"
                className={cn(
                  "p-2 transition-colors select-none",
                  isRecording ? "text-red-500 animate-pulse" : "text-foreground/40 hover:text-primary"
                )}
              >
                {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            )}

            {/* Browser Voice Recognition (fallback) */}
            {!onSendVoice && (
              <button 
                type="button" 
                onClick={handleMicClick} 
                className={cn(
                  "p-2 transition-colors",
                  isListening ? "text-red-500 animate-pulse" : "text-foreground/40 hover:text-primary"
                )}
                title="Browser voice recognition"
              >
                {isListening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>
        
        {/* Send button */}
        <button
          type="submit"
          disabled={disabled || (!input.trim() && !fileContent) || isRecording}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
            disabled || (!input.trim() && !fileContent) || isRecording
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
