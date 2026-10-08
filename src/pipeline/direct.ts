import { Inventory, Shot, Transcript } from '../lib/types';
export function direct(transcript: Transcript, inventory: Inventory): Shot[] {
  return transcript.segments.map((segment, i) => {
    let scene = inventory.scenes.find(s => s.id === segment.sceneId);
    if (!scene) throw new Error(`Missing scene ${segment.sceneId}`);
    if (i === 0 && new URL(scene.url).hostname === 'github.com') {
      // Introduce the repository with its README hero before showing deeper sections.
      scene = inventory.scenes.find(s => s.url === scene!.url && s.sourceId === scene!.sourceId && s.title === 'Product overview' && s.actions.length === 0) || scene;
    }
    // Include speech pauses in the visual preceding them. The first shot includes initial silence.
    const start = i === 0 ? 0 : segment.start;
    const end = transcript.segments[i + 1]?.start ?? transcript.duration;
    return { id: String(i + 1).padStart(3, '0'), sceneId: scene.id, start, duration: end - start, url: scene.url, actions: scene.actions, caption: scene.title };
  });
}
