// Wrangler bundles .sql files as text modules by default.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
