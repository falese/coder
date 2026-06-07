import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { listEpisodes } from "../episodes/store.js";
import { buildGraph } from "../graph/build.js";
import { saveGraph, loadGraph } from "../graph/store.js";
import { neighbors, topNodes } from "../graph/query.js";
import { logger } from "../observability/logger.js";

export function createGraphCommand(): Command {
  const cmd = new Command("graph").description("Build and query the knowledge graph of concept threads");

  cmd
    .command("build")
    .description("Build the knowledge graph from captured episodes")
    .action(() => {
      const config = loadConfig();
      const episodes = listEpisodes(config.episodes_dir);
      const graph = buildGraph(episodes);
      const path = saveGraph(config.graph_dir, graph);
      logger.logEvent({
        event: "graph_built",
        ts: new Date().toISOString(),
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        episodes: episodes.length,
      });
      process.stderr.write(
        `Built graph from ${String(episodes.length)} episode(s): ` +
        `${String(graph.nodes.length)} nodes, ${String(graph.edges.length)} edges -> ${path}\n`,
      );
    });

  cmd
    .command("show")
    .description("Print a summary of the built graph")
    .option("--top <n>", "Show the top N concepts", "10")
    .action((options: { top: string }) => {
      const config = loadConfig();
      const graph = loadGraph(config.graph_dir);
      if (!graph) {
        process.stderr.write(`No graph found in ${config.graph_dir}. Run \`coder graph build\` first.\n`);
        process.exit(1);
      }
      process.stdout.write(
        `Graph built ${graph.builtAt}: ${String(graph.nodes.length)} nodes, ${String(graph.edges.length)} edges\n`,
      );
      const n = parseInt(options.top, 10);
      process.stdout.write(`Top ${String(n)} concepts:\n`);
      for (const node of topNodes(graph, n)) {
        process.stdout.write(`  ${node.label}  (${String(node.count)} episodes)\n`);
      }
    });

  cmd
    .command("query <concept>")
    .description("List concepts related to <concept> by co-occurrence")
    .action((concept: string) => {
      const config = loadConfig();
      const graph = loadGraph(config.graph_dir);
      if (!graph) {
        process.stderr.write(`No graph found in ${config.graph_dir}. Run \`coder graph build\` first.\n`);
        process.exit(1);
      }
      const related = neighbors(graph, concept);
      if (related.length === 0) {
        process.stderr.write(`No related concepts for "${concept}".\n`);
        return;
      }
      for (const r of related) {
        process.stdout.write(`  ${r.label}  (co-occurs in ${String(r.weight)} episode(s))\n`);
      }
    });

  return cmd;
}
