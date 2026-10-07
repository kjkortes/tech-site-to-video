import { Inventory, Shot, Transcript } from '../lib/types';
export function direct(transcript: Transcript, inventory: Inventory): Shot[] {
  return transcript.segments.map((segment, i) => {
    const scene = inventory.scenes.find(s => s.id === segment.sceneId);
    if (!scene) throw new Error(`Missing scene ${segment.sceneId}`);
    // Include speech pauses in the visual preceding them. The first shot includes initial silence.
    const start = i === 0 ? 0 : segment.start;
    const end = transcript.segments[i + 1]?.start ?? transcript.duration;
    return { id: String(i + 1).padStart(3, '0'), sceneId: scene.id, start, duration: end - start, url: scene.url, actions: scene.actions, caption: scene.title };
  });
}
