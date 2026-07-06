"""NetworkX dependency graph: nodes = repo-relative files, edges importer -> imported.

Centrality per PROJECT.md = in-degree in the import graph (how many files
depend on this file), normalized to [0, 1].
"""

from pathlib import Path

import networkx as nx

from discovery import parser


def build_graph(repo_path: Path) -> nx.DiGraph:
    files = parser.list_source_files(repo_path)
    rel_paths = {file.relative_to(repo_path).as_posix() for file in files}
    graph = nx.DiGraph()
    graph.add_nodes_from(sorted(rel_paths))
    for file in files:
        importer = file.relative_to(repo_path).as_posix()
        for spec in parser.extract_imports(file):
            imported = parser.resolve_import(spec, importer, rel_paths)
            if imported and imported != importer:
                graph.add_edge(importer, imported)
    return graph


def centrality_scores(graph: nx.DiGraph) -> dict[str, float]:
    if graph.number_of_nodes() == 0:
        return {}
    in_degrees = dict(graph.in_degree())
    peak = max(in_degrees.values()) or 1
    return {node: degree / peak for node, degree in in_degrees.items()}
