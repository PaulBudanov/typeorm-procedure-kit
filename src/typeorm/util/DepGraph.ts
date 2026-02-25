/**
 * This source code is from https://github.com/jriecken/dependency-graph
 * Just added proper types here, wrapper everything into exported class.
 * We cant use a package itself because we want to package "everything-in-it" for the frontend users of TypeORM.
 */

/**
 * A simple dependency graph
 */

import { TypeORMError } from '../error/TypeORMError.js';

/**
 * Helper for creating a Depth-First-Search on
 * a set of edges.
 *
 * Detects cycles and throws an Error if one is detected.
 *
 * @param edges The set of edges to DFS through
 * @param leavesOnly Whether to only return "leaf" nodes (ones who have no edges)
 * @param result An array in which the results will be populated
 */
function createDFS(
  edges: Record<string, Array<string>>,
  leavesOnly: boolean,
  result: Array<string>
): (currentNode: string) => void {
  const currentPath: Array<string> = [];
  const visited: Record<string, boolean> = {};
  return function DFS(currentNode: string): void {
    visited[currentNode] = true;
    currentPath.push(currentNode);
    edges[currentNode]?.forEach(function (node: string) {
      if (!visited[node]) {
        DFS(node);
      } else if (currentPath.indexOf(node) >= 0) {
        currentPath.push(node);
        throw new TypeORMError(
          `Dependency Cycle Found: ${currentPath.join(' -> ')}`
        );
      }
    });
    currentPath.pop();
    if (
      (!leavesOnly || edges[currentNode]?.length === 0) &&
      result.indexOf(currentNode) === -1
    ) {
      result.push(currentNode);
    }
  };
}

export class DepGraph {
  public nodes: Record<string, unknown> = {};
  public outgoingEdges: Record<string, Array<string>> = {}; // Node -> [Dependency Node]
  public incomingEdges: Record<string, Array<string>> = {}; // Node -> [Dependant Node]

  /**
   * Add a node to the dependency graph. If a node already exists, this method will do nothing.
   */
  public addNode(node: string, data?: unknown): void {
    if (!this.hasNode(node)) {
      // Checking the arguments length allows the user to add a node with undefined data
      if (arguments.length === 2) {
        this.nodes[node] = data;
      } else {
        this.nodes[node] = node;
      }
      this.outgoingEdges[node] = [];
      this.incomingEdges[node] = [];
    }
  }

  /**
   * Remove a node from the dependency graph. If a node does not exist, this method will do nothing.
   */
  public removeNode(node: string): void {
    if (this.hasNode(node)) {
      delete this.nodes[node];
      delete this.outgoingEdges[node];
      delete this.incomingEdges[node];
      [this.incomingEdges, this.outgoingEdges].forEach(function (edgeList) {
        Object.keys(edgeList).forEach(function (key: string) {
          const idx = edgeList[key]?.indexOf(node);
          if (idx && idx >= 0) {
            edgeList[key]!.splice(idx, 1);
          }
        });
      });
    }
  }

  /**
   * Check if a node exists in the graph
   */
  public hasNode(node: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.nodes, node);
  }

  /**
   * Get the data associated with a node name
   */
  public getNodeData(node: string): unknown {
    if (this.hasNode(node)) {
      return this.nodes[node];
    } else {
      throw new TypeORMError(`Node does not exist: ${node}`);
    }
  }

  /**
   * Set the associated data for a given node name. If the node does not exist, this method will throw an error
   */
  public setNodeData(node: string, data: unknown): void {
    if (this.hasNode(node)) {
      this.nodes[node] = data;
    } else {
      throw new TypeORMError(`Node does not exist: ${node}`);
    }
  }

  /**
   * Add a dependency between two nodes. If either of the nodes does not exist,
   * an Error will be thrown.
   */
  public addDependency(from: string, to: string): boolean {
    if (!this.hasNode(from)) {
      throw new TypeORMError(`Node does not exist: ${from}`);
    }
    if (!this.hasNode(to)) {
      throw new TypeORMError(`Node does not exist: ${to}`);
    }
    if (this.outgoingEdges[from]?.indexOf(to) === -1) {
      this.outgoingEdges[from].push(to);
    }
    if (this.incomingEdges[to]?.indexOf(from) === -1) {
      this.incomingEdges[to].push(from);
    }
    return true;
  }

  /**
   * Remove a dependency between two nodes.
   */
  public removeDependency(from: string, to: string): void {
    let idx: number | undefined;
    if (this.hasNode(from)) {
      idx = this.outgoingEdges[from]?.indexOf(to);
      if (idx && idx >= 0) {
        this.outgoingEdges[from]!.splice(idx, 1);
      }
    }

    if (this.hasNode(to)) {
      idx = this.incomingEdges[to]?.indexOf(from);
      if (idx && idx >= 0) {
        this.incomingEdges[to]!.splice(idx, 1);
      }
    }
  }

  /**
   * Get an array containing the nodes that the specified node depends on (transitively).
   *
   * Throws an Error if the graph has a cycle, or the specified node does not exist.
   *
   * If `leavesOnly` is true, only nodes that do not depend on any other nodes will be returned
   * in the array.
   */
  public dependenciesOf(node: string, leavesOnly: boolean): Array<string> {
    if (this.hasNode(node)) {
      const result: Array<string> = [];
      const DFS = createDFS(this.outgoingEdges, leavesOnly, result);
      DFS(node);
      const idx = result.indexOf(node);
      if (idx >= 0) {
        result.splice(idx, 1);
      }
      return result;
    } else {
      throw new TypeORMError(`Node does not exist: ${node}`);
    }
  }

  /**
   * get an array containing the nodes that depend on the specified node (transitively).
   *
   * Throws an Error if the graph has a cycle, or the specified node does not exist.
   *
   * If `leavesOnly` is true, only nodes that do not have any dependants will be returned in the array.
   */
  public dependantsOf(node: string, leavesOnly: boolean): Array<string> {
    if (this.hasNode(node)) {
      const result: Array<string> = [];
      const DFS = createDFS(this.incomingEdges, leavesOnly, result);
      DFS(node);
      const idx = result.indexOf(node);
      if (idx >= 0) {
        result.splice(idx, 1);
      }
      return result;
    } else {
      throw new TypeORMError(`Node does not exist: ${node}`);
    }
  }

  /**
   * Construct the overall processing order for the dependency graph.
   *
   * Throws an Error if the graph has a cycle.
   *
   * If `leavesOnly` is true, only nodes that do not depend on any other nodes will be returned.
   */
  public overallOrder(leavesOnly?: boolean): Array<string> {
    // const self = this;
    const result: Array<string> = [];
    const keys = Object.keys(this.nodes);
    if (keys.length === 0) {
      return result; // Empty graph
    } else {
      // Look for cycles - we run the DFS starting at all the nodes in case there
      // are several disconnected subgraphs inside this dependency graph.
      const CycleDFS = createDFS(this.outgoingEdges, false, []);
      keys.forEach(function (n: string) {
        CycleDFS(n);
      });

      const DFS = createDFS(this.outgoingEdges, leavesOnly as boolean, result);
      // Find all potential starting points (nodes with nothing depending on them) an
      // run a DFS starting at these points to get the order
      keys
        .filter((node: string) => this.incomingEdges[node]?.length === 0)
        .forEach(function (n: string) {
          DFS(n);
        });

      return result;
    }
  }
}
