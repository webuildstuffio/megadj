export interface CheckResult {
  id: string;
  label: string;
  /** required = toolkit unusable without it; optional = feature-scoped. */
  required: boolean;
  ok: boolean;
  detail: string;
  fix?: string | undefined;
}
