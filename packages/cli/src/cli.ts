/**
 * User-facing CLI entry: `purrcode <command>` (PC-306).
 */
import { runCli } from "./cli/runCli.js";

const { exitCode } = await runCli();
process.exit(exitCode);
