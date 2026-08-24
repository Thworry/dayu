export type RepositoryModifier =
  | "new_repo"
  | "external_tracker"
  | "monorepo"
  | "binary_lfs"
  | "generated_heavy"
  | "mature_stable"
  | "fork"
  | "mirror"
  | "archived";

export interface ModifierInput {
  analyzedAt?: string;
  archived: boolean;
  createdAt?: string;
  files: readonly string[];
  fork: boolean;
  isTemplate: boolean;
  mirror: boolean;
  text: string;
  treeComplete: boolean;
  treeEntries: readonly { path: string; size: number | null }[];
}

const GENERATED_PATH = /^(?:dist|build|vendor|generated|coverage|public\/generated)(?:\/|$)/i;
const MANIFEST = /(?:^|\/)(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml)$/i;
const BINARY_FILE = /\.(?:7z|bin|blend|bz2|dmg|gif|glb|gz|ico|jpeg|jpg|mp3|mp4|onnx|otf|parquet|pdf|png|safetensors|tar|tflite|ttf|wav|webm|webp|woff2?|xz|zip)$/i;

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  if ([yearText, monthText, dayText, hourText, minuteText, secondText].some((part) => part === undefined)) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ageDays(createdAt: string | undefined, analyzedAt: string | undefined): number | null {
  if (createdAt === undefined || analyzedAt === undefined) return null;
  if (!validIsoDate(createdAt) || !validIsoDate(analyzedAt)) return null;
  const created = Date.parse(createdAt);
  const analyzed = Date.parse(analyzedAt);
  if (!Number.isFinite(created) || !Number.isFinite(analyzed) || analyzed < created) return null;
  return (analyzed - created) / 86_400_000;
}

export function detectModifiers(input: ModifierInput): RepositoryModifier[] {
  const modifiers: RepositoryModifier[] = [];
  const age = ageDays(input.createdAt, input.analyzedAt);
  if (age !== null && age < 30) modifiers.push("new_repo");
  if (/(?:atlassian\.net\/browse|\bjira\b|linear\.app\/|bugzilla|bugs\.chromium\.org|youtrack|external issue tracker)/i.test(input.text)) {
    modifiers.push("external_tracker");
  }
  const manifestsBelowRoot = input.files.filter((path) => path.includes("/") && MANIFEST.test(path));
  if (
    input.files.some((path) => /^(?:pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/i.test(path)) ||
    new Set(manifestsBelowRoot.map((path) => path.split("/")[0])).size >= 2
  ) modifiers.push("monorepo");
  const sizedEntries = input.treeEntries.filter((entry): entry is { path: string; size: number } => entry.size !== null);
  const binaryEntries = sizedEntries.filter((entry) => BINARY_FILE.test(entry.path));
  const totalBytes = sizedEntries.reduce((sum, entry) => sum + entry.size, 0);
  const binaryBytes = binaryEntries.reduce((sum, entry) => sum + entry.size, 0);
  const binaryHeavy = input.treeComplete && sizedEntries.length >= 2 && binaryEntries.length >= 1 && totalBytes > 0 && (
    binaryBytes / totalBytes >= 0.7 ||
    (binaryEntries.length >= 2 && binaryEntries.length / sizedEntries.length >= 0.6)
  );
  if ((input.files.includes(".gitattributes") && /filter\s*=\s*lfs/i.test(input.text)) || binaryHeavy) {
    modifiers.push("binary_lfs");
  }
  const classifiedFiles = input.files.filter((path) => !/^(?:readme|license)(?:\.|$)/i.test(path));
  if (input.treeComplete && classifiedFiles.length >= 4 && classifiedFiles.filter((path) => GENERATED_PATH.test(path)).length / classifiedFiles.length >= 0.5) {
    modifiers.push("generated_heavy");
  }
  if (age !== null && age >= 365 && /(?:\bstable\b.{0,40}\bfeature complete\b|\bmaintenance mode\b)/is.test(input.text)) {
    modifiers.push("mature_stable");
  }
  if (input.fork) modifiers.push("fork");
  if (input.mirror) modifiers.push("mirror");
  if (input.archived) modifiers.push("archived");
  return modifiers;
}
