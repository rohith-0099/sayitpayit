"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mic recorder with a live level meter and auto-stop after a pause.
 * Click to start; it stops by itself ~1.3s after you finish speaking (or call stop()).
 */
export function useRecorder(onAudio: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0); // 0..1, drives the mic ring
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const onAudioRef = useRef(onAudio);
  const discard = useRef(false);
  const heard = useRef(false);
  useEffect(() => {
    onAudioRef.current = onAudio;
  }, [onAudio]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  /** Stop and throw the audio away (e.g. the user tapped Yes instead of speaking). */
  const cancel = useCallback(() => {
    discard.current = true;
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    discard.current = false;
    heard.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Microphone blocked. Allow mic access for this site, or type your command instead.");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let heardSpeech = false;
    let lastLoud = performance.now();
    let raf = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 12));
      const now = performance.now();
      if (rms > 0.02) {
        heardSpeech = true;
        heard.current = true;
        lastLoud = now;
      }
      // Auto-stop: 1.3s of quiet after speech, or 15s max.
      if ((heardSpeech && now - lastLoud > 1300) || now - startedAt > 15000) return stop();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    cleanup.current = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      setLevel(0);
    };
    r.onstop = () => {
      cleanup.current();
      setRecording(false);
      if (discard.current) return;
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      // Never send silence: Whisper tends to invent text for it.
      if (heard.current && blob.size > 2000) onAudioRef.current(blob);
      else setError("I didn't catch that. Tap the mic and try again.");
    };
    rec.current = r;
    r.start();
    setRecording(true);
  }, [stop]);

  useEffect(() => () => cleanup.current(), []);
  return { recording, level, error, start, stop, cancel };
}
