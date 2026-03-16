export interface TestFixture {
  name: string;
  input: string;
  expectedFields: Record<string, unknown>;
}

export const fixtures: TestFixture[] = [
  {
    name: "Explicit framework — Express.js + PostgreSQL SaaS platform",
    input:
      "We need a senior-level assessment for building a multi-tenant SaaS API using Express.js and PostgreSQL. Candidates should demonstrate strong API design and database modeling skills.",
    expectedFields: {
      domain: "backend",
      framework: "express",
      difficulty: "senior",
    },
  },
  {
    name: "No framework — simple CRUD blog API",
    input:
      "Create an assessment for a simple CRUD blog API in Node.js. The candidate should be able to build basic REST endpoints and handle validation.",
    expectedFields: {
      framework: null,
      runtime: "node",
    },
  },
  {
    name: "Vague input — something with data processing",
    input: "Something with data processing",
    expectedFields: {
      domain: "data_engineering",
    },
  },
  {
    name: "Multiple skill signals — real-time collab editor with React + Go",
    input:
      "Build an assessment for a real-time collaborative document editor. The frontend should use React with WebSockets, and the backend should be in Go. This is for a staff-level engineer who needs to handle concurrent editing, conflict resolution, and state synchronization.",
    expectedFields: {
      domain: "fullstack",
      difficulty: "staff",
    },
  },
  {
    name: "Explicit difficulty — Junior-level Python CSV tool",
    input:
      "Junior-level exercise: Build a Python command-line tool that reads a CSV file, filters rows by a column value, and outputs the result.",
    expectedFields: {
      difficulty: "junior",
      runtime: "python",
    },
  },
  {
    name: "Constraint extraction — Kafka + ClickHouse pipeline, no external cloud services",
    input:
      "Design an assessment for a senior data engineer building a real-time event analytics pipeline using Kafka and ClickHouse. The pipeline should handle time-series data from IoT sensors. Constraint: no external cloud services allowed — everything must run locally.",
    expectedFields: {
      domain: "data_engineering",
      difficulty: "senior",
    },
  },
];
