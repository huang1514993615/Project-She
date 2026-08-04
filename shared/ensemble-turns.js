export function normalizeSpeakerKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleLowerCase();
}

export function maxEnsembleMessages(maxParticipants = 3) {
  const participantLimit = Math.min(10, Math.max(1, Math.trunc(Number(maxParticipants) || 3)));
  return participantLimit * 4;
}

export function maxEnsembleOutputTokens(maxParticipants = 3) {
  const participantLimit = Math.min(10, Math.max(1, Math.trunc(Number(maxParticipants) || 3)));
  return Math.min(24000, 2000 + maxEnsembleMessages(participantLimit) * 420);
}

export function limitEnsembleTurns(turns, maxParticipants = 3) {
  const participantLimit = Math.min(10, Math.max(1, Math.trunc(Number(maxParticipants) || 3)));
  const messageLimit = maxEnsembleMessages(participantLimit);
  const admittedSpeakers = new Set();
  const result = [];

  for (const turn of Array.isArray(turns) ? turns : []) {
    const speaker = String(turn?.speaker || "").trim();
    const speakerKey = normalizeSpeakerKey(speaker);
    if (!speaker || !speakerKey) continue;
    if (!admittedSpeakers.has(speakerKey) && admittedSpeakers.size >= participantLimit) continue;
    admittedSpeakers.add(speakerKey);
    result.push({ ...turn, speaker });
    if (result.length >= messageLimit) break;
  }

  return result;
}
