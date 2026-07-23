export { runCli, type RunCliOptions, type RunCliResult } from "./runCli.js";
export { colorEnabled, paint, style } from "./style.js";
export {
  catFrame,
  spinnerEnabled,
  startCatSpinner,
  type CatSpinner,
  type StartCatSpinnerOptions,
} from "./spinner.js";
export { runDoctor, type RunDoctorOptions } from "./doctor.js";
export { collectDoctorChecks, type DoctorDeps } from "./doctorChecks.js";
export type { DoctorCheck, DoctorReport, DoctorSeverity } from "./doctorTypes.js";
