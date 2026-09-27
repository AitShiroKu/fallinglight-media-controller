import { create } from 'zustand';
import { audioEngine, VUData } from '../services/audio-engine';
import { streamController } from '../services/stream-controller';

interface VUState {
  vu: VUData;
  setVU: (vu: VUData) => void;
}

export const useVUStore = create<VUState>((set) => ({
  vu: { left: 0, right: 0, leftDb: -60, rightDb: -60 },
  setVU: (vu) => set({ vu }),
}));

// Local AudioEngine listener (runs at ~25 FPS when locally playing)
audioEngine.addVUListener((vu) => {
  useVUStore.setState({ vu });
});

// Remote StreamController listener (runs when receiver streams VU back to controller)
streamController.onVuUpdate((vu) => {
  if (!audioEngine.isPlaying) {
    useVUStore.setState({ vu });
  }
});
