/**
 * API client.
 *
 * Sessions ride on an httpOnly cookie, so there is no token to hold in
 * JavaScript and nothing to leak through storage. Every call therefore sends
 * credentials and the server decides what the caller may see.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code ?? 'unknown';
    this.details = body.error?.details;
    this.requestId = body.requestId;
  }

  /** Field-level problems, when the server sent them. */
  fieldErrors(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const details = this.details;
    if (Array.isArray(details)) {
      for (const item of details) {
        if (
          typeof item === 'object' &&
          item !== null &&
          'field' in item &&
          'message' in item &&
          typeof item.field === 'string' &&
          typeof item.message === 'string'
        ) {
          (out[item.field] ??= []).push(item.message);
        }
      }
    } else if (typeof details === 'object' && details !== null) {
      for (const [key, value] of Object.entries(details)) {
        if (Array.isArray(value)) out[key] = value.map(String);
      }
    }
    return out;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    // A network failure is not the same as a server error, and the message
    // should tell the user which one they are looking at.
    throw new ApiError(0, {
      error: {
        code: 'network_error',
        message: 'Could not reach the server. Check your connection and try again.',
      },
    });
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const shaped =
      body !== null && typeof body === 'object' && 'error' in body
        ? (body as ApiErrorBody)
        : {
            error: {
              code: 'unexpected_response',
              message: `The server returned ${response.status}.`,
            },
          };
    throw new ApiError(response.status, shaped);
  }

  return body as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Shapes returned by the API. Kept narrow: only what the interface reads.
// ---------------------------------------------------------------------------

export type RiskBand = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
export type ReadinessState = 'READY' | 'PARTIAL' | 'AT_RISK' | 'CRITICAL';
export type Tier = 'FIX_FIRST' | 'FIX_NEXT' | 'MONITOR';
export type Role = 'ADMIN' | 'LEADER' | 'OPERATOR' | 'VIEWER';

export interface Reason {
  code: string;
  dimension: string;
  statement: string;
  contribution: number;
  confidence: 'KNOWN' | 'ESTIMATED' | 'ASSUMED' | 'UNKNOWN' | 'UNVERIFIED';
}

export interface Risk {
  band: RiskBand;
  score: number;
  maxScore: number;
  reasons: Reason[];
  overrideRule?: string;
}

export interface FindingSummary {
  id: string;
  kind: string;
  subjectName: string;
  subjectKind: string;
  summary: string;
  risk: Risk;
  criticalDependents: number;
  tier: Tier;
  rationale: string;
}

export interface AssessmentResponse {
  generatedAt: string;
  model: { entityCount: number; dependencyCount: number };
  summary: { total: number; critical: number; high: number; moderate: number; low: number };
  tiers: Record<Tier, FindingSummary[]>;
  dataIssues: { severity: 'error' | 'warning'; code: string; message: string; subjectId: string }[];
}

export interface TradeOffs {
  cost: 'LOW' | 'MEDIUM' | 'HIGH';
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  time: 'LOW' | 'MEDIUM' | 'HIGH';
  operationalRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  disruption: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface SolutionOption {
  id: string;
  title: string;
  description: string;
  tradeOffs: TradeOffs;
  riskReduction: number;
  preconditions: string[];
  actions: { title: string; ownerHint: string; priority: 'P1' | 'P2' | 'P3'; verification: string }[];
  verification: string;
}

export interface SolutionsResponse {
  finding: {
    id: string;
    kind: string;
    subjectName: string;
    subjectKind: string;
    summary: string;
    risk: Risk;
    dependentIds: string[];
    criticalDependentIds: string[];
  };
  solutions: {
    findingId: string;
    problem: string;
    whyItMatters: string;
    options: SolutionOption[];
    recommendedOptionId: string;
    recommendationRationale: string;
  };
}

export interface ImpactedEntity {
  entityId: string;
  name: string;
  kind: string;
  state: 'FAILED' | 'DEGRADED' | 'AT_RISK' | 'UNAFFECTED';
  wave: number;
  path: string[];
  explanation: string;
}

export interface ScenarioResult {
  impacted: ImpactedEntity[];
  waves: ImpactedEntity[][];
  failedFunctions: ImpactedEntity[];
  fallbacksUsed: { dependentId: string; failedProviderId: string; fallbackProviderId: string }[];
  missingFallbacks: { dependentId: string; failedProviderId: string }[];
  assumptions: string[];
}

export interface ActionRecord {
  id: string;
  title: string;
  status: 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  priority: 'P1' | 'P2' | 'P3';
  ownerHint: string | null;
  findingRef: string | null;
  verification: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface EntitySummary {
  ref: string;
  kind: string;
  name: string;
  criticality: string | null;
  ownerRef: string | null;
}

export interface ReadinessAssessment {
  subjectId: string;
  subjectName: string;
  subjectKind: string;
  state: ReadinessState;
  checks: { code: string; label: string; passed: boolean; unknown: boolean; detail: string }[];
  passedCount: number;
  applicableCount: number;
  unknownCount: number;
  summary: string;
}

export interface MeResponse {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  organizations: { id: string; name: string; isDemo: boolean; timezone: string; role: Role }[];
  capabilities: { googleSignIn: boolean; emailDelivery: boolean; demoMode: boolean };
}
