/**
 * Wire contracts shared by the API server and the web client.
 *
 * These are plain, JSON-serialisable shapes. The server's domain objects
 * (Attempt, DesignModel, Problem, ...) expose `toDto()` / `toSnapshot()`
 * methods that produce these types; the same shapes are what the repository
 * persists, so there is exactly one serialisation format to reason about.
 */

// ── vocabulary ──────────────────────────────────────────────────────────────

export type Difficulty = 'easy' | 'medium' | 'hard';

export type ClassKind = 'class' | 'interface' | 'abstract' | 'enum';

export type RelationKind =
  | 'inheritance' // child extends parent
  | 'realization' // class implements interface
  | 'composition' // whole owns part (part cannot outlive whole)
  | 'aggregation' // whole has part (part can live on its own)
  | 'association' // holds a reference / collaborates over time
  | 'dependency'; // uses transiently (parameter, local)

export type DimensionId =
  | 'requirements'
  | 'responsibilities'
  | 'abstractions'
  | 'extensibility'
  | 'communication';

export const DIMENSION_IDS: readonly DimensionId[] = [
  'requirements',
  'responsibilities',
  'abstractions',
  'extensibility',
  'communication',
] as const;

export type Severity = 'critical' | 'major' | 'minor' | 'strength';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingSource = 'rules' | 'ai';

export type AttemptStatus =
  | 'DRAFT' // learner is still working
  | 'SUBMITTED' // accepted, queued for evaluation
  | 'EVALUATING' // a worker is running the pipeline
  | 'EVALUATED' // every evaluator succeeded
  | 'PARTIALLY_EVALUATED' // useful feedback exists, but at least one evaluator failed
  | 'EVALUATION_FAILED'; // nothing usable was produced; retry is offered

// ── problems ────────────────────────────────────────────────────────────────

export interface RequirementDto {
  id: string;
  text: string;
}

export interface ChangeScenarioDto {
  id: string;
  prompt: string;
}

export interface ProblemSummaryDto {
  id: string;
  title: string;
  difficulty: Difficulty;
  tagline: string;
  tags: string[];
  estimatedMinutes: number;
}

/** A problem as listed on the home page, with the current learner's progress on it. */
export interface ProblemListItemDto extends ProblemSummaryDto {
  attemptCount: number;
  bestScore?: number;
  latestScore?: number;
  latestBand?: string;
  /** An unsubmitted attempt the learner can pick up again. */
  openDraftId?: string;
}

export interface ProblemDto extends ProblemSummaryDto {
  context: string;
  requirements: RequirementDto[];
  constraints: string[];
  outOfScope: string[];
  scenarios: ChangeScenarioDto[];
  hints: string[];
}

/** A known-valid way to approach a problem. Shown only after the learner has submitted. */
export interface ApproachDto {
  title: string;
  summary: string;
  whenItFits: string;
  tradeoffs: string[];
  patterns: string[];
}

// ── design model ────────────────────────────────────────────────────────────

export interface ClassSpecDto {
  name: string;
  kind: ClassKind;
  responsibility: string;
  attributes: string[];
  methods: string[];
}

export interface RelationshipDto {
  from: string;
  to: string;
  kind: RelationKind;
  label?: string;
}

export interface DesignModelDto {
  classes: ClassSpecDto[];
  relationships: RelationshipDto[];
}

// ── submission formats ──────────────────────────────────────────────────────

export interface FormatInfoDto {
  id: string;
  label: string;
  description: string;
  /** A valid, mostly-empty payload the editor can start from. */
  starter: unknown;
}

export interface ParseIssueDto {
  severity: 'error' | 'warning';
  message: string;
  /** Where to look: a line number, a class name, a field path. */
  location?: string;
}

export interface PreflightDto {
  ok: boolean;
  issues: ParseIssueDto[];
  stats?: { classes: number; relationships: number; withResponsibility: number; abstractions: number };
  /** Parsed model, so the client can render a diagram for any format. */
  model?: DesignModelDto;
}

// ── attempts ────────────────────────────────────────────────────────────────

export interface DraftDto {
  format: string;
  /** Format-specific payload; validated by the matching SubmissionFormat. */
  design: unknown;
  assumptions: string;
  decisions: string;
  /** Answers to the problem's change scenarios, keyed by scenario id. */
  scenarioAnswers: Record<string, string>;
  /** Incremented on every save; used to reject stale autosaves. */
  revision: number;
}

export interface DraftInputDto {
  format: string;
  design: unknown;
  assumptions: string;
  decisions: string;
  scenarioAnswers: Record<string, string>;
}

export interface SubmissionDto {
  format: string;
  design: unknown;
  assumptions: string;
  decisions: string;
  scenarioAnswers: Record<string, string>;
  /** The format-independent model every evaluator actually reads. */
  model: DesignModelDto;
  submittedAt: string;
}

// ── evaluation ──────────────────────────────────────────────────────────────

export interface EvidenceDto {
  kind: 'class' | 'relationship' | 'requirement' | 'capability' | 'scenario' | 'text';
  ref: string;
  note?: string;
}

export interface FindingDto {
  /** Stable across attempts for rule findings (ruleId + subject), so attempts can be compared. */
  id: string;
  ruleId: string;
  dimension: DimensionId;
  severity: Severity;
  title: string;
  /** Why this matters. */
  detail: string;
  /** What to try. */
  suggestion?: string;
  evidence: EvidenceDto[];
  source: FindingSource;
  confidence: Confidence;
  /** Set when the AI reviewer thinks a rule finding does not apply to this design. */
  disputedReason?: string;
}

export interface DimensionScoreDto {
  dimension: DimensionId;
  label: string;
  /** 0–4, one decimal. */
  score: number;
  band: string;
  /** Plain-language reasons the score is what it is. */
  rationale: string[];
  /** Guardrails that limited the score (e.g. "capped at 1.5: too few classes to judge"). */
  caps: string[];
  sources: FindingSource[];
}

export interface CapabilityCoverageDto {
  id: string;
  label: string;
  requirementIds: string[];
  status: 'covered' | 'partial' | 'missing';
  matchedClasses: string[];
}

export interface NextStepDto {
  findingId: string;
  headline: string;
  action: string;
}

export interface AlternativeNoteDto {
  observation: string;
  whyValid: string;
  tradeoff: string;
}

export interface EvaluatorRunDto {
  evaluatorId: string;
  kind: 'deterministic' | 'ai';
  label: string;
  status: 'ok' | 'failed' | 'timed_out';
  durationMs: number;
  attempts: number;
  error?: string;
  model?: string;
}

export interface EvaluationReportDto {
  /** False while only the fast deterministic pass has finished. */
  provisional: boolean;
  /** True when every configured evaluator succeeded. */
  complete: boolean;
  overall: number;
  band: string;
  dimensions: DimensionScoreDto[];
  findings: FindingDto[];
  nextSteps: NextStepDto[];
  coverage: CapabilityCoverageDto[];
  alternatives: AlternativeNoteDto[];
  summary?: string;
  reflectionQuestions: string[];
  runs: EvaluatorRunDto[];
  generatedAt: string;
}

export interface EvaluationStateDto {
  /** How many times the pipeline has been started for this attempt. */
  runsStarted: number;
  lastError?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
}

export interface AttemptDto {
  id: string;
  problemId: string;
  problemTitle: string;
  /** 1-based, per learner per problem. */
  number: number;
  status: AttemptStatus;
  basedOnAttemptId?: string;
  draft: DraftDto;
  submission?: SubmissionDto;
  report?: EvaluationReportDto;
  evaluation: EvaluationStateDto;
  /** Whether an AI reviewer is configured on this server. */
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export interface AttemptSummaryDto {
  id: string;
  problemId: string;
  problemTitle: string;
  number: number;
  status: AttemptStatus;
  overall?: number;
  band?: string;
  dimensionScores?: Partial<Record<DimensionId, number>>;
  complete?: boolean;
  createdAt: string;
  submittedAt?: string;
}

// ── progress ────────────────────────────────────────────────────────────────

export interface FindingRefDto {
  id: string;
  title: string;
  dimension: DimensionId;
  severity: Severity;
}

export interface ComparisonDto {
  fromAttemptId: string;
  toAttemptId: string;
  fromNumber: number;
  toNumber: number;
  overallDelta: number;
  dimensionDeltas: { dimension: DimensionId; from: number; to: number; delta: number }[];
  /** Rule findings present before and gone now. */
  resolved: FindingRefDto[];
  /** Rule findings present in both. */
  persisting: FindingRefDto[];
  /** Rule findings that are new. */
  introduced: FindingRefDto[];
  /** Set when the two attempts were not evaluated the same way (for example one had no AI review). */
  caveat?: string;
}

export interface ProgressDto {
  problemId: string;
  attempts: AttemptSummaryDto[];
  /** Latest evaluated attempt vs the one before it. Absent with fewer than two. */
  comparison?: ComparisonDto;
}

// ── errors ──────────────────────────────────────────────────────────────────

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
