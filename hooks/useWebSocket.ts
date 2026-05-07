/**
 * useWebSocket — AssemblyAI WebSocket connection lifecycle + auto-reconnect
 *
 * Responsibilities:
 *   - Open WS connection with params (keyterms, speech model, diarization)
 *   - Send Configure message (max_turn_silence) after open
 *   - Exponential backoff auto-reconnect (max 3 attempts)
 *   - Clean disconnect with Terminate message
 */
'use client';

import { useRef, useCallback } from 'react';
import { DOMAIN_KEYTERMS } from '@/lib/constants';
import type { AudioPipeline } from '@/lib/audioCapture';

const MAX_RECONNECT = 3;

export interface SessionContext {
  prompt?: string;
  keyterms?: string[];
}

export interface WebSocketHook {
  wsRef: React.MutableRefObject<WebSocket | null>;
  connect: (token: string) => Promise<WebSocket>;
  disconnect: () => void;
}

export function useWebSocket({
  capabilitiesRef,
  sessionContextRef,
  onMessage,
  onStatusChange,
  audioPipelineRef,
}: {
  capabilitiesRef: React.MutableRefObject<Record<string, boolean>>;
  sessionContextRef: React.MutableRefObject<SessionContext | null>;
  onMessage: (msg: Record<string, unknown>) => void;
  onStatusChange: (status: string) => void;
  audioPipelineRef: React.MutableRefObject<AudioPipeline | null>;
}): WebSocketHook {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);

  const buildWsParams = useCallback(
    (token: string): URLSearchParams => {
      const wsPrompt =
        sessionContextRef.current?.prompt ??
        'Technical job interview between two speakers. Speakers may pause mid-question.';
      const wsParams = new URLSearchParams({
        token,
        sample_rate: '16000',
        speech_model: 'u3-rt-pro',
        language_detection: 'true',
        speaker_labels: 'true',
        max_speakers: '2',
        prompt: wsPrompt,
      });

      if (capabilitiesRef.current.keyterms) {
        const dynamicTerms = sessionContextRef.current?.keyterms ?? [];
        const allTerms = [...new Set([...dynamicTerms, ...DOMAIN_KEYTERMS])];
        if (allTerms.length > 0) {
          wsParams.append('keyterms_prompt', JSON.stringify(allTerms));
          console.log(`[ws] Keyterms ENABLED: ${allTerms.length} terms`);
        }
      }
      return wsParams;
    },
    [capabilitiesRef, sessionContextRef]
  );

  const sendConfigure = (wsInstance: WebSocket) => {
    wsInstance.send(
      JSON.stringify({ type: 'UpdateConfiguration', max_turn_silence: 2000, min_turn_silence: 300 })
    );
    console.log('[ws] Sent UpdateConfiguration: max_turn_silence=2000, min_turn_silence=300');
  };

  const connect = useCallback(
    (token: string): Promise<WebSocket> => {
      return new Promise((resolve, reject) => {
        try {
          const wsParams = buildWsParams(token);
          const ws = new WebSocket(
            `wss://streaming.assemblyai.com/v3/ws?${wsParams.toString()}`
          );
          wsRef.current = ws;

          ws.onopen = () => {
            isConnectedRef.current = true;
            reconnectAttemptsRef.current = 0;
            sendConfigure(ws);
            onStatusChange('listening');
            console.log('[ws] Connected');
            resolve(ws);
          };

          ws.onmessage = (event: MessageEvent) => {
            try {
              const msg = JSON.parse(event.data as string) as Record<string, unknown>;
              onMessage(msg);
            } catch (parseErr) {
              console.error('[ws] parse error:', parseErr);
            }
          };

          ws.onerror = () => {
            onStatusChange('error');
            reject(new Error('WebSocket connection error'));
          };

          ws.onclose = (closeEvent: CloseEvent) => {
            if (!isConnectedRef.current) return;
            const code = closeEvent?.code ?? 0;
            const reason = closeEvent?.reason ?? 'none';
            console.log(`[ws] CLOSED code=${code} reason=${reason}`);
            onStatusChange('disconnected');

            const NON_RECOVERABLE = [1008, 3006, 4001, 4002];
            if (NON_RECOVERABLE.includes(code)) {
              console.error(`[ws] Non-recoverable close (${code}). Not reconnecting.`);
              onStatusChange('error');
              return;
            }

            const attempt = reconnectAttemptsRef.current;
            if (attempt < MAX_RECONNECT) {
              const delayMs = Math.pow(2, attempt) * 1000;
              console.log(`[ws] Reconnect attempt ${attempt + 1}/${MAX_RECONNECT} in ${delayMs}ms...`);
              reconnectAttemptsRef.current = attempt + 1;
              reconnectTimerRef.current = setTimeout(async () => {
                try {
                  const tokenRes = await fetch('/api/token', { method: 'POST' });
                  const tokenData = (await tokenRes.json()) as { token?: string; error?: string };
                  if (!tokenRes.ok || !tokenData.token) throw new Error('Re-auth failed');

                  const reconParams = buildWsParams(tokenData.token);
                  const newWs = new WebSocket(
                    `wss://streaming.assemblyai.com/v3/ws?${reconParams.toString()}`
                  );
                  wsRef.current = newWs;
                  newWs.onopen = () => {
                    sendConfigure(newWs);
                    onStatusChange('listening');
                    console.log('[ws] Reconnected successfully!');
                    if (audioPipelineRef.current) audioPipelineRef.current.updateWs(newWs);
                  };
                  newWs.onmessage = ws.onmessage;
                  newWs.onerror = ws.onerror;
                  newWs.onclose = ws.onclose;
                } catch (reconnErr) {
                  console.error('[ws] Reconnect failed:', reconnErr);
                  onStatusChange('error');
                }
              }, delayMs);
            } else {
              console.error('[ws] Max reconnect attempts reached');
              onStatusChange('error');
            }
          };
        } catch (err) {
          reject(err);
        }
      });
    },
    [buildWsParams, onMessage, onStatusChange, audioPipelineRef]
  );

  const disconnect = useCallback(() => {
    isConnectedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    try {
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'Terminate' }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }
    } catch { /* ignore */ }
  }, []);

  return { wsRef, connect, disconnect };
}
