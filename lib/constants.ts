/**
 * Domain-specific keyterms for AssemblyAI Universal-3 Pro STT boosting.
 * Sent to the WebSocket to improve recognition of technical vocabulary.
 * Max 100 keyterms, each ≤ 50 chars per AssemblyAI docs.
 */
export const DOMAIN_KEYTERMS: string[] = [
  // General enterprise / cloud
  'CI/CD', 'HIPAA', 'SOC2', 'Zero-Trust', 'RBAC',
  'VPC', 'IAM', 'EKS', 'S3', 'Terraform',
  'Kubernetes', 'Docker', 'microservices',
  // Observability
  'Datadog', 'LangFuse', 'Grafana', 'Prometheus',
  'OpenTelemetry', 'distributed tracing',
  // AI/ML
  'LLM', 'RAG', 'fine-tuning', 'prompt engineering',
  'embeddings', 'vector database', 'agentic',
  'hallucination', 'guardrails', 'eval framework',
  // DevSecOps
  'DevSecOps', 'SAST', 'DAST', 'penetration testing',
  'vulnerability scanning', 'shift left',
  // Data
  'ETL', 'data pipeline', 'Talend', 'Snowflake',
  'Delta Lake', 'data governance',
  // Agile
  'sprint', 'standup', 'retrospective', 'Jira',
  'epics', 'story points',
  // Sales
  'MEDDIC', 'BANT', 'champion', 'economic buyer',
  'proof of concept', 'POC', 'ROI', 'ARR', 'MRR',
];
