function localHost(hostname = location.hostname) {
  return !hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function withTimeout(value, milliseconds = 10000) {
  let timer;
  const pending = Promise.race([
    Promise.resolve(value),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("SDK timeout")), milliseconds); }),
  ]);
  return pending.then(
    (result) => { clearTimeout(timer); return result; },
    (error) => { clearTimeout(timer); throw error; },
  );
}

function loadSdk() {
  if (window.YaGames) return Promise.resolve(true);
  if (localHost()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let timeout;
    let poll;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(poll);
      resolve(available);
    };
    poll = setInterval(() => { if (window.YaGames) finish(true); }, 25);
    timeout = setTimeout(() => finish(Boolean(window.YaGames)), 10000);
    const hasLoader = [...document.scripts].some((script) => script.src.endsWith("/sdk.js"));
    if (!hasLoader) {
      const script = document.createElement("script");
      script.src = "/sdk.js";
      script.async = true;
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    }
  });
}

export class YandexAdapter {
  constructor(ysdk = null, hooks = {}) {
    this.ysdk = ysdk;
    this.hooks = hooks;
    this.player = null;
    this.local = !ysdk;
    this.loadingReady = false;
    this.gameplayActive = false;
    this.adPending = false;
    this.authPending = null;
    this.leaderboardSubmitQueue = Promise.resolve();
    this.lastLeaderboardSubmitAt = 0;
    this.cloudSaveQueue = Promise.resolve();
    this.sdkTimeout = Math.max(10, Number(hooks.sdkTimeout) || 10000);
    this.authTimeout = Math.max(this.sdkTimeout, Number(hooks.authTimeout) || 120000);
  }

  static async create(hooks = {}) {
    const loaded = await loadSdk();
    let ysdk = null;
    try { ysdk = loaded ? await withTimeout(window.YaGames.init(), Math.max(1000, Number(hooks.sdkTimeout) || 10000)) : null; } catch { /* local fallback */ }
    const adapter = new YandexAdapter(ysdk, hooks);
    adapter.bindPlatformEvents();
    await adapter.preparePlayer();
    return adapter;
  }

  bindPlatformEvents() {
    try {
      this.ysdk?.on?.("game_api_pause", () => this.notify("onPause", "platform"));
      this.ysdk?.on?.("game_api_resume", () => this.notify("onResume", "platform"));
    } catch { /* older SDK mocks omit events */ }
  }

  notify(name, ...args) { try { this.hooks[name]?.(...args); } catch { /* host UI must keep running */ } }

  language() { return this.ysdk?.environment?.i18n?.lang || navigator.language || "en"; }

  async preparePlayer() {
    try { this.player = await withTimeout(this.ysdk?.getPlayer?.({ scopes: false }), this.sdkTimeout) || null; } catch { this.player = null; }
  }

  isAuthorized() {
    try { return Boolean(this.player?.isAuthorized?.()); } catch { return false; }
  }

  async authorize() {
    if (this.isAuthorized()) return true;
    if (!this.ysdk?.auth?.openAuthDialog) return false;
    if (this.authPending) return this.authPending;
    this.authPending = (async () => {
      try {
        await withTimeout(this.ysdk.auth.openAuthDialog(), this.authTimeout);
        await this.preparePlayer();
        return this.isAuthorized();
      } catch { return false; }
    })();
    try { return await this.authPending; }
    finally { this.authPending = null; }
  }

  async loadCloud() {
    if (!this.player?.getData) return null;
    try { return (await withTimeout(this.player.getData(["save"]), this.sdkTimeout))?.save || null; } catch { return undefined; }
  }

  async saveCloud(save) {
    const write = async () => {
      try { await withTimeout(this.player?.setData?.({ save }, true), this.sdkTimeout); return Boolean(this.player); } catch { return false; }
    };
    const queued = this.cloudSaveQueue.then(write, write);
    this.cloudSaveQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async submitLeaderboard(name, score, extraData = "") {
    if (!this.isAuthorized()) return false;
    const submit = async () => {
      const delay = Math.max(0, 1050 - (Date.now() - this.lastLeaderboardSubmitAt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.lastLeaderboardSubmitAt = Date.now();
      try {
        const available = this.ysdk?.isAvailableMethod ? await withTimeout(this.ysdk.isAvailableMethod("leaderboards.setScore"), this.sdkTimeout) : true;
        if (!available) return false;
        const leaderboards = this.ysdk?.leaderboards || await withTimeout(this.ysdk?.getLeaderboards?.(), this.sdkTimeout);
        if (!leaderboards?.setScore && !leaderboards?.setLeaderboardScore) return false;
        await withTimeout((leaderboards.setScore || leaderboards.setLeaderboardScore).call(leaderboards, name, score, extraData), this.sdkTimeout);
        return true;
      } catch { return false; }
    };
    const queued = this.leaderboardSubmitQueue.then(submit, submit);
    this.leaderboardSubmitQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async loadLeaderboard(name) {
    if (!this.isAuthorized()) return null;
    try {
      const available = this.ysdk?.isAvailableMethod ? await withTimeout(this.ysdk.isAvailableMethod("leaderboards.getEntries"), this.sdkTimeout) : true;
      if (!available) return null;
      const leaderboards = this.ysdk?.leaderboards || await withTimeout(this.ysdk?.getLeaderboards?.(), this.sdkTimeout);
      if (!leaderboards?.getEntries && !leaderboards?.getLeaderboardEntries) return null;
      return await withTimeout((leaderboards.getEntries || leaderboards.getLeaderboardEntries).call(leaderboards, name, { quantityTop: 10, includeUser: true, quantityAround: 3 }), this.sdkTimeout);
    } catch { return null; }
  }

  ready() {
    if (this.loadingReady) return false;
    this.loadingReady = true;
    try { this.ysdk?.features?.LoadingAPI?.ready()?.catch?.(() => {}); return Boolean(this.ysdk); } catch { return false; }
  }

  gameplayStart() {
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    try { this.ysdk?.features?.GameplayAPI?.start()?.catch?.(() => {}); } catch { /* optional */ }
  }

  gameplayStop() {
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    try { this.ysdk?.features?.GameplayAPI?.stop()?.catch?.(() => {}); } catch { /* optional */ }
  }

  async localAd(kind) {
    if (this.adPending) return false;
    this.adPending = true;
    this.notify("onAdStart", kind);
    try { await new Promise((resolve) => setTimeout(resolve, 550)); return true; }
    finally { this.adPending = false; this.notify("onAdStop", kind); }
  }

  rewarded() {
    if (this.local) return this.localAd("rewarded");
    if (!this.ysdk?.adv?.showRewardedVideo) return Promise.resolve(false);
    return this.showAd("rewarded", (callbacks) => this.ysdk.adv.showRewardedVideo({ callbacks }));
  }

  fullscreen() {
    if (this.local) return this.localAd("fullscreen");
    if (!this.ysdk?.adv?.showFullscreenAdv) return Promise.resolve(false);
    return this.showAd("fullscreen", (callbacks) => this.ysdk.adv.showFullscreenAdv({ callbacks }));
  }

  showAd(kind, show) {
    if (this.adPending) return Promise.resolve(false);
    this.adPending = true;
    return new Promise((resolve) => {
      let rewarded = false;
      let settled = false;
      let opened = false;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.adPending = false;
        this.notify("onAdStop", kind);
        resolve(success);
      };
      const timeout = setTimeout(() => finish(false), 120000);
      try {
        const pending = show({
          onOpen: () => {
            if (settled || opened) return;
            opened = true;
            this.notify("onAdStart", kind);
          },
          onRewarded: () => { rewarded = true; },
          onClose: (wasShown) => finish(kind === "rewarded" ? rewarded : wasShown !== false),
          onError: () => finish(false),
        });
        pending?.catch?.(() => finish(false));
      } catch { finish(false); }
    });
  }
}
