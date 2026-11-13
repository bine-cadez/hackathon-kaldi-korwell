-- MCP OAuth: authorization codes are single use (OAuth 2.1).
-- Each redeemed code's jti is recorded until shortly after the code expires.
CREATE TABLE IF NOT EXISTS mcp_used_codes (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_used_codes_expires_at ON mcp_used_codes (expires_at);
