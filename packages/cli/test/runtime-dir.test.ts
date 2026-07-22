import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RuntimeDirError, ensureRuntimeDir, resolveRuntimeDirPath } from "../src/runtime/index.js";

describe("resolveRuntimeDirPath", () => {
  it("Linux prefers XDG_RUNTIME_DIR/purrcode", () => {
    expect(
      resolveRuntimeDirPath({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: "/run/user/1000" },
        uid: 1000,
      }),
    ).toBe(join("/run/user/1000", "purrcode"));
  });

  it("Linux falls back to /tmp/purrcode-$UID when XDG_RUNTIME_DIR unset", () => {
    expect(
      resolveRuntimeDirPath({
        platform: "linux",
        env: {},
        uid: 1000,
      }),
    ).toBe(join("/tmp", "purrcode-1000"));
  });

  it("macOS uses TMPDIR/purrcode", () => {
    expect(
      resolveRuntimeDirPath({
        platform: "darwin",
        env: { TMPDIR: "/var/folders/xx/T/" },
      }),
    ).toBe(join("/var/folders/xx/T/", "purrcode"));
  });

  it("Windows uses LOCALAPPDATA\\PurrCode\\runtime", () => {
    expect(
      resolveRuntimeDirPath({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      }),
    ).toBe(join("C:\\Users\\me\\AppData\\Local", "PurrCode", "runtime"));
  });

  it("throws when Linux fallback cannot determine UID", () => {
    expect(() =>
      resolveRuntimeDirPath({
        platform: "linux",
        env: {},
        uid: undefined,
      }),
    ).toThrow(RuntimeDirError);
  });

  it("honors PURRCODE_RUNTIME_DIR over platform defaults", () => {
    expect(
      resolveRuntimeDirPath({
        platform: "linux",
        env: { PURRCODE_RUNTIME_DIR: "/tmp/purr-override", XDG_RUNTIME_DIR: "/run/user/1" },
        uid: undefined,
      }),
    ).toBe("/tmp/purr-override");
  });
});

describe("ensureRuntimeDir", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function tempBase(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-runtime-"));
    dirs.push(dir);
    return dir;
  }

  it("creates a 0700 directory and returns its path (fallback chain)", async () => {
    if (process.platform === "win32") return;

    const base = await tempBase();
    const path = await ensureRuntimeDir({
      platform: "linux",
      env: { XDG_RUNTIME_DIR: base },
      uid: process.getuid?.(),
    });

    expect(path).toBe(join(base, "purrcode"));
    const st = await lstat(path);
    expect(st.isDirectory()).toBe(true);
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.uid).toBe(process.getuid?.());
    expect(st.mode & 0o777).toBe(0o700);
  });

  it("accepts an already-created safe directory", async () => {
    if (process.platform === "win32") return;

    const base = await tempBase();
    const target = join(base, "purrcode");
    await mkdir(target, { recursive: true, mode: 0o700 });
    await chmod(target, 0o700);

    const path = await ensureRuntimeDir({
      platform: "linux",
      env: { XDG_RUNTIME_DIR: base },
      uid: process.getuid?.(),
    });
    expect(path).toBe(target);
  });

  it("rejects a pre-created symlink", async () => {
    if (process.platform === "win32") return;

    const base = await tempBase();
    const real = join(base, "real");
    const link = join(base, "purrcode");
    await mkdir(real, { recursive: true, mode: 0o700 });
    await symlink(real, link);

    await expect(
      ensureRuntimeDir({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: base },
        uid: process.getuid?.(),
      }),
    ).rejects.toMatchObject({ code: "symlink" } satisfies Partial<RuntimeDirError>);
  });

  it("rejects wrong owner (where testable via uid override)", async () => {
    if (process.platform === "win32") return;

    const base = await tempBase();
    const uid = process.getuid?.();
    expect(uid).toBeTypeOf("number");

    await expect(
      ensureRuntimeDir({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: base },
        uid: (uid as number) + 1,
      }),
    ).rejects.toMatchObject({ code: "wrong-owner" } satisfies Partial<RuntimeDirError>);
  });

  it("rejects when the path is a regular file", async () => {
    if (process.platform === "win32") return;

    const base = await tempBase();
    const file = join(base, "purrcode");
    await writeFile(file, "not a dir");

    await expect(
      ensureRuntimeDir({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: base },
        uid: process.getuid?.(),
      }),
    ).rejects.toMatchObject({ code: "not-directory" } satisfies Partial<RuntimeDirError>);
  });

  it("exercises macOS TMPDIR resolution end-to-end", async () => {
    if (process.platform === "win32") return;

    const base = await tempBase();
    const path = await ensureRuntimeDir({
      platform: "darwin",
      env: { TMPDIR: base },
      uid: process.getuid?.(),
    });
    expect(path).toBe(join(base, "purrcode"));
    expect((await lstat(path)).isDirectory()).toBe(true);
  });

  it("exercises Windows LOCALAPPDATA resolution (path only on non-win hosts)", async () => {
    const base = await tempBase();
    if (process.platform === "win32") {
      const path = await ensureRuntimeDir({
        platform: "win32",
        env: { LOCALAPPDATA: base },
      });
      expect(path).toBe(join(base, "PurrCode", "runtime"));
      expect((await lstat(path)).isDirectory()).toBe(true);
      return;
    }

    // On Unix CI, still verify the resolver + mkdir shape under an injected win32 platform.
    const path = await ensureRuntimeDir({
      platform: "win32",
      env: { LOCALAPPDATA: base },
      // win32 branch skips uid checks; fs is real.
    });
    expect(path).toBe(join(base, "PurrCode", "runtime"));
    expect((await lstat(path)).isDirectory()).toBe(true);
  });
});
