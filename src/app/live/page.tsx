"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Image, Zap } from "lucide-react";

const LOOP_INTERVAL_MS = 4000;

export default function LivePage() {
  const [liveQuestion, setLiveQuestion] = useState("What do you see?");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [caption, setCaption] = useState("Point your camera at something and tap Start Live.");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const isLoopingRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    startCamera();
    return () => {
      stopLoop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraReady(true);
      setErrorMsg(null);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err: any) {
      console.error("Camera error:", err);
      setErrorMsg("Camera access was denied or unavailable. Please allow camera permission and reload.");
      setCameraReady(false);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7);
  };

  const playAudio = (base64: string) => {
    try {
      if (audioElRef.current) {
        audioElRef.current.pause();
      }
      const audio = new Audio(`data:audio/mp3;base64,${base64}`);
      audioElRef.current = audio;
      audio.play().catch((e) => console.error("Audio play failed:", e));
    } catch (e) {
      console.error("Audio setup failed:", e);
    }
  };

  const analyzeOnce = useCallback(async () => {
    const frame = captureFrame();
    if (!frame) return;

    setIsAnalyzing(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: liveQuestion }],
          mode: "live",
          imageBase64: frame.split(",")[1],
          conversationId: conversationIdRef.current,
        }),
      });

      if (response.status === 401) {
        setErrorMsg("Your session has expired. Please log in again.");
        stopLoop();
        return;
      }

      if (!response.ok || !response.body) {
        setErrorMsg(`Server error (${response.status}). Please try again.`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let audioB64 = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.choices?.[0]?.delta?.content) {
              fullText += parsed.choices[0].delta.content;
            }
            if (parsed.audioBase64) {
              audioB64 = parsed.audioBase64;
            }
            if (parsed.conversationId) {
              conversationIdRef.current = parsed.conversationId;
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }

      if (fullText) {
        setCaption(fullText.trim());
      }
      if (audioB64) {
        playAudio(audioB64);
      }
    } catch (error: any) {
      console.error("Live analysis failed:", error);
      setErrorMsg("Analysis failed. Check your connection and try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [liveQuestion]);

  const startLoop = () => {
    if (isLoopingRef.current) return;
    isLoopingRef.current = true;
    setIsLooping(true);

    const tick = async () => {
      if (!isLoopingRef.current) return;
      await analyzeOnce();
      if (isLoopingRef.current) {
        loopTimerRef.current = setTimeout(tick, LOOP_INTERVAL_MS);
      }
    };
    tick();
  };

  const stopLoop = () => {
    isLoopingRef.current = false;
    setIsLooping(false);
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
  };

  const toggleLoop = () => {
    if (isLooping) {
      stopLoop();
      setCaption("Live analysis stopped.");
    } else {
      startLoop();
    }
  };

  const goBack = () => {
    stopLoop();
    stopCamera();
    router.back();
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between p-4 border-b border-border">
        <button
          onClick={goBack}
          className="p-2 text-primary hover:bg-accent rounded-lg transition-colors"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold text-primary font-mono">
            Noctryx Live
          </h1>
          <p className="text-xs text-foreground/60 font-mono">
            {isLooping ? "Live — analyzing continuously" : "Image Analyzer"}
          </p>
        </div>
        <div className="w-10"></div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
        <div className="relative w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden border-2 border-primary/30 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-primary"></div>
          <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary"></div>
          <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary"></div>
          <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-primary"></div>

          {isLooping && (
            <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/60 rounded-full px-2 py-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <span className="text-xs font-mono text-red-400">LIVE</span>
            </div>
          )}

          {!errorMsg && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-2">
              <p className="text-xs font-mono text-primary leading-snug">
                {isAnalyzing ? "🔍 Analyzing..." : caption}
              </p>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="w-full max-w-md mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
            <p className="text-xs font-mono text-red-400">{errorMsg}</p>
          </div>
        )}
      </div>

      <div className="px-4 pb-2">
        <div className="rounded-xl border border-primary/20 bg-accent/30 p-4">
          <h3 className="text-sm font-bold text-primary font-mono mb-2">
            How it works
          </h3>
          <ul className="space-y-1 text-xs text-foreground/70 font-mono">
            <li>• Tap "Start Live" for continuous real-time analysis every few seconds.</li>
            <li>• Or tap "Analyze" for a single one-off capture.</li>
            <li>• Responses are spoken aloud automatically.</li>
          </ul>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={liveQuestion}
            onChange={(e) => setLiveQuestion(e.target.value)}
            placeholder="What do you see?"
            className="flex-1 bg-accent border border-border rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:border-primary"
          />
          <button
            onClick={analyzeOnce}
            disabled={isAnalyzing || isLooping || !cameraReady}
            className="bg-primary text-black px-6 py-3 rounded-lg font-medium font-mono hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? "..." : "🔍 Analyze"}
          </button>
        </div>

        <div className="flex items-center justify-center gap-8">
          <button className="flex flex-col items-center gap-1 text-foreground/40 hover:text-primary transition-colors">
            <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center">
              <Image className="h-5 w-5" />
            </div>
            <span className="text-xs font-mono">Gallery</span>
          </button>
          <button
            onClick={toggleLoop}
            disabled={!cameraReady}
            className="flex flex-col items-center gap-1 disabled:opacity-50"
          >
            <div
              className={`w-16 h-16 rounded-full border-2 flex items-center justify-center ${
                isLooping ? "border-red-500 bg-red-500" : "border-primary bg-white"
              }`}
            >
              <div
                className={`rounded-full ${
                  isLooping ? "w-6 h-6 bg-white" : "w-12 h-12 bg-white"
                }`}
              ></div>
            </div>
            <span className={`text-xs font-mono ${isLooping ? "text-red-400" : "text-primary"}`}>
              {isLooping ? "Stop Live" : "Start Live"}
            </span>
          </button>
          <button className="flex flex-col items-center gap-1 text-foreground/40 hover:text-primary transition-colors">
            <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-xs font-mono">Flash</span>
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}