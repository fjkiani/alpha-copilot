/**
 * ProfilerPanel — Real-time telemetry panel (P key to toggle)
 *
 * Shows:
 * - Conversation phase (with real-time keyword detection)
 * - Interviewer emotional state + exploit
 * - Campaign pillar scorecard
 * - Power dynamics
 * - Session heatmap (word frequency by speaker)
 * - Export profiler state as JSON
 */
'use client';

import { useCallback } from 'react';
import type { ProfilerState } from '@/lib/buildSystemPrompt';
import type { TranscriptEntry } from '@/hooks/useTranscriptProcessor';

const PHASE_COLORS: Record<string, string> = {
  opening:          'text-blue-400',
  rapport:          'text-blue-300',
  technical_shallow:'text-cyan-400',
  technical_deep:   'text-cyan-300',
  behavioral:       'text-purple-400',
  system_design:    'text-green-400',
  coding:           'text-green-300',
  closing:          'text-yellow-400',
  negotiation:      'text-orange-400',
  unknown:          'text-zinc-500',
};

const EMOTION_COLORS: Record<string, string> = {
  Stressed:     'text-red-400',
  Defensive:    'text-orange-400',
  Enthusiastic: 'text-green-400',
  Bored:        'text-zinc-500',
  Neutral:      'text-zinc-400',
};

function PillarRow({ pillar, deployed }: { pillar: string; deployed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs ${deployed ? 'text-green-400' : 'text-zinc-600'}`}>
        {deployed ? '✓' : '○'}
      </span>
      <span className={`text-xs ${deployed ? 'text-zinc-300' : 'text-zinc-600'} truncate`}>
        {pillar.split('—')[0].trim()}
      </span>
    </div>
  );
}

// Detect phase from transcript keywords (real-time, no 60s wait)
export function detectPhaseFromTranscript(transcripts: TranscriptEntry[]): string | null {
  if (transcripts.length === 0) return null;
  const recent = transcripts.slice(-5).map(t => t.text.toLowerCase()).join(' ');

  if (/write (a |the )?(function|code|algorithm|class)|implement|leetcode|time complexity|space complexity/.test(recent)) return 'coding';
  if (/design (a |the )?system|architect|scale to|millions of users|distributed|microservices/.test(recent)) return 'system_design';
  if (/tell me about a time|give me an example|describe a situation|how did you handle|biggest challenge/.test(recent)) return 'behavioral';
  if (/salary|compensation|offer|equity|rsu|base pay|total comp|competing offer/.test(recent)) return 'negotiation';
  if (/thank you|any questions for us|that's all|wrap up|next steps|timeline/.test(recent)) return 'closing';
  if (/walk me through|explain|how does|what is your approach|deep dive/.test(recent)) return 'technical_deep';
  return null;
}

export default function ProfilerPanel({
  profilerState,
  transcripts,
  sessionDurationSec,
  onExport,
}: {
  profilerState: ProfilerState | null;
  transcripts: TranscriptEntry[];
  sessionDurationSec: number;
  onExport: () => void;
}) {
  const phase = profilerState?.conversation_phase ?? detectPhaseFromTranscript(transcripts) ?? 'unknown';
  const phaseColor = PHASE_COLORS[phase] ?? 'text-zinc-500';
  const interviewers = profilerState?.interviewers ?? [];
  const telemetry = profilerState?.alpha_telemetry;
  const deployed = telemetry?.pillars_deployed ?? [];
  const missing = telemetry?.pillars_missing ?? [];
  const allPillars = [...deployed, ...missing];

  // Word frequency heatmap (top 8 words per speaker)
  const wordFreq = useCallback(() => {
    const freq: Record<string, Record<string, number>> = { interviewer: {}, candidate: {} };
    const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','was','are','were','i','you','we','they','it','this','that','have','had','has','be','been','being','do','did','does','my','your','their','our','its','not','so','if','as','by','from','up','about','into','through','during','before','after','above','below','between','out','off','over','under','again','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','only','own','same','than','too','very','just','because','while','although','though','since','unless','until','whether','which','who','whom','whose','what','whatever','whoever','whichever','wherever','whenever','however','therefore','thus','hence','consequently','furthermore','moreover','nevertheless','nonetheless','otherwise','meanwhile','subsequently','accordingly','additionally','alternatively','conversely','similarly','specifically','particularly','generally','typically','usually','often','sometimes','rarely','never','always','already','still','yet','also','even','especially','exactly','actually','really','quite','rather','fairly','pretty','somewhat','slightly','nearly','almost','enough','perhaps','maybe','probably','certainly','definitely','clearly','obviously','apparently','presumably','supposedly','allegedly','reportedly','essentially','basically','fundamentally','primarily','mainly','largely','mostly','partly','partially','entirely','completely','totally','absolutely','perfectly','precisely','approximately','roughly','about','around','nearly','almost']);
    for (const t of transcripts) {
      const role = t.speaker;
      const words = t.text.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !stopWords.has(w));
      for (const w of words) {
        freq[role][w] = (freq[role][w] ?? 0) + 1;
      }
    }
    return freq;
  }, [transcripts]);

  const freq = wordFreq();
  const topInterviewer = Object.entries(freq.interviewer).sort((a,b) => b[1]-a[1]).slice(0,6);
  const topCandidate = Object.entries(freq.candidate).sort((a,b) => b[1]-a[1]).slice(0,6);

  const mins = Math.floor(sessionDurationSec / 60);
  const secs = sessionDurationSec % 60;

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3 space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-400 font-semibold uppercase tracking-wider text-xs">
          Profiler Intel
        </span>
        <div className="flex items-center gap-3">
          <span className="text-zinc-600 font-mono">
            {mins}:{secs.toString().padStart(2,'0')}
          </span>
          <button
            onClick={onExport}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Export profiler state as JSON"
          >
            ⬇ export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Phase */}
        <div className="space-y-1">
          <p className="text-zinc-600 uppercase tracking-wider">Phase</p>
          <p className={`font-semibold ${phaseColor}`}>
            {phase.replace(/_/g, ' ')}
          </p>
          {profilerState?.room_power && (
            <p className="text-zinc-600">
              {profilerState.room_power === 'Alpha_dominant' ? '👑 Alpha dominant'
                : profilerState.room_power === 'Interviewer_dominant' ? '🎯 Interviewer dominant'
                : '⚖️ Balanced'}
            </p>
          )}
        </div>

        {/* Interviewer intel */}
        <div className="space-y-1">
          <p className="text-zinc-600 uppercase tracking-wider">Interviewer</p>
          {interviewers.length > 0 ? interviewers.map((iv, i) => (
            <div key={i} className="space-y-0.5">
              <p className={`font-medium ${EMOTION_COLORS[iv.emotional_state ?? ''] ?? 'text-zinc-400'}`}>
                {iv.emotional_state ?? 'Calibrating...'}
              </p>
              {iv.the_exploit && (
                <p className="text-zinc-500 truncate" title={iv.the_exploit}>
                  ⚡ {iv.the_exploit.slice(0, 40)}
                </p>
              )}
            </div>
          )) : (
            <p className="text-zinc-600 italic">Calibrating...</p>
          )}
        </div>

        {/* Pillar scorecard */}
        <div className="space-y-1">
          <p className="text-zinc-600 uppercase tracking-wider">
            Pillars {deployed.length}/{allPillars.length || '?'}
          </p>
          <div className="space-y-0.5">
            {allPillars.slice(0, 5).map((p, i) => (
              <PillarRow key={i} pillar={p} deployed={deployed.includes(p)} />
            ))}
            {allPillars.length === 0 && (
              <p className="text-zinc-600 italic">Waiting for first tick...</p>
            )}
          </div>
        </div>

        {/* Word heatmap */}
        <div className="space-y-1">
          <p className="text-zinc-600 uppercase tracking-wider">Hot Words</p>
          <div className="space-y-1">
            {topInterviewer.length > 0 && (
              <div>
                <p className="text-zinc-600">Interviewer:</p>
                <p className="text-zinc-400">{topInterviewer.map(([w]) => w).join(', ')}</p>
              </div>
            )}
            {topCandidate.length > 0 && (
              <div>
                <p className="text-zinc-600">You:</p>
                <p className="text-zinc-400">{topCandidate.map(([w]) => w).join(', ')}</p>
              </div>
            )}
            {topInterviewer.length === 0 && topCandidate.length === 0 && (
              <p className="text-zinc-600 italic">No data yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
