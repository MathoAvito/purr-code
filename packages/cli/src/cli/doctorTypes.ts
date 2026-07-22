export type DoctorSeverity = "ok" | "warn" | "fail";

export type DoctorCheck = {
  /** Stable id for tests / scripting. */
  id: string;
  status: DoctorSeverity;
  /** One-line summary (no meaning carried by color/emoji alone). */
  summary: string;
  /** Concrete fix when status is warn/fail. */
  fix?: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  /** True when no check has status `fail` (warns allowed). */
  healthy: boolean;
  exitCode: 0 | 1;
  verdict: string;
};
