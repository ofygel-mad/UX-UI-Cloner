import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { z } from "zod";
import { nanoid } from "nanoid";
import { captureSite } from "./capture/captureSite.js";
import { listStoredScans, loadStoredScan, resolveZipPath } from "./utils/scans.js";

export type CaptureJob = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  url: string;
  maxActionsPerPage: number;
  timeoutMs: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  scanId?: string;
  error?: string;
};

export type ApiServerHandle = {
  app: FastifyInstance;
  host: string;
  port: number;
  baseUrl: string;
};

function getStorageRoot(): string {
  return process.env.FCB_STORAGE_ROOT || path.join(process.cwd(), "storage");
}

export function buildApiApp(): FastifyInstance {
  const app = Fastify({
    logger: true
  });

  const CaptureBody = z.object({
    url: z.string().url(),
    maxActionsPerPage: z.number().int().min(0).max(50).optional(),
    timeoutMs: z.number().int().min(5000).max(120000).optional()
  });

  const jobs = new Map<string, CaptureJob>();
  const jobResults = new Map<string, Awaited<ReturnType<typeof captureSite>>>();
  const jobQueue: string[] = [];
  let activeJobId: string | null = null;

  async function processQueue(): Promise<void> {
    if (activeJobId || jobQueue.length === 0) return;

    const nextJobId = jobQueue.shift();
    if (!nextJobId) return;

    const job = jobs.get(nextJobId);
    if (!job) {
      await processQueue();
      return;
    }

    activeJobId = nextJobId;
    job.status = "running";
    job.startedAt = new Date().toISOString();

    try {
      const result = await captureSite({
        url: job.url,
        maxActionsPerPage: job.maxActionsPerPage,
        timeoutMs: job.timeoutMs
      });

      job.status = "completed";
      job.finishedAt = result.finishedAt;
      job.scanId = result.scanId;
      jobResults.set(job.jobId, result);
    } catch (error) {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      activeJobId = null;
      void processQueue();
    }
  }

  void app.register(cors, {
    origin: true
  });

  void app.register(staticPlugin, {
    root: getStorageRoot(),
    prefix: "/storage/"
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "frontend-capture-api",
      queue: {
        activeJobId,
        queued: jobQueue.length
      }
    };
  });

  app.post("/api/capture", async (request, reply) => {
    const parsed = CaptureBody.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
    }

    const jobId = nanoid(12);
    const job: CaptureJob = {
      jobId,
      status: "queued",
      url: parsed.data.url,
      maxActionsPerPage: parsed.data.maxActionsPerPage ?? 20,
      timeoutMs: parsed.data.timeoutMs ?? 45000,
      createdAt: new Date().toISOString()
    };

    jobs.set(jobId, job);
    jobQueue.push(jobId);
    void processQueue();

    return reply.status(202).send({
      jobId,
      status: job.status,
      url: job.url,
      createdAt: job.createdAt
    });
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = jobs.get(params.jobId);

    if (!job) {
      return reply.status(404).send({
        error: "Job not found"
      });
    }

    const result =
      job.scanId && job.status === "completed" ? await loadStoredScan(job.scanId) : null;

    return {
      ...job,
      result: result
        ? {
            scanId: result.scanId,
            finishedAt: result.finishedAt,
            summary: result.summary,
            downloadUrl: result.downloadUrl
          }
        : undefined
    };
  });

  app.get("/api/scans", async (request) => {
    const query = request.query as { limit?: string };
    const parsedLimit = Number(query.limit || 20);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;

    return {
      items: await listStoredScans(limit)
    };
  });

  app.get("/api/scans/:scanId", async (request, reply) => {
    const params = request.params as { scanId: string };
    const inMemory = Array.from(jobResults.values()).find((item) => item.scanId === params.scanId);
    const result = inMemory ? await loadStoredScan(inMemory.scanId) : await loadStoredScan(params.scanId);

    if (!result) {
      return reply.status(404).send({
        error: "Scan not found"
      });
    }

    return result;
  });

  app.get("/api/scans/diff", async (request, reply) => {
    const query = request.query as { a?: string; b?: string };
    if (!query.a || !query.b) {
      return reply.status(400).send({ error: "Provide both ?a=scanId&b=scanId query params" });
    }

    const [scanA, scanB] = await Promise.all([loadStoredScan(query.a), loadStoredScan(query.b)]);

    if (!scanA) return reply.status(404).send({ error: `Scan ${query.a} not found` });
    if (!scanB) return reply.status(404).send({ error: `Scan ${query.b} not found` });

    const hashMapA = new Map(scanA.resources.map((r: { url: string; sha256: string; kind: string; sizeBytes: number }) => [r.url, r]));
    const hashMapB = new Map(scanB.resources.map((r: { url: string; sha256: string; kind: string; sizeBytes: number }) => [r.url, r]));

    const added = scanB.resources.filter((r: { url: string }) => !hashMapA.has(r.url));
    const removed = scanA.resources.filter((r: { url: string }) => !hashMapB.has(r.url));
    const changed = scanB.resources.filter((r: { url: string; sha256: string }) => {
      const a = hashMapA.get(r.url);
      return a && a.sha256 !== r.sha256;
    });
    const unchanged = scanB.resources.filter((r: { url: string; sha256: string }) => {
      const a = hashMapA.get(r.url);
      return a && a.sha256 === r.sha256;
    });

    return {
      scanA: { scanId: scanA.scanId, url: scanA.url, finishedAt: scanA.finishedAt },
      scanB: { scanId: scanB.scanId, url: scanB.url, finishedAt: scanB.finishedAt },
      resources: {
        added: added.map((r: { url: string; kind: string; sizeBytes: number }) => ({ url: r.url, kind: r.kind, sizeBytes: r.sizeBytes })),
        removed: removed.map((r: { url: string; kind: string; sizeBytes: number }) => ({ url: r.url, kind: r.kind, sizeBytes: r.sizeBytes })),
        changed: changed.map((r: { url: string; kind: string; sizeBytes: number; sha256: string }) => ({
          url: r.url,
          kind: r.kind,
          sizeBytesA: hashMapA.get(r.url)?.sizeBytes,
          sizeBytesB: r.sizeBytes,
        })),
        unchangedCount: unchanged.length,
      },
      performance: {
        a: scanA.analysis?.performance ?? null,
        b: scanB.analysis?.performance ?? null,
      },
      security: {
        scoreA: scanA.analysis?.security?.score ?? null,
        scoreB: scanB.analysis?.security?.score ?? null,
      },
      frameworks: {
        a: scanA.analysis?.frameworks ?? [],
        b: scanB.analysis?.frameworks ?? [],
      },
      secrets: {
        countA: scanA.analysis?.secrets?.length ?? 0,
        countB: scanB.analysis?.secrets?.length ?? 0,
      },
    };
  });

  app.get("/api/scans/:scanId/download", async (request, reply) => {
    const params = request.params as { scanId: string };
    const result = await loadStoredScan(params.scanId);

    if (!result) {
      return reply.status(404).send({
        error: "Scan not found"
      });
    }

    const zipPath = resolveZipPath(result.scanFolder);

    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${result.scanId}.zip"`)
      .sendFile(path.basename(zipPath), path.dirname(zipPath));
  });

  return app;
}

export async function startApiServer(options?: {
  host?: string;
  port?: number;
}): Promise<ApiServerHandle> {
  const app = buildApiApp();
  const host = options?.host || process.env.HOST || "0.0.0.0";
  const port = options?.port ?? Number(process.env.PORT || 4000);
  const address = await app.listen({
    host,
    port
  });
  const parsed = typeof address === "string" ? new URL(address) : null;

  return {
    app,
    host: parsed?.hostname || host,
    port: parsed ? Number(parsed.port) : port,
    baseUrl: address
  };
}
