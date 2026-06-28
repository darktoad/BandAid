import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

// iOS 16.4+ Safari treats Web Audio (the alphaTab synth) as a "sound effect"
// that the ring/silent switch mutes — unlike <video>, which plays through the
// media channel. Declaring a 'playback' audio session routes our audio through
// that media channel too, so it plays even when the device is muted (and at
// full volume). Feature-detected: a no-op on browsers without the API.
const audioSession = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
if (audioSession) {
  audioSession.type = 'playback';
}

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
