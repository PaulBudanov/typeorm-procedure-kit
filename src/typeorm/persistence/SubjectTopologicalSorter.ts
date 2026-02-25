import { TypeORMError } from '../error/index.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';

import type { Subject } from './Subject.js';

/**
 * Orders insert or remove subjects in proper order (using topological sorting)
 * to make sure insert or remove operations are executed in a proper order.
 */
export class SubjectTopologicalSorter {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Insert subjects needs to be sorted.
   */
  public subjects: Array<Subject>;

  /**
   * Unique list of entity metadatas of this subject.
   */
  public metadatas: Array<EntityMetadata>;

  /**
   * Internal cursor for topological sort algorithm.
   */
  private toposortCursor = 0;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(subjects: Array<Subject>) {
    this.subjects = [...subjects]; // copy subjects to prevent changing of sent array
    this.metadatas = this.getUniqueMetadatas(this.subjects);
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Sorts (orders) subjects in their topological order.
   */
  public sort(direction: 'insert' | 'delete'): Array<Subject> {
    // if there are no metadatas it probably mean there is no subjects... we don't have to do anything here
    if (!this.metadatas.length) return this.subjects;

    const sortedSubjects: Array<Subject> = [];

    // first if we sort for deletion all junction subjects
    // junction subjects are subjects without entity and database entity set
    if (direction === 'delete') {
      const junctionSubjects = this.subjects.filter(
        (subject) => !subject.entity && !subject.databaseEntity
      );
      sortedSubjects.push(...junctionSubjects);
      this.removeAlreadySorted(junctionSubjects);
    }

    // next we always insert entities with non-nullable relations, sort them first
    const nonNullableDependencies = this.getNonNullableDependencies();
    let sortedNonNullableEntityTargets = this.toposort(nonNullableDependencies);
    if (direction === 'insert') {
      sortedNonNullableEntityTargets = sortedNonNullableEntityTargets.reverse();
    }

    // so we have a sorted entity targets
    // go thought each of them and find all subjects with sorted entity target
    // add those sorted targets and remove them from original array of targets
    sortedNonNullableEntityTargets.forEach((sortedEntityTarget) => {
      const entityTargetSubjects = this.subjects.filter(
        (subject) =>
          subject.metadata.targetName === sortedEntityTarget ||
          subject.metadata.inheritanceTree.some(
            (s) => s.name === sortedEntityTarget
          )
      );
      sortedSubjects.push(...entityTargetSubjects);
      this.removeAlreadySorted(entityTargetSubjects);
    });

    // next sort all other entities
    // same process as in above but with other entities
    const otherDependencies: Array<Array<string>> = this.getDependencies();
    let sortedOtherEntityTargets = this.toposort(otherDependencies);
    if (direction === 'insert') {
      sortedOtherEntityTargets = sortedOtherEntityTargets.reverse();
    }

    sortedOtherEntityTargets.forEach((sortedEntityTarget) => {
      const entityTargetSubjects = this.subjects.filter(
        (subject) => subject.metadata.targetName === sortedEntityTarget
      );
      sortedSubjects.push(...entityTargetSubjects);
      this.removeAlreadySorted(entityTargetSubjects);
    });

    // if we have something left in the subjects add them as well
    sortedSubjects.push(...this.subjects);
    return sortedSubjects;
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Removes already sorted subjects from this.subjects list of subjects.
   */
  protected removeAlreadySorted(subjects: Array<Subject>): void {
    subjects.forEach((subject) => {
      const index = this.subjects.indexOf(subject);
      if (index !== -1) {
        this.subjects.splice(index, 1);
      }
    });
  }

  /**
   * Extracts all unique metadatas from the given subjects.
   */
  protected getUniqueMetadatas(
    subjects: Array<Subject>
  ): Array<EntityMetadata> {
    const metadatas: Array<EntityMetadata> = [];
    subjects.forEach((subject) => {
      if (!metadatas.includes(subject.metadata)) {
        metadatas.push(subject.metadata);
      }
    });
    return metadatas;
  }

  /**
   * Gets dependency tree for all entity metadatas with non-nullable relations.
   * We need to execute insertions first for entities which non-nullable relations.
   */
  protected getNonNullableDependencies(): Array<Array<string>> {
    return this.metadatas.reduce(
      (dependencies, metadata) => {
        metadata.relationsWithJoinColumns.forEach((relation) => {
          if (relation.isNullable) return;

          dependencies.push([
            metadata.targetName,
            relation.inverseEntityMetadata.targetName,
          ]);
        });
        return dependencies;
      },
      [] as Array<Array<string>>
    );
  }

  /**
   * Gets dependency tree for all entity metadatas with non-nullable relations.
   * We need to execute insertions first for entities which non-nullable relations.
   */
  protected getDependencies(): Array<Array<string>> {
    return this.metadatas.reduce(
      (dependencies, metadata) => {
        metadata.relationsWithJoinColumns.forEach((relation) => {
          // if relation is self-referenced we skip it
          if (relation.inverseEntityMetadata === metadata) return;

          dependencies.push([
            metadata.targetName,
            relation.inverseEntityMetadata.targetName,
          ]);
        });
        return dependencies;
      },
      [] as Array<Array<string>>
    );
  }

  /**
   * Sorts given graph using topological sorting algorithm.
   *
   * Algorithm is kindly taken from https://github.com/marcelklehr/toposort repository.
   */
  protected toposort(edges: Array<Array<string>>): Array<string> {
    const uniqueNodes = (arr: Array<Array<string>>): Array<string> => {
      const res: Array<string> = [];
      for (let i = 0, len = arr.length; i < len; i++) {
        const edge = arr[i]!;
        if (!res.includes(edge[0]!)) res.push(edge[0]!);
        if (!res.includes(edge[1]!)) res.push(edge[1]!);
      }
      return res;
    };

    const nodes = uniqueNodes(edges);
    this.toposortCursor = nodes.length;
    let i = this.toposortCursor;
    const sorted: Array<string> = new Array<string>(this.toposortCursor);
    const visited = new Set<number>();

    while (i--) {
      if (!visited.has(i)) {
        this.visitNode(nodes[i]!, i, [], nodes, edges, sorted, visited);
      }
    }

    return sorted;
  }

  /**
   * Visits a node during topological sort and processes its dependencies.
   */
  private visitNode(
    node: string,
    i: number,
    predecessors: Array<string>,
    nodes: Array<string>,
    edges: Array<Array<string>>,
    sorted: Array<string>,
    visited: Set<number>
  ): void {
    if (predecessors.includes(node)) {
      throw new TypeORMError(`Cyclic dependency: ${JSON.stringify(node)}`);
    }

    if (!nodes.includes(node)) {
      throw new TypeORMError(
        `Found unknown node. Make sure to provided all involved nodes. Unknown node: ${JSON.stringify(node)}`
      );
    }

    if (visited.has(i)) return;
    visited.add(i);

    // outgoing edges
    const outgoing = edges.filter((edge) => edge[0] === node);
    if (outgoing.length) {
      const preds = predecessors.concat(node);
      let idx = outgoing.length;
      do {
        const child = outgoing[--idx]![1]!;
        this.visitNode(
          child,
          nodes.indexOf(child),
          preds,
          nodes,
          edges,
          sorted,
          visited
        );
      } while (idx);
    }

    sorted[--this.toposortCursor] = node;
  }
}
