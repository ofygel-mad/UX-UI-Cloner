import path from "node:path";
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(desktopRoot, "..", "..");
const releaseRoot = path.join(desktopRoot, "release");
const prepackagedRoot = path.join(desktopRoot, "dist", "prepackaged-win-unpacked");
const shortWorkspaceRoot = "C:\\fcbbuild-release";
const launcherExeName = "Frontend Capture Browser.exe";
const runtimeExeName = "Frontend Capture Browser Runtime.exe";
const mode = process.argv[2] || "win";
const require = createRequire(import.meta.url);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const useShell =
      options.shell ??
      (process.platform === "win32" && /\.(cmd|bat)$/i.test(command));
    const child = spawn(command, args, {
      cwd: desktopRoot,
      stdio: "inherit",
      shell: useShell,
      env: {
        ...process.env,
        ...options.env
      },
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getPnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function getElectronBuilderArgs(targetMode) {
  if (targetMode === "dir") {
    return ["--dir"];
  }

  if (targetMode === "portable") {
    return ["--win", "portable"];
  }

  if (targetMode === "win") {
    return ["--win", "nsis"];
  }

  throw new Error(`Unsupported packaging mode: ${targetMode}`);
}

function getPrepackagedArgs(targetMode, prepackagedDir) {
  if (targetMode === "portable") {
    return ["--prepackaged", prepackagedDir, "--win", "portable"];
  }

  if (targetMode === "win") {
    return ["--prepackaged", prepackagedDir, "--win", "nsis"];
  }

  throw new Error(`Unsupported prepackaged mode: ${targetMode}`);
}

async function stopStaleWindowsProcesses(targetReleaseRoot) {
  if (process.platform !== "win32") {
    return;
  }

  const releasePath = targetReleaseRoot.replace(/'/g, "''");
  const script = `
$release = '${releasePath}'
$temp = [System.IO.Path]::GetTempPath()
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and (
      $_.ExecutablePath.StartsWith($release, [System.StringComparison]::OrdinalIgnoreCase) -or
      ($_.ExecutablePath.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase) -and $_.ExecutablePath -like '*Frontend Capture Browser*')
    )
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
`;

  await run("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: workspaceRoot
  });
}

async function cleanDirectory(targetPath) {
  const attempts = 6;

  for (let index = 0; index < attempts; index += 1) {
    try {
      await rm(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500
      });
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EBUSY" && error.code !== "EPERM") ||
        index === attempts - 1
      ) {
        throw error;
      }

      await stopStaleWindowsProcesses(targetPath);
      await sleep(1500);
    }
  }
}

async function wrapElectronExecutable(targetDir) {
  if (process.platform !== "win32") {
    return;
  }

  const launcherPath = path.join(targetDir, launcherExeName);
  const runtimePath = path.join(targetDir, runtimeExeName);

  await rm(runtimePath, { force: true });
  await rename(launcherPath, runtimePath);

  const escapedLauncherPath = launcherPath.replace(/'/g, "''");
  const escapedRuntimeName = runtimeExeName.replace(/'/g, "''");
  const source = [
    "using System;",
    "using System.Diagnostics;",
    "using System.IO;",
    "using System.Linq;",
    "",
    "public static class Program",
    "{",
    "    [STAThread]",
    "    public static void Main()",
    "    {",
    "        try",
    "        {",
    "            var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;",
    `            var runtimePath = Path.Combine(baseDirectory, "${escapedRuntimeName}");`,
    "            if (!File.Exists(runtimePath))",
    "            {",
    "                return;",
    "            }",
    "",
    "            var escapedRuntimePath = runtimePath.Replace(\"'\", \"''\");",
    "            var escapedBaseDirectory = baseDirectory.Replace(\"'\", \"''\");",
    '            var powerShellCommand = "$env:ELECTRON_RUN_AS_NODE=\'\'; Start-Process -FilePath \'" + escapedRuntimePath + "\' -WorkingDirectory \'" + escapedBaseDirectory + "\'";',
    "            var startInfo = new ProcessStartInfo",
    "            {",
    '                FileName = "powershell.exe",',
    '                Arguments = "-NoProfile -WindowStyle Hidden -Command " + QuoteArgument(powerShellCommand),',
    "                WorkingDirectory = baseDirectory,",
    "                UseShellExecute = false,",
    "                CreateNoWindow = true",
    "            };",
    "",
    "            Process.Start(startInfo);",
    "        }",
    "        catch (Exception error)",
    "        {",
    '            File.AppendAllText(Path.Combine(Path.GetTempPath(), "frontend-capture-browser-launcher.log"), error + Environment.NewLine);',
    "        }",
    "    }",
    "",
    "    private static string QuoteArgument(string value)",
    "    {",
    "        var quote = new string((char)34, 1);",
    '        return quote + (value ?? string.Empty).Replace(quote, "\\\\" + quote) + quote;',
    "    }",
    "}"
  ].join("\r\n");

  const script = `
Add-Type -TypeDefinition @'
${source}
'@ -Language CSharp -OutputAssembly '${escapedLauncherPath}' -OutputType WindowsApplication
`;

  await run("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: workspaceRoot
  });
}

async function buildInstallerLocally(targetMode) {
  await stopStaleWindowsProcesses(releaseRoot);
  await cleanDirectory(releaseRoot);
  await run(process.execPath, [path.join(__dirname, "build-desktop.mjs"), "--stage-playwright"]);

  const electronBuilderPackage = require.resolve("electron-builder/package.json");
  const electronBuilderCli = path.join(path.dirname(electronBuilderPackage), "cli.js");

  if (targetMode === "dir") {
    await run(process.execPath, [electronBuilderCli, ...getElectronBuilderArgs(targetMode)]);
    await wrapElectronExecutable(path.join(releaseRoot, "win-unpacked"));
    return;
  }

  await run(process.execPath, [electronBuilderCli, "--dir"]);
  await wrapElectronExecutable(path.join(releaseRoot, "win-unpacked"));
  await rm(prepackagedRoot, { recursive: true, force: true });
  await cp(path.join(releaseRoot, "win-unpacked"), prepackagedRoot, { recursive: true });
  await run(process.execPath, [electronBuilderCli, ...getPrepackagedArgs(targetMode, prepackagedRoot)]);
}

async function createShortWorkspaceCopy() {
  await cleanDirectory(shortWorkspaceRoot);

  const source = workspaceRoot.replace(/'/g, "''");
  const destination = shortWorkspaceRoot.replace(/'/g, "''");
  const script = [
    `$source = '${source}'`,
    `$destination = '${destination}'`,
    'robocopy $source $destination /MIR /XD "$source\\.git" "$source\\node_modules" "$source\\apps\\desktop\\release" "$source\\apps\\desktop\\dist" "$source\\apps\\api\\storage\\scans" "$source\\apps\\web\\dist" "$source\\apps\\api\\dist"',
    "$exitCode = $LASTEXITCODE",
    "if ($exitCode -gt 7) { exit $exitCode }"
  ].join("\n");

  await run("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: workspaceRoot
  });
}

async function copyReleaseArtifactsBack(shortReleaseRoot) {
  const entries = await readdir(shortReleaseRoot, { withFileTypes: true });
  const artifactNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".exe"))
    .map((entry) => entry.name);

  await cleanDirectory(releaseRoot);
  await mkdir(releaseRoot, { recursive: true });

  for (const artifactName of artifactNames) {
    await cp(path.join(shortReleaseRoot, artifactName), path.join(releaseRoot, artifactName));
  }
}

async function buildFromShortWorkspace(targetMode) {
  await createShortWorkspaceCopy();

  const pnpmCommand = getPnpmCommand();
  const shortDesktopRoot = path.join(shortWorkspaceRoot, "apps", "desktop");
  const shortReleaseRoot = path.join(shortDesktopRoot, "release");

  try {
    await run(
      pnpmCommand,
      ["install", "--force", "--config.confirmModulesPurge=false"],
      {
        cwd: shortWorkspaceRoot
      }
    );
    await run(pnpmCommand, ["rebuild", "esbuild", "electron"], {
      cwd: shortWorkspaceRoot
    });
    await run(process.execPath, [path.join(shortDesktopRoot, "scripts", "package-desktop.mjs"), `${targetMode}-direct`], {
      cwd: shortDesktopRoot
    });
    await copyReleaseArtifactsBack(shortReleaseRoot);
  } finally {
    await cleanDirectory(shortWorkspaceRoot);
  }
}

const directMode = mode.endsWith("-direct");
const targetMode = directMode ? mode.replace(/-direct$/, "") : mode;

if (directMode || targetMode === "dir") {
  await buildInstallerLocally(targetMode);
} else {
  await buildFromShortWorkspace(targetMode);
}
