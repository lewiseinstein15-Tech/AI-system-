"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Image, Zap } from "lucide-react";

export default function LivePage() {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [liveQuestion, setLiveQuestion] = useState("What do you see?");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const router = useRouter();

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraStream(stream);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraStream(null);
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0);

    const base64Image = canvas.toDataURL("image/jpeg", 0.8);
    setCapturedImage(base64Image);
    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: liveQuestion }],
          mode: "live",
          imageBase64: base64Image.split(",")[1],
        }),
      });

      if (response.ok) {
        router.push("/chat");
      }
    } catch (error) {
      console.error("Live analysis failed:", error);
      setIsAnalyzing(false);
    }
  };

  const goBack = () => {
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
            Image Analyzer
          </p>
        </div>
        <div className="w-10"></div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="relative w-full max-w-md aspect-[3/4] rounded-2xl overflow-hidden border-2 border-primary/30 bg-black">
          {!capturedImage ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={capturedImage}
              alt="Captured"
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-primary"></div>
          <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary"></div>
          <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary"></div>
          <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-primary"></div>
        </div>

        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="w-20 h-20 rounded-full border-2 border-primary/50 flex items-center justify-center bg-black/30">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#39FF14"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          </div>
        </div>
      </div>

      <div className="px-4 pb-2">
        <div className="rounded-xl border border-primary/20 bg-accent/30 p-4">
          <h3 className="text-sm font-bold text-primary font-mono mb-2">
            How it works
          </h3>
          <ul className="space-y-1 text-xs text-foreground/70 font-mono">
            <li>
              • Point your camera at text, diagrams, equations, or any image.
            </li>
            <li>• I will analyze and provide detailed insights.</li>
            <li>• Supports handwritten notes, charts, code, and more.</li>
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
            onClick={captureAndAnalyze}
            disabled={isAnalyzing}
            className="bg-primary text-black px-6 py-3 rounded-lg font-medium font-mono hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isAnalyzing ? "..." : "🔍 Analyze"}
          </button>
          <button
            onClick={goBack}
            className="bg-red-500 text-white px-6 py-3 rounded-lg font-medium font-mono hover:bg-red-600 transition-colors"
          >
            ❌ Stop
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
            onClick={captureAndAnalyze}
            className="flex flex-col items-center gap-1"
          >
            <div className="w-16 h-16 rounded-full border-2 border-primary bg-white flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-white"></div>
            </div>
            <span className="text-xs font-mono text-primary">Capture</span>
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