"""Local timestamp extraction for uploaded narration. No audio leaves this machine."""
import json
import os
import sys
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get('NARRATION_WHISPER_MODEL', 'small'), device='cpu', compute_type='int8', cpu_threads=4)
segments, info = model.transcribe(sys.argv[1], word_timestamps=True, beam_size=5, vad_filter=True)
result = {'duration': info.duration, 'language': info.language, 'segments': [], 'words': []}
for segment in segments:
    result['segments'].append({'text': segment.text.strip(), 'start': segment.start, 'end': segment.end})
    for word in segment.words or []:
        if word.word.strip() and word.end > word.start:
            result['words'].append({'text': word.word.strip(), 'start': word.start, 'end': word.end})
if not result['words']:
    raise RuntimeError('No speech was detected; upload a narration recording with audible speech.')
with open(sys.argv[2], 'w', encoding='utf-8') as output:
    json.dump(result, output, ensure_ascii=False)
