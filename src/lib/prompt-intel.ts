// Prompt intelligence — local, deterministic (no LLM call). Turns a raw list of
// "common prompts" (mined from gateway history) into something useful:
//   • clusters near-duplicates that differ only in numbers/whitespace (e.g. the same
//     template run with "frames 0–4" vs "frames 10–14") into ONE entry,
//   • synthesizes a {{variable}} template from the parts that vary across a cluster,
//   • auto-categorizes by content, and
//   • flags noise (trivially short / single-word prompts like "hi").
// All pure functions so the client can run them instantly on the fetched list.

export interface RawCommon {
  prompt: string;
  count: number;
  lastSeen: string;
}

export interface PromptCluster {
  id: string;
  title: string;
  category: string;
  /** The clearest single example (longest variant). */
  representative: string;
  /** A {{var}}-templated form when the cluster has >1 numeric variant, else null. */
  template: string | null;
  /** Total uses across all variants. */
  count: number;
  /** Number of distinct raw variants merged. */
  variants: number;
  lastSeen: string;
  noise: boolean;
}

// Collapse the incidental parts (numbers, urls, whitespace, punctuation runs) so that
// two runs of the same template map to the SAME skeleton and thus cluster together.
function skeleton(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '§url§')
    .replace(/\d+(?:[.,]\d+)?/g, '§n§')
    .replace(/\s+/g, ' ')
    .replace(/[^\w§ ]+/g, '')
    .trim()
    .slice(0, 400);
}

const CATEGORIES: Array<{ name: string; test: RegExp }> = [
  { name: 'Image generation', test: /image gen|generate .*image|diffusion|txt2img|image model/i },
  { name: 'Screen understanding', test: /ax timeline|accessibility timeline|on-screen label|frames?\b|screenshot/i },
  { name: 'Test evaluation', test: /judging|planned steps|test session|assert|expected|pass\/fail/i },
  { name: 'Coding', test: /\bcode\b|function|refactor|stack trace|typescript|python|bug\b/i },
  { name: 'Summarization', test: /summar(y|ise|ize)|tl;?dr|key points/i },
  { name: 'Extraction', test: /extract|parse|json|table|fields?\b/i },
  { name: 'Translation', test: /translate|translation|into (english|spanish|french|german)/i },
];

function categorize(text: string): string {
  for (const c of CATEGORIES) if (c.test.test(text)) return c.name;
  return 'General';
}

// A short, human title: first sentence-ish, significant words, Title Cased.
function titleize(text: string): string {
  const firstLine = text.replace(/\s+/g, ' ').trim();
  const stop = new Set(['the', 'a', 'an', 'of', 'to', 'is', 'are', 'this', 'that', 'you', 'your', 'as', 'for', 'in', 'on', 'and', 'with', 'given', 'below']);
  const words = firstLine.split(' ').filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  const picked = words.slice(0, 6).join(' ');
  const t = (picked || firstLine).slice(0, 60);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function isNoise(text: string): boolean {
  const t = text.trim();
  return t.length < 12 || t.split(/\s+/).length < 3;
}

// Build a {{n1}}/{{n2}}… template from a cluster by walking the representative and
// replacing each numeric run with a placeholder — only meaningful when variants differ.
function synthesizeTemplate(representative: string, hasVariants: boolean): string | null {
  if (!hasVariants) return null;
  let i = 0;
  const templated = representative.replace(/\d+(?:[.,]\d+)?/g, () => `{{n${++i}}}`);
  return i > 0 ? templated : null;
}

// Cluster a raw common-prompt list. Sorted by total count desc.
export function clusterCommon(raw: RawCommon[]): PromptCluster[] {
  const groups = new Map<string, RawCommon[]>();
  for (const r of raw) {
    const key = skeleton(r.prompt);
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const clusters: PromptCluster[] = [];
  for (const [key, members] of groups) {
    const distinct = new Set(members.map((m) => m.prompt));
    const representative = [...members].sort((a, b) => b.prompt.length - a.prompt.length)[0].prompt;
    const count = members.reduce((s, m) => s + m.count, 0);
    const lastSeen = members.reduce((a, m) => (m.lastSeen > a ? m.lastSeen : a), members[0].lastSeen);
    clusters.push({
      id: key.slice(0, 32) || representative.slice(0, 32),
      title: titleize(representative),
      category: categorize(representative),
      representative,
      template: synthesizeTemplate(representative, distinct.size > 1),
      count,
      variants: distinct.size,
      lastSeen,
      noise: isNoise(representative),
    });
  }
  return clusters.sort((a, b) => b.count - a.count);
}
