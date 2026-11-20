export type FindingStatus = 'Pass' | 'Warning' | 'Fail' | 'Review' | 'N/A';
export type Classification = 'deterministic' | 'heuristic' | 'manual';
export type ObjectKind = 'model' | 'table' | 'column' | 'measure' | 'relationship' | 'ai-artifact';
export type AcquisitionState = 'complete' | 'partial' | 'denied' | 'unsupported' | 'error';

export type Observation<T> =
  | { readonly state: 'observed'; readonly value: T }
  | {
      readonly state: 'unavailable';
      readonly reason: string;
      readonly acquisition: Exclude<AcquisitionState, 'complete'>;
    }
  | { readonly state: 'not-applicable'; readonly reason: string };

export type Capability = 'item-read' | 'info-view' | 'definition' | 'ai-artifacts';

export interface EvidenceScope {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly modelId: string;
  readonly visibilityFingerprint: string;
  readonly inventory: 'authoring' | 'consumer';
  readonly capabilities: Readonly<Record<Capability, AcquisitionState>>;
}

export interface ObjectReference {
  readonly kind: ObjectKind;
  readonly qualifiedId: string;
  readonly lineageId: Observation<string>;
  readonly displayName: Observation<string>;
}

export type MetadataProperty =
  | 'name'
  | 'description'
  | 'isHidden'
  | 'dataType'
  | 'isKey'
  | 'summarizeBy'
  | 'isActive'
  | 'cardinality'
  | 'filterDirection'
  | 'dateCategory'
  | 'synonyms'
  | 'aiVisibility'
  | 'aiInstructionsPresent';

export type MetadataValue = string | number | boolean | null | readonly string[];

export interface ObjectSnapshot {
  readonly object: ObjectReference;
  readonly parentId?: string;
  readonly properties: Readonly<Partial<Record<MetadataProperty, Observation<MetadataValue>>>>;
  readonly propertyHashes: Readonly<Partial<Record<MetadataProperty, string>>>;
}

export interface NormalizedSnapshot {
  readonly id: string;
  readonly acquiredAt: string;
  readonly scannerVersion: string;
  readonly scope: EvidenceScope;
  readonly acquisition: AcquisitionState;
  readonly objects: readonly ObjectSnapshot[];
}

export interface Finding {
  readonly id: string;
  readonly snapshotId: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly object: ObjectReference;
  readonly status: FindingStatus;
  readonly classification: Classification;
  readonly evidence: readonly {
    readonly property: MetadataProperty;
    readonly observation: Observation<MetadataValue>;
  }[];
  readonly explanation: string;
  readonly impact: string;
  readonly remediation: string;
  readonly scope: EvidenceScope;
  readonly scannedAt: string;
}

export interface DescriptionCoverage {
  readonly objectKind: 'table' | 'column' | 'measure';
  readonly scope: 'visible-business' | 'hidden-system';
  readonly documented: number;
  readonly eligible: number;
  readonly excluded: number;
  readonly acquisition: AcquisitionState;
}

export interface FindingException {
  readonly id: string;
  readonly findingId: string;
  readonly reason: string;
  readonly approvedBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type ValidationState =
  | { readonly state: 'unvalidated' }
  | {
      readonly state: 'current' | 'stale';
      readonly reviewerId: string;
      readonly reviewedAt: string;
      readonly snapshotId: string;
      readonly evidenceScopeFingerprint: string;
      readonly policyVersion: string;
      readonly scannerVersion: string;
      readonly evidenceReference: string;
    };

export interface RuleDefinition {
  readonly id: string;
  readonly name: string;
  readonly group: 'Documentation' | 'Model structure' | 'AI artifacts' | 'Human validation';
  readonly classification: Classification;
  readonly evidence: string;
  readonly impact: string;
  readonly boundary: string;
  readonly remediation: string;
}

export const DRAFT_POLICY_VERSION = '1.0.0-draft';

export const RULE_CATALOG: readonly RuleDefinition[] = [
  {
    id: 'DOC-001',
    name: 'Business object descriptions',
    group: 'Documentation',
    classification: 'deterministic',
    evidence: 'Observed descriptions on eligible tables, columns, and measures.',
    impact: 'Descriptions give model consumers and AI experiences explicit business context.',
    boundary: 'Presence does not prove accuracy. Unavailable evidence is Review, not a missing description.',
    remediation: 'Have the model owner document eligible business objects and validate the wording.',
  },
  {
    id: 'NAME-001',
    name: 'Customer naming policy',
    group: 'Documentation',
    classification: 'deterministic',
    evidence: 'Observed names compared with an explicitly configured customer naming policy.',
    impact: 'Consistent names make the model easier to navigate.',
    boundary: 'There is no universal business naming standard. This check needs a customer policy.',
    remediation: 'Agree on naming conventions and review violations with the model owner.',
  },
  {
    id: 'NAME-002',
    name: 'Normalized name collisions',
    group: 'Documentation',
    classification: 'heuristic',
    evidence: 'Normalized names within the same relevant naming scope.',
    impact: 'Some collisions make object selection ambiguous.',
    boundary: 'Valid repeated names are not automatically failures.',
    remediation: 'Review the affected scope and qualify names only where ambiguity is confirmed.',
  },
  {
    id: 'VIS-001',
    name: 'Technical fields and identifiers',
    group: 'Model structure',
    classification: 'heuristic',
    evidence: 'Effective parent and object visibility, types, key signals, relationships, and SummarizeBy.',
    impact: 'Exposed technical fields and unintended aggregation can confuse consumers.',
    boundary: 'Inferred technical roles must disclose their signals and remain reviewable.',
    remediation: 'Review effective visibility and default summarization with the model owner.',
  },
  {
    id: 'MEASURE-001',
    name: 'Governed measure candidates',
    group: 'Model structure',
    classification: 'heuristic',
    evidence: 'Numeric fields, explicit measure inventory, and authorized dependency metadata.',
    impact: 'Explicit measures can make business calculations more consistent.',
    boundary: 'A numeric column is only a candidate. Dependencies cannot be inferred with string matching.',
    remediation: 'Ask the model owner which calculations should become governed measures.',
  },
  {
    id: 'REL-001',
    name: 'Relationship graph risks',
    group: 'Model structure',
    classification: 'heuristic',
    evidence: 'Observed active state, cardinality, filter direction, and graph structure.',
    impact: 'Relationship patterns can affect filtering and interpretation.',
    boundary: 'Inactive, bidirectional, and many-to-many relationships can be intentional. No integrity claim is made.',
    remediation: 'Review flagged paths against intended business filtering behavior.',
  },
  {
    id: 'DATE-001',
    name: 'Date metadata indicators',
    group: 'Model structure',
    classification: 'heuristic',
    evidence: 'Date types, table and category metadata, relationships, and accessible calendars.',
    impact: 'Clear date semantics help consumers select the intended business calendar.',
    boundary: 'Fiscal semantics need customer policy. Metadata cannot establish date continuity.',
    remediation: 'Document calendar roles and validate time behavior with the model owner.',
  },
  {
    id: 'AI-001',
    name: 'AI schema and synonyms',
    group: 'AI artifacts',
    classification: 'deterministic',
    evidence: 'An authorized artifact with a supported published schema version.',
    impact: 'AI-specific metadata can clarify which objects and terms an experience uses.',
    boundary: 'Auto, inheritance, and hierarchy semantics must be respected. A missing entry is not proof of exclusion.',
    remediation: 'Inspect the supported artifact contract; otherwise retain Review with the acquisition limitation.',
  },
  {
    id: 'AI-002',
    name: 'AI instructions',
    group: 'AI artifacts',
    classification: 'manual',
    evidence: 'Authorized instruction presence and separately recorded human review.',
    impact: 'Instructions can supply business context, but their quality requires human judgment.',
    boundary: 'Instruction content is untrusted metadata, never executable scanner instructions.',
    remediation: 'Have a reviewer validate business quality against the recorded evidence scope.',
  },
  {
    id: 'AI-003',
    name: 'Verified answers',
    group: 'AI artifacts',
    classification: 'manual',
    evidence: 'Content exposed by a validated supported acquisition contract.',
    impact: 'Verified answers may help cover important business questions.',
    boundary: 'Folder existence does not establish an answer count or coverage. Unsupported acquisition remains Review.',
    remediation: 'Confirm the supported contract or record the unavailable evidence and a manual next action.',
  },
  {
    id: 'VALIDATE-001',
    name: 'Copilot testing and attestation',
    group: 'Human validation',
    classification: 'manual',
    evidence: 'Reviewer evidence tied to the exact snapshot, policy, scanner, and visibility scope.',
    impact: 'Human testing checks behavior that metadata completeness cannot establish.',
    boundary: 'No platform approval is inferred. Relevant observable changes make recorded validation stale.',
    remediation: 'Run representative Copilot tests and record scoped evidence after authorized scanning is available.',
  },
];
