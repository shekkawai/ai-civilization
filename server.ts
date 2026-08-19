import { serveStatic } from "hono/bun";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { ResearchStore, DEFAULT_SEASON_CONFIG, type SeasonConfig } from "./src/research/store";
import type { CivId } from "./src/sim/types";

type Mode = "development" | "production";
const app = new Hono();

const mode: Mode =
  process.env.NODE_ENV === "production" ? "production" : "development";
const research = new ResearchStore(process.env.AI_CIVILIZATION_DB ?? `${process.cwd()}/data/research.sqlite`);

app.get("/api/research/status", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  return c.json(seasonId ? research.status(seasonId) : null);
});

app.get("/api/research/spectator", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json(null);
  return c.json(research.spectator(seasonId));
});

app.get("/api/research/seasons", (c) => c.json(research.seasons()));

app.get("/api/research/report", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json(null);
  return c.json(research.report(seasonId));
});

app.get("/api/research/replay", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  const turn = Number(c.req.query("turn") ?? 0);
  if (!seasonId || !Number.isFinite(turn)) return c.json(null);
  return c.json(research.replayFrame(seasonId, turn));
});

app.get("/api/research/summary", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json(null);
  return c.json(research.getSummary(seasonId));
});

app.get("/api/research/trends", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  return c.json(research.getTrends(seasonId));
});

app.get("/api/research/verify", (c) => {
  const seasonId = c.req.query("seasonId");
  if (!seasonId) return c.json(null);
  return c.json(research.verifyReplay(seasonId));
});

app.get("/api/research/events", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  const throughTurn = Number(c.req.query("throughTurn") ?? Number.MAX_SAFE_INTEGER);
  if (!seasonId || !Number.isFinite(throughTurn)) return c.json([]);
  return c.json(research.events(seasonId, throughTurn));
});

app.get("/api/research/series", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  return c.json(research.turnSeries(seasonId));
});

app.get("/api/research/loom", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  return c.json(research.loom(seasonId));
});

app.get("/api/research/harvest", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  return c.json(research.harvestSeries(seasonId));
});

app.get("/api/research/efficiency", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  const throughTurn = Number(c.req.query("turn"));
  if (!seasonId || !Number.isFinite(throughTurn)) return c.json([]);
  return c.json(research.efficiency(seasonId, throughTurn));
});

app.get("/api/research/logistics", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json({ points: [], stores: [] });
  return c.json(research.logistics(seasonId));
});

app.get("/api/research/pressure", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  return c.json(research.pressure(seasonId));
});

app.get("/api/research/worker", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  const workerId = c.req.query("workerId");
  if (!seasonId || !workerId) return c.json([]);
  return c.json(research.workerHistory(seasonId, workerId));
});

app.get("/api/research/turn-detail", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  const turn = Number(c.req.query("turn") ?? 0);
  if (!seasonId || !Number.isFinite(turn)) return c.json(null);
  return c.json(research.turnDetail(seasonId, turn));
});

app.get("/api/research/landmarks", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  return c.json(research.landmarks(seasonId));
});

/**
 * The correspondence between the two civilizations, in full. `turn` clips it to the playhead so a
 * replay never shows a letter that has not been written yet.
 */
app.get("/api/research/messages", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json([]);
  const through = Number(c.req.query("turn"));
  const messages = research.messages(seasonId);
  if (!Number.isFinite(through)) return c.json(messages);
  return c.json(messages.filter((message) => message.sentTurn <= through));
});

/**
 * Every piece of text a civilization wrote for itself — standing orders, notebook, chronicle and
 * journal — with the turn each version was written. `turn` clips it to the playhead for the same
 * reason the letters are clipped: a replay must not show a note that had not been written yet.
 */
app.get("/api/research/memory", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  if (!seasonId) return c.json(null);
  const turn = Number(c.req.query("turn"));
  return c.json(research.memory(seasonId, Number.isFinite(turn) ? turn : undefined));
});

app.get("/api/research/archive", (c) => {
  const seasonId = c.req.query("seasonId") ?? research.latestSeason()?.id;
  const turn = c.req.query("turn");
  if (!seasonId) return c.json(null);
  return c.json(research.archive(seasonId, turn ? Number(turn) : undefined));
});

app.post("/api/research/season", async (c) => {
  if (!researchAuthorized(c.req.header("authorization"))) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{
    seed?: number;
    id?: string;
    maxTurns?: number | null;
    maxModelRuns?: number | null;
    /** Which model plays which spawn. Rotate between seasons so a result is not a spawn artefact. */
    models?: SeasonConfig["models"];
    swapSides?: boolean;
    /** Commit the engine was launched from. Falls back to GIT_COMMIT, which the dev
     * service does not carry — without this a locally created season records
     * "working-tree" and loses the provenance every archived-season tag depends on. */
    codeCommit?: string;
  }>();
  if (body.models && body.swapSides) {
    return c.json({ error: "Pass either models or swapSides, not both" }, 400);
  }
  let models = body.models ?? DEFAULT_SEASON_CONFIG.models;
  if (body.swapSides) models = { north: DEFAULT_SEASON_CONFIG.models.south, south: DEFAULT_SEASON_CONFIG.models.north };
  for (const civ of ["north", "south"] as CivId[]) {
    const entry = models[civ];
    if (!entry?.provider || !entry.model || !entry.reasoning) {
      return c.json({ error: `models.${civ} needs provider, model and reasoning` }, 400);
    }
  }
  const config = {
    ...DEFAULT_SEASON_CONFIG,
    maxTurns: body.maxTurns === undefined ? DEFAULT_SEASON_CONFIG.maxTurns : body.maxTurns,
    maxModelRuns: body.maxModelRuns === undefined ? DEFAULT_SEASON_CONFIG.maxModelRuns : body.maxModelRuns,
    models,
  };
  const id = research.createSeason(
    body.seed ?? 20260802,
    config,
    body.id,
    body.codeCommit ?? process.env.GIT_COMMIT ?? "working-tree",
  );
  return c.json({ id, status: research.status(id) }, 201);
});

app.post("/api/research/claim", async (c) => {
  if (!researchAuthorized(c.req.header("authorization"))) return c.json({ error: "Unauthorized" }, 401);
  research.expireLeases();
  const body = await c.req.json<{ seasonId: string; civ: CivId }>();
  if (body.civ !== "north" && body.civ !== "south") return c.json({ error: "Invalid civilization" }, 400);
  const claim = research.claimDecision(body.seasonId, body.civ);
  return c.json(claim, claim.ok ? 200 : claim.reason === "busy" ? 409 : 422);
});

app.post("/api/research/submit", async (c) => {
  if (!researchAuthorized(c.req.header("authorization"))) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{
    seasonId: string;
    turn: number;
    civ: CivId;
    leaseToken: string;
    submissionKey: string;
    rawResponse: string;
    repairedResponse?: string;
    startedAt?: number;
    completedAt?: number;
  }>();
  if (body.civ !== "north" && body.civ !== "south") return c.json({ error: "Invalid civilization" }, 400);
  if (body.rawResponse.length > 200_000 || (body.repairedResponse?.length ?? 0) > 200_000) {
    return c.json({ error: "Response too large" }, 413);
  }
  const result = research.submitDecision(body);
  return c.json(result, result.ok ? 200 : result.reason === "repair_required" ? 422 : 409);
});

app.post("/api/research/control", async (c) => {
  if (!researchAuthorized(c.req.header("authorization"))) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{
    seasonId: string;
    action: "pause" | "resume" | "abort";
    reason?: string;
    maxModelRuns?: number;
  }>();
  const changed =
    body.action === "pause"
      ? research.pauseSeason(body.seasonId)
      : body.action === "resume"
        ? research.resumeSeason(body.seasonId, body.maxModelRuns)
        : research.abortSeason(body.seasonId, body.reason ?? "Aborted by operator");
  return c.json({ ok: changed, status: research.status(body.seasonId) }, changed ? 200 : 409);
});

function researchAuthorized(header?: string) {
  const secret = process.env.AI_CIVILIZATION_SECRET;
  if (!secret) return mode === "development";
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

if (mode === "production") {
  configureProduction(app);
} else {
  await configureDevelopment(app);
}

const port = Number(process.env.PORT ?? 3000);

export default { fetch: app.fetch, port, idleTimeout: 255 };

/**
 * Configure routing for production builds.
 *
 * - Streams prebuilt assets from `dist`.
 * - Static files from `public/` are copied to `dist/` by Vite and served at root paths.
 * - Falls back to `index.html` for any other GET so the SPA router can resolve the request.
 */
function configureProduction(app: Hono) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.get("*", async (c) => {
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/")) return c.notFound();

    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) {
        return new Response(file);
      }
    }

    const index = Bun.file("./dist/index.html");
    if (!(await index.exists())) return c.text("Production build not found", 503);
    return new Response(index, {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  });
}

/**
 * Configure routing for development builds.
 *
 * - Boots Vite in middleware mode for transforms.
 * - Static files from `public/` are served at root paths (matching Vite convention).
 * - Mirrors production routing semantics so SPA routes behave consistently.
 */
async function configureDevelopment(app: Hono): Promise<ViteDevServer> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });

  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (c.req.path === "/favicon.ico") return c.redirect("/favicon.svg", 302);

    const url = c.req.path;
    try {
      if (url === "/" || url === "/index.html") {
        let template = await Bun.file("./index.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, {
          headers: { "Cache-Control": "no-store, must-revalidate" },
        });
      }

      const publicFile = Bun.file(`./public${url}`);
      if (await publicFile.exists()) {
        const stat = await publicFile.stat();
        if (stat && !stat.isDirectory()) {
          return new Response(publicFile, {
            headers: { "Cache-Control": "no-store, must-revalidate" },
          });
        }
      }

      let result;
      try {
        result = await vite.transformRequest(url);
      } catch {
        result = null;
      }

      if (result) {
        return new Response(result.code, {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-store, must-revalidate",
          },
        });
      }

      let template = await Bun.file("./index.html").text();
      template = await vite.transformIndexHtml("/", template);
      return c.html(template, {
        headers: { "Cache-Control": "no-store, must-revalidate" },
      });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error(error);
      return c.text("Internal Server Error", 500);
    }
  });

  return vite;
}
