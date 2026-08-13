export * from "./v1";
export * as v1 from "./v1";
export { getTeamApiJsonSchema, TEAM_API_SCHEMA_URL, TEAM_API_SCHEMA_MODELINE } from "./json-schema";
export { SCHEMA_REGISTRY, isSupportedVersion, resolveSchemaForVersion, type SupportedTeamApiVersion } from "./registry";
export {
  LATEST_TEAM_API_VERSION,
  MIGRATIONS,
  assessVersion,
  isFutureVersion,
  migrateDocument,
  supportedVersions,
  type Migration,
  type MigrationResult,
  type VersionAssessment,
  type VersionStatus,
} from "./migrate";
