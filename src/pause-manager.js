export class PauseManager {
  constructor({ game, audio, input, adapter, isGameplay }) {
    this.game = game;
    this.audio = audio;
    this.input = input;
    this.adapter = adapter;
    this.isGameplay = isGameplay;
    this.pauseReasons = new Set();
    this.running = null;
  }

  set(reason, active) {
    if (active) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    return this.sync();
  }

  sync() {
    const shouldRun = this.pauseReasons.size === 0 && Boolean(this.isGameplay());
    this.game[shouldRun ? "resume" : "pause"]();
    this.input.setEnabled(shouldRun);
    if (shouldRun === this.running) return shouldRun;
    this.running = shouldRun;
    this.audio[shouldRun ? "resume" : "pause"]();
    this.adapter[shouldRun ? "gameplayStart" : "gameplayStop"]();
    return shouldRun;
  }
}
