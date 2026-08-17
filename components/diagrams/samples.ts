import type { DiagramCard } from "@/lib/schemas/cards";

const N = "n1";

/**
 * One great example per variant — valid DiagramCards for the dev showcase,
 * Playwright fixtures and layout tests. Copy is feed-native (no school words).
 */
export const SAMPLE_DIAGRAMS: DiagramCard[] = [
  {
    id: "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e01",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x01",
    variant: "flow",
    title: "what happens when you hit send",
    nodes: [
      { id: "you", label: "you", sub: "tap send" },
      { id: "yours", label: "your mail server", sub: "queues it" },
      { id: "theirs", label: "their mail server", sub: "found via a dns mx record" },
      { id: "filter", label: "spam filter", sub: "scores it", emphasis: true },
      { id: "inbox", label: "inbox" },
      { id: "junk", label: "junk" },
    ],
    edges: [
      { from: "you", to: "yours" },
      { from: "yours", to: "theirs", label: "smtp" },
      { from: "theirs", to: "filter" },
      { from: "filter", to: "inbox", label: "clean" },
      { from: "filter", to: "junk", label: "sus" },
    ],
    tapNotes: {
      filter: "the filter never sees 'you'. it sees a score: sender reputation, links, how many people binned mail like yours before.",
    },
  },
  {
    id: "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e02",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x02",
    variant: "boxes",
    title: "six brews, six extractions",
    nodes: [
      { id: "esp", label: "espresso", sub: "9 bars, 30 sec", emphasis: true },
      { id: "pour", label: "pour over", sub: "gravity, 3 min" },
      { id: "press", label: "french press", sub: "steep, 4 min" },
      { id: "aero", label: "aeropress", sub: "hand pressure, 90 sec" },
      { id: "moka", label: "moka pot", sub: "steam pressure, stovetop" },
      { id: "cold", label: "cold brew", sub: "no heat, 18 hours" },
    ],
    edges: [],
    tapNotes: {
      esp: "pressure does the work here. same beans, sharper and heavier — because water is forced through, not dripped.",
      cold: "no heat means no bitter acids come out. that's why it tastes smooth even when it's strong.",
    },
  },
  {
    id: "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e03",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x03",
    variant: "timeline",
    title: "how the web got fast",
    nodes: [
      { id: "h09", label: "http/0.9", sub: "1991 · one line, one file" },
      { id: "h10", label: "http/1.0", sub: "1996 · headers arrive" },
      { id: "h11", label: "http/1.1", sub: "1997 · keep the line open" },
      { id: "h2", label: "http/2", sub: "2015 · many at once", emphasis: true },
      { id: "h3", label: "http/3", sub: "2022 · runs on udp" },
    ],
    edges: [{ from: "h11", to: "h2", label: "18 yrs" }],
    tapNotes: {
      h2: "one connection, many streams. before this your browser opened six pipes to one site and still waited in line.",
    },
  },
  {
    id: "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e04",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x04",
    variant: "compare",
    title: "tcp vs udp, no diplomacy",
    nodes: [
      { id: "tcp", label: "tcp", sub: "the careful one", emphasis: true },
      { id: "hs", label: "3-way handshake", sub: "hello, hello, ok" },
      { id: "rt", label: "resends lost bits", sub: "in order, always" },
      { id: "udp", label: "udp", sub: "the fast one", emphasis: true },
      { id: "nohs", label: "no handshake", sub: "just starts talking" },
      { id: "lost", label: "lost bits stay lost", sub: "and nobody waits" },
    ],
    edges: [
      { from: "hs", to: "nohs", label: "1 rtt" },
      { from: "rt", to: "lost", label: "vs speed" },
    ],
    tapNotes: {
      tcp: "the web, email, files: anything where a missing byte is a bug.",
      udp: "video calls pick udp on purpose. a late frame is worse than a missing one.",
    },
  },
  {
    id: "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e05",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x05",
    variant: "cycle",
    title: "how a habit locks in",
    nodes: [
      { id: "cue", label: "cue", sub: "the trigger" },
      { id: "crave", label: "craving", sub: "the itch" },
      { id: "act", label: "response", sub: "the action" },
      { id: "reward", label: "reward", sub: "the payoff", emphasis: true },
    ],
    edges: [
      { from: "cue", to: "crave" },
      { from: "crave", to: "act" },
      { from: "act", to: "reward" },
      { from: "reward", to: "cue", label: "tightens" },
    ],
    tapNotes: {
      reward: "the reward teaches your brain to spot the cue faster next time. that's the loop tightening, not you getting weaker.",
    },
  },
  {
    id: "7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e06",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x06",
    variant: "layers",
    title: "what's under your app",
    nodes: [
      { id: "hw", label: "hardware", sub: "cpu, memory, disk" },
      { id: "kernel", label: "kernel", sub: "owns every device" },
      { id: "runtime", label: "runtime", sub: "node, jvm, python" },
      { id: "fw", label: "framework", sub: "routing, rendering" },
      { id: "app", label: "your code", sub: "the 2% you wrote", emphasis: true },
    ],
    edges: [{ from: "app", to: "kernel", label: "syscall" }],
    tapNotes: {
      app: "every file read, every network byte, every pixel: your code asks the kernel. it never touches hardware itself.",
      kernel: "one program that never trusts the others. that's the whole job.",
    },
  },
];
