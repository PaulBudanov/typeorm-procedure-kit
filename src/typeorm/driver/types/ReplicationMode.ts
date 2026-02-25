/**
 * Replication mode used by the driver.
 * - `master`: Use master database for both read and write queries.
 * - `slave`: Use slave database for read queries.
 */
export type ReplicationMode = 'master' | 'slave';
