import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The introduction.
 *
 * A network of people, systems, suppliers and places assembles; something in
 * the middle of it fails; the failure spreads; the organization reorganises
 * around the loss. The point is to make the product's subject legible in
 * twenty-six seconds, not to decorate the screen.
 *
 * It must never become a toll gate, so: a skip control from the first frame, a
 * still composition for anyone who prefers reduced motion, and a browser that
 * has seen it once is not shown it again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IntroScore } from './score';
import './intro.css';
const DURATION = 26_500;
const BEATS = [
    { from: 13_000, to: 15_400, lines: ['When one thing fails,', 'everything connected feels it.'] },
    { from: 15_600, to: 17_400, lines: ["The question isn't whether", 'something will go wrong.'] },
    { from: 17_600, to: 19_400, lines: ['The question is', 'what happens next.'] },
    { from: 19_700, to: 21_900, lines: ['C.O.R.E.'], scale: 'logo' },
    {
        from: 21_000,
        to: 21_900,
        lines: ['Continuity · Operations · Risk · Execution'],
        scale: 'wordmark',
    },
    { from: 22_200, to: 24_200, lines: ['Understand. Respond. Recover. Improve.'] },
    { from: 24_600, to: 26_400, lines: ["Welcome.", "Let's understand what matters."] },
];
/** Deterministic pseudo-random, so the composition is the same every time. */
function makeRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
function buildNetwork() {
    const random = makeRandom(20260908);
    const nodes = [];
    const edges = [];
    const kinds = ['person', 'team', 'system', 'vendor', 'place', 'function'];
    // Hubs first: these are the things a real organization concentrates on.
    const hubCount = 7;
    for (let i = 0; i < hubCount; i += 1) {
        const angle = (i / hubCount) * Math.PI * 2 + random() * 0.4;
        const radius = 130 + random() * 90;
        nodes.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius * 0.62,
            z: (random() - 0.5) * 260,
            kind: kinds[i % kinds.length] ?? 'system',
            born: 1300 + i * 260,
            hub: true,
            failedAt: null,
            recoveredAt: null,
            phase: random() * Math.PI * 2,
        });
    }
    // Satellites cluster loosely around the hubs.
    const satelliteCount = 74;
    for (let i = 0; i < satelliteCount; i += 1) {
        const anchor = nodes[Math.floor(random() * hubCount)];
        const angle = random() * Math.PI * 2;
        const radius = 40 + random() * 150;
        nodes.push({
            x: (anchor?.x ?? 0) + Math.cos(angle) * radius,
            y: (anchor?.y ?? 0) + Math.sin(angle) * radius * 0.6,
            z: (anchor?.z ?? 0) + (random() - 0.5) * 200,
            kind: kinds[Math.floor(random() * kinds.length)] ?? 'system',
            born: 2400 + random() * 4200,
            hub: false,
            failedAt: null,
            recoveredAt: null,
            phase: random() * Math.PI * 2,
        });
    }
    // Connect satellites to their nearest hubs, then hubs to each other.
    for (let i = hubCount; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (node === undefined)
            continue;
        const ranked = [];
        for (let h = 0; h < hubCount; h += 1) {
            const hub = nodes[h];
            if (hub === undefined)
                continue;
            const dx = hub.x - node.x;
            const dy = hub.y - node.y;
            ranked.push({ h, d: dx * dx + dy * dy });
        }
        ranked.sort((p, q) => p.d - q.d);
        const links = random() > 0.72 ? 2 : 1;
        for (let k = 0; k < links; k += 1) {
            const target = ranked[k];
            if (target === undefined)
                continue;
            edges.push({
                a: i,
                b: target.h,
                born: Math.max(node.born, 4800 + random() * 2000),
                brokenAt: null,
                isRecovery: false,
            });
        }
    }
    for (let i = 0; i < hubCount; i += 1) {
        for (let j = i + 1; j < hubCount; j += 1) {
            if (random() > 0.5) {
                edges.push({ a: i, b: j, born: 5200 + random() * 1800, brokenAt: null, isRecovery: false });
            }
        }
    }
    // The thing that fails: a well-connected hub near the middle.
    const epicentre = 0;
    return { nodes, edges, epicentre };
}
export function CinematicIntro({ onFinish }) {
    const canvasRef = useRef(null);
    const scoreRef = useRef(null);
    const finishedRef = useRef(false);
    const [elapsed, setElapsed] = useState(0);
    const [soundOn, setSoundOn] = useState(false);
    const reducedMotion = useMemo(() => typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
    const finish = useCallback(() => {
        if (finishedRef.current)
            return;
        finishedRef.current = true;
        void scoreRef.current?.dispose();
        onFinish();
    }, [onFinish]);
    // Escape always leaves. An introduction you cannot get out of is a trap.
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape' || event.key === 'Enter')
                finish();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [finish]);
    useEffect(() => {
        return () => {
            void scoreRef.current?.dispose();
        };
    }, []);
    const toggleSound = useCallback(() => {
        if (soundOn) {
            void scoreRef.current?.dispose();
            scoreRef.current = null;
            setSoundOn(false);
            return;
        }
        const score = new IntroScore();
        scoreRef.current = score;
        void score.start(elapsed / 1000);
        setSoundOn(true);
    }, [soundOn, elapsed]);
    // ---- the animation ------------------------------------------------------
    useEffect(() => {
        if (reducedMotion)
            return;
        const canvas = canvasRef.current;
        if (canvas === null)
            return;
        const context = canvas.getContext('2d');
        if (context === null)
            return;
        const { nodes, edges, epicentre } = buildNetwork();
        let frame = 0;
        let startedAt = null;
        // Failure timings are derived once, by walking outward from the epicentre,
        // so the spread looks like propagation rather than a random dissolve.
        const FAIL_START = 10_200;
        nodes[epicentre].failedAt = FAIL_START;
        const order = [epicentre];
        const seen = new Set([epicentre]);
        while (order.length > 0) {
            const current = order.shift();
            if (current === undefined)
                continue;
            const currentNode = nodes[current];
            if (currentNode?.failedAt === null || currentNode === undefined)
                continue;
            for (const edge of edges) {
                const next = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
                if (next === null || seen.has(next))
                    continue;
                const nextNode = nodes[next];
                if (nextNode === undefined)
                    continue;
                seen.add(next);
                nextNode.failedAt = currentNode.failedAt + 260 + Math.random() * 320;
                if (nextNode.failedAt < 13_000) {
                    edge.brokenAt = nextNode.failedAt;
                    order.push(next);
                }
                else {
                    nextNode.failedAt = null;
                }
            }
        }
        // Recovery: a handful of new links appear, routing around the loss.
        const survivors = nodes
            .map((node, index) => ({ node, index }))
            .filter(({ node }) => node.failedAt === null && node.hub);
        for (let i = 0; i < survivors.length - 1; i += 1) {
            const from = survivors[i];
            const to = survivors[i + 1];
            if (from === undefined || to === undefined)
                continue;
            edges.push({
                a: from.index,
                b: to.index,
                born: 22_400 + i * 260,
                brokenAt: null,
                isRecovery: true,
            });
        }
        for (const node of nodes) {
            if (node.failedAt !== null && !node.hub)
                node.recoveredAt = 23_200 + Math.random() * 1800;
        }
        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.floor(canvas.clientWidth * dpr);
            canvas.height = Math.floor(canvas.clientHeight * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);
        const colourFor = (kind) => {
            switch (kind) {
                case 'person':
                    return '#d8c9a8';
                case 'team':
                    return '#c9b78f';
                case 'vendor':
                    return '#a9b8c6';
                case 'place':
                    return '#b6c7ba';
                case 'function':
                    return '#e6ddc9';
                default:
                    return '#8fb3a3';
            }
        };
        let lastPingAt = 0;
        const draw = (now) => {
            if (startedAt === null)
                startedAt = now;
            const t = now - startedAt;
            setElapsed(t);
            if (t >= DURATION) {
                finish();
                return;
            }
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            context.clearRect(0, 0, width, height);
            // Ground: near-black, warmed very slightly so it does not read as a void.
            const ground = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
            ground.addColorStop(0, '#14161a');
            ground.addColorStop(1, '#0a0b0d');
            context.fillStyle = ground;
            context.fillRect(0, 0, width, height);
            // Camera: a slow push in, plus a gentle drift, so the viewer feels they
            // are moving through the organization rather than watching a diagram.
            const push = 620 - Math.min(t, 9000) / 9000 * 210;
            const drift = Math.sin(t / 5200) * 0.16;
            const cx = width / 2;
            const cy = height / 2;
            // Scale so the network fills the frame on a laptop as well as a phone;
            // the earlier constant left it small and lost in the middle.
            const zoom = Math.min(width / 760, height / 470);
            const project = (node) => {
                const rx = node.x * Math.cos(drift) - node.z * Math.sin(drift);
                const rz = node.x * Math.sin(drift) + node.z * Math.cos(drift);
                const perspective = push / (push + rz + 300);
                return {
                    x: cx + rx * perspective * zoom,
                    y: cy + node.y * perspective * zoom,
                    s: perspective,
                };
            };
            // Edges first, so nodes sit on top of them.
            context.lineCap = 'round';
            for (const edge of edges) {
                if (t < edge.born)
                    continue;
                const a = nodes[edge.a];
                const b = nodes[edge.b];
                if (a === undefined || b === undefined)
                    continue;
                const appear = Math.min(1, (t - edge.born) / 900);
                let alpha = 0.16 * appear;
                let stroke = '#5f7d72';
                if (edge.isRecovery) {
                    stroke = '#8fb3a3';
                    alpha = 0.5 * appear;
                }
                else if (edge.brokenAt !== null && t > edge.brokenAt) {
                    const since = t - edge.brokenAt;
                    if (since > 900 && t < 22_800)
                        continue;
                    alpha = Math.max(0, 0.5 - since / 1800);
                    stroke = '#a8524c';
                }
                const pa = project(a);
                const pb = project(b);
                context.globalAlpha = alpha;
                context.strokeStyle = stroke;
                context.lineWidth = edge.isRecovery ? 1.4 : 0.9;
                context.beginPath();
                context.moveTo(pa.x, pa.y);
                context.lineTo(pb.x, pb.y);
                context.stroke();
            }
            // Activity: small travelling marks, only while the system is healthy.
            if (t > 8600 && t < 10_400) {
                const flow = ((t - 8600) % 1400) / 1400;
                context.globalAlpha = 0.5;
                context.fillStyle = '#cfe0d6';
                for (const edge of edges.slice(0, 34)) {
                    const a = nodes[edge.a];
                    const b = nodes[edge.b];
                    if (a === undefined || b === undefined || t < edge.born)
                        continue;
                    const pa = project(a);
                    const pb = project(b);
                    const p = (flow + edge.born / 5000) % 1;
                    context.beginPath();
                    context.arc(pa.x + (pb.x - pa.x) * p, pa.y + (pb.y - pa.y) * p, 1.4, 0, Math.PI * 2);
                    context.fill();
                }
            }
            for (const node of nodes) {
                if (t < node.born)
                    continue;
                const appear = Math.min(1, (t - node.born) / 800);
                const p = project(node);
                const failed = node.failedAt !== null && t > node.failedAt;
                const recovered = node.recoveredAt !== null && t > node.recoveredAt;
                const breathe = 1 + Math.sin(t / 1300 + node.phase) * 0.09;
                const radius = (node.hub ? 3.4 : 1.9) * p.s * breathe * appear * 1.5;
                let colour = colourFor(node.kind);
                let alpha = (node.hub ? 0.95 : 0.68) * appear;
                if (failed && !recovered) {
                    colour = '#8f3f3a';
                    alpha = 0.42;
                }
                else if (recovered) {
                    const since = t - (node.recoveredAt ?? 0);
                    alpha = Math.min(0.9, 0.3 + since / 1200);
                }
                context.globalAlpha = alpha;
                context.fillStyle = colour;
                context.beginPath();
                context.arc(p.x, p.y, Math.max(0.4, radius), 0, Math.PI * 2);
                context.fill();
                if (node.hub && !failed) {
                    context.globalAlpha = 0.1 * appear;
                    context.beginPath();
                    context.arc(p.x, p.y, radius * 3.4, 0, Math.PI * 2);
                    context.fill();
                }
            }
            context.globalAlpha = 1;
            // Sparse audio markers as the network forms and again as it recovers.
            const score = scoreRef.current;
            if (score !== null && score.isRunning && t - lastPingAt > 620) {
                if ((t > 4800 && t < 8200) || (t > 22_300 && t < 24_600)) {
                    lastPingAt = t;
                    score.ping(t < 12_000 ? 587.33 : 440, 0.03);
                }
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
        };
    }, [finish, reducedMotion]);
    // ---- reduced motion -----------------------------------------------------
    if (reducedMotion) {
        return (_jsx("div", { className: "intro intro-still", children: _jsxs("div", { className: "intro-still-inner stack", children: [_jsx("p", { className: "intro-mark", children: "C.O.R.E." }), _jsx("p", { className: "intro-wordmark", children: "Continuity \u00B7 Operations \u00B7 Risk \u00B7 Execution" }), _jsxs("div", { className: "intro-still-lines stack-sm", children: [_jsx("p", { children: "When one thing fails, everything connected feels it." }), _jsx("p", { children: "The question isn't whether something will go wrong. It is what happens next." }), _jsx("p", { className: "intro-still-emphasis", children: "Understand. Respond. Recover. Improve." })] }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: finish, children: "Continue" })] }) }));
    }
    const progress = Math.min(1, elapsed / DURATION);
    return (_jsxs("div", { className: "intro", children: [_jsx("canvas", { ref: canvasRef, className: "intro-canvas", "aria-hidden": "true" }), _jsx("div", { className: "intro-text", "aria-live": "polite", children: BEATS.map((beat) => {
                    const visible = elapsed >= beat.from && elapsed < beat.to;
                    if (!visible)
                        return null;
                    const age = elapsed - beat.from;
                    const life = beat.to - beat.from;
                    // Fade in over 500ms, hold, fade out over the last 500ms.
                    const opacity = Math.min(1, age / 500, Math.max(0, (life - age) / 500));
                    const className = beat.scale === 'logo'
                        ? 'intro-mark'
                        : beat.scale === 'wordmark'
                            ? 'intro-wordmark'
                            : 'intro-line';
                    return (_jsx("div", { className: "intro-beat", style: { opacity }, children: beat.lines.map((line) => (_jsx("p", { className: className, children: line }, line))) }, beat.from));
                }) }), _jsxs("div", { className: "intro-controls", children: [_jsx("button", { type: "button", className: "intro-control", onClick: toggleSound, "aria-pressed": soundOn, children: soundOn ? 'Sound on' : 'Sound off' }), _jsx("button", { type: "button", className: "intro-control intro-skip", onClick: finish, children: "Skip intro" })] }), _jsx("div", { className: "intro-progress", "aria-hidden": "true", children: _jsx("div", { className: "intro-progress-bar", style: { transform: `scaleX(${progress})` } }) })] }));
}
