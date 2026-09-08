/**
 * The introduction's score, synthesised in the browser.
 *
 * Written as code rather than shipped as audio for three reasons: it is
 * original by construction, it adds nothing to the download, and it can follow
 * the animation's phases exactly instead of being cut to a fixed length.
 *
 * The arc the visuals follow: whisper, scale, tension, silence, recovery,
 * resolve, calm. Everything here is built from oscillators and filtered noise.
 */
const ROOT = 146.83; // D3, low and warm rather than bright
/** Intervals of a D natural-minor set, kept consonant and unhurried. */
const HARMONY = [1, 9 / 8, 6 / 5, 3 / 2, 8 / 5, 2, 12 / 5, 3];
export class IntroScore {
    context = null;
    master = null;
    voices = [];
    noise = null;
    started = false;
    disposed = false;
    get isRunning() {
        return this.started && !this.disposed;
    }
    /**
     * Begin playback. Must be called from a user gesture: browsers refuse to
     * start audio otherwise, which is why the interface offers a sound control
     * rather than assuming it can make noise.
     */
    async start(fromSeconds) {
        if (this.started || this.disposed)
            return;
        const Ctor = window.AudioContext ??
            window.webkitAudioContext;
        if (Ctor === undefined)
            return;
        const context = new Ctor();
        await context.resume();
        const master = context.createGain();
        master.gain.value = 0;
        master.connect(context.destination);
        // A gentle low-pass keeps everything soft-edged; this should feel like a
        // room, not a synthesiser.
        const tone = context.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 1800;
        tone.Q.value = 0.4;
        tone.connect(master);
        this.context = context;
        this.master = master;
        this.started = true;
        this.buildPad(context, tone);
        this.buildAir(context, tone);
        this.schedule(context, master, fromSeconds);
    }
    /** A slow chord of detuned sines that swells and thins with the story. */
    buildPad(context, destination) {
        for (const [index, ratio] of HARMONY.entries()) {
            const osc = context.createOscillator();
            osc.type = index % 3 === 0 ? 'triangle' : 'sine';
            osc.frequency.value = ROOT * ratio;
            // Slight detune so the chord breathes rather than sitting perfectly still.
            osc.detune.value = (index % 2 === 0 ? 1 : -1) * (2 + index);
            const gain = context.createGain();
            gain.gain.value = 0;
            osc.connect(gain).connect(destination);
            osc.start();
            this.voices.push({ osc, gain });
        }
    }
    /** Filtered noise, standing in for room air and for the sense of scale. */
    buildAir(context, destination) {
        const length = context.sampleRate * 4;
        const buffer = context.createBuffer(1, length, context.sampleRate);
        const channel = buffer.getChannelData(0);
        // Brown-ish noise: softer and less hissy than white.
        let last = 0;
        for (let i = 0; i < length; i += 1) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            channel[i] = last * 3.5;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.7;
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(destination);
        source.start();
        this.noise = { source, gain };
    }
    /**
     * Lay out the whole piece on the audio clock in one pass.
     *
     * Scheduling ahead rather than reacting frame by frame keeps the music in
     * time even if the animation drops frames on a slow machine.
     */
    schedule(context, master, fromSeconds) {
        const t0 = context.currentTime;
        /** Convert a timeline position to an audio-clock time, never in the past. */
        const at = (ms) => Math.max(t0, t0 + ms / 1000 - fromSeconds);
        const ramp = (param, value, ms) => {
            param.linearRampToValueAtTime(value, at(ms));
        };
        master.gain.setValueAtTime(0, t0);
        ramp(master.gain, 0.16, 1400);
        ramp(master.gain, 0.3, 9000);
        // The failure: the music does not swell, it drops away.
        ramp(master.gain, 0.3, 10100);
        ramp(master.gain, 0.05, 10900);
        ramp(master.gain, 0.05, 13200);
        // Recovery rebuilds patiently.
        ramp(master.gain, 0.2, 19500);
        ramp(master.gain, 0.28, 22500);
        ramp(master.gain, 0.1, 25500);
        ramp(master.gain, 0, 26800);
        const air = this.noise?.gain;
        if (air !== undefined) {
            air.gain.setValueAtTime(0, t0);
            ramp(air.gain, 0.05, 2400);
            ramp(air.gain, 0.16, 9000);
            ramp(air.gain, 0.02, 10900);
            ramp(air.gain, 0.1, 22000);
            ramp(air.gain, 0, 26500);
        }
        // Voices enter one at a time as the network grows, so the chord builds with
        // the picture rather than arriving all at once.
        const entries = [1200, 2600, 4200, 5600, 6800, 8000, 20200, 21600];
        for (const [index, voice] of this.voices.entries()) {
            const enter = entries[index] ?? 8000;
            const level = index < 4 ? 0.12 : 0.055;
            voice.gain.gain.setValueAtTime(0, t0);
            ramp(voice.gain.gain, level, enter + 1600);
            if (index >= 4) {
                // The upper voices are the ones that vanish when the failure lands.
                ramp(voice.gain.gain, level, 10100);
                ramp(voice.gain.gain, 0, 10800);
                ramp(voice.gain.gain, 0, 19000);
                ramp(voice.gain.gain, level * 0.9, 21800);
            }
            ramp(voice.gain.gain, 0, 26600);
        }
        // One low sustained tone underneath the silence: the thing still standing.
        const drone = context.createOscillator();
        drone.type = 'sine';
        drone.frequency.value = ROOT / 2;
        const droneGain = context.createGain();
        droneGain.gain.setValueAtTime(0, t0);
        droneGain.gain.linearRampToValueAtTime(0.12, at(10900));
        droneGain.gain.linearRampToValueAtTime(0.12, at(18500));
        droneGain.gain.linearRampToValueAtTime(0.04, at(22000));
        droneGain.gain.linearRampToValueAtTime(0, at(26600));
        drone.connect(droneGain).connect(master);
        drone.start();
        this.voices.push({ osc: drone, gain: droneGain });
    }
    /** A soft, short marker used when a connection forms or recovers. */
    ping(frequency, level = 0.05) {
        const context = this.context;
        const master = this.master;
        if (context === null || master === null || this.disposed)
            return;
        const now = context.currentTime;
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(level, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        osc.connect(gain).connect(master);
        osc.start(now);
        osc.stop(now + 1);
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        const context = this.context;
        if (context === null)
            return;
        // Fade before tearing down; an abrupt stop clicks.
        const now = context.currentTime;
        this.master?.gain.cancelScheduledValues(now);
        this.master?.gain.setValueAtTime(this.master.gain.value, now);
        this.master?.gain.linearRampToValueAtTime(0, now + 0.25);
        window.setTimeout(() => {
            for (const voice of this.voices) {
                try {
                    voice.osc.stop();
                }
                catch {
                    // Already stopped.
                }
            }
            try {
                this.noise?.source.stop();
            }
            catch {
                // Already stopped.
            }
            void context.close();
        }, 300);
    }
}
