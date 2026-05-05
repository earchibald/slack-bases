/**
 * Map a Slack API error code to a user-facing message.
 * Returns null for unknown errors.
 */
export function slackErrorToMessage(error: string): string | null {
  const map: Record<string, string> = {
    invalid_auth: 'Token rejected. Generate a new config token at api.slack.com/apps.',
    not_authed: 'No valid token found. Provide one via --token flag or SLACK_CONFIG_TOKEN env var.',
    not_allowed_token_type: 'This command requires an app configuration token (starts with xoxe-). User tokens and bot tokens will not work. Generate one at api.slack.com/apps.',
    not_found: 'App not found. It may have been deleted from api.slack.com. Run `init` to create a new one.',
    name_taken: 'App name is taken. Trying a different name...',
    invalid_arguments: 'Invalid manifest data. The bundled template may be corrupted. Reinstall the package and try again.',
    invalid_manifest: 'The manifest is invalid. Reinstall the package and try again.',
    restricted_action: 'Only workspace owners can create apps. Contact your Slack admin.',
    app_management_operation_denied: 'App creation is restricted in this workspace. Contact your Slack admin.',
    token_expired: 'Token expired. Generate a new config token at api.slack.com/apps.',
    token_revoked: 'Token revoked. Generate a new config token at api.slack.com/apps.',
    access_denied: 'Access denied. You may not have permission to create apps in this workspace.',
    account_inactive: 'Your Slack account is inactive.',
    rate_limited: 'Rate limited by Slack API. Waiting and retrying...',
    ratelimited: 'Rate limited by Slack API. Waiting and retrying...',
    too_many_requests: 'Rate limited by Slack API. Waiting and retrying...',
    fatal_error: 'Slack encountered a server error. Retrying...',
    internal_error: 'Slack encountered a server error. Retrying...',
    request_timeout: 'Request timed out. Retrying...',
    service_unavailable: 'Slack API temporarily unavailable. Retrying...',
    failed_creating_app: 'App creation failed. Retrying...',
    failed_export: 'App export failed. Retrying...',
  };
  return map[error] ?? null;
}

export function isRetryableError(error: string): boolean {
  return [
    'rate_limited', 'ratelimited', 'too_many_requests',
    'fatal_error', 'internal_error', 'request_timeout',
    'service_unavailable', 'failed_creating_app', 'failed_export',
  ].includes(error);
}

export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 5_000;
